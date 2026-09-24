/**
 * Per-call stats: latency, token use, and what each turn cost you.
 *
 * TypeScript analogue of the Python starter's `call_stats.py`. @livekit/agents
 * emits one `metrics_collected` event per pipeline stage (STT, end-of-turn,
 * LLM, TTS). This turns that stream into two things:
 *
 *   - a ONE-LINE-PER-TURN console view, so you can see where a slow turn went
 *     while the call is live, and
 *   - a call summary at hangup: total tokens in/out, characters synthesized,
 *     audio transcribed, and the p50/p95 of each latency stage.
 *
 * Both work the same on LiveKit Cloud and over the TeleQuick transport. Over
 * TeleQuick the same numbers ALSO go to the engine (`sendUsage`), so they land
 * on the call timeline and in ClickHouse next to the CDR. That path is
 * best-effort and never throws into the call.
 *
 * Node metrics are in MILLISECONDS (`ttftMs`, `audioDurationMs`), unlike the
 * Python SDK's seconds — the numbers below are kept in ms end to end.
 */
import type { voice } from '@livekit/agents';

/** The metric fields this file reads, all optional across SDK versions. */
type AnyMetrics = {
  type?: string;
  speechId?: string;
  endOfUtteranceDelayMs?: number;
  ttftMs?: number;
  ttfbMs?: number;
  promptTokens?: number;
  promptCachedTokens?: number;
  completionTokens?: number;
  charactersCount?: number;
  audioDurationMs?: number;
  metadata?: { modelName?: string; modelProvider?: string };
};

type Stage = 'llm' | 'stt' | 'tts';

export interface CallStatsOptions {
  /** Fallback labels when a metric carries no metadata of its own. */
  models?: Partial<Record<Stage, string>>;
  providers?: Partial<Record<Stage, string>>;
  /** Forward usage to the engine when the call runs over TeleQuick. */
  forwardToTeleQuick?: boolean;
  log?: (line: string) => void;
}

interface Turn {
  eouDelayMs: number;
  ttftMs: number;
  ttfbMs: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  characters: number;
}

const emptyTurn = (): Turn => ({
  eouDelayMs: 0,
  ttftMs: 0,
  ttfbMs: 0,
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  characters: 0,
});

export interface Totals {
  turns: number;
  llmRequests: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  ttsRequests: number;
  ttsCharacters: number;
  ttsAudioMs: number;
  sttAudioMs: number;
  eouDelaysMs: number[];
  ttftsMs: number[];
  ttfbsMs: number[];
}

/** p50/p95 over a short list. Nearest-rank, no interpolation. */
export function pct(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.round(q * (ordered.length - 1)))]!;
}

const num = (v: number | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);

export class CallStats {
  readonly totals: Totals = {
    turns: 0,
    llmRequests: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    ttsRequests: 0,
    ttsCharacters: 0,
    ttsAudioMs: 0,
    sttAudioMs: 0,
    eouDelaysMs: [],
    ttftsMs: [],
    ttfbsMs: [],
  };

  private open = new Map<string, Turn>();
  private opts: CallStatsOptions;
  private forward: boolean;
  private log: (line: string) => void;

  constructor(opts: CallStatsOptions = {}) {
    this.opts = opts;
    this.forward = opts.forwardToTeleQuick ?? true;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  attach(session: voice.AgentSession): void {
    // String event name, not the enum: the same handler then works on a stub
    // session in tests and across SDK versions that move the enum.
    (session as unknown as { on(ev: string, cb: (e: unknown) => void): void }).on(
      'metrics_collected',
      (ev) => this.onMetrics(ev),
    );
  }

  onMetrics(ev: unknown): void {
    const m = ((ev as { metrics?: AnyMetrics }).metrics ?? ev) as AnyMetrics;
    try {
      switch (m.type) {
        case 'eou_metrics':
          this.onEou(m);
          break;
        case 'llm_metrics':
          this.onLlm(m);
          break;
        case 'tts_metrics':
          this.onTts(m);
          break;
        case 'stt_metrics':
          this.onStt(m);
          break;
        default:
          break; // vad, avatar, interruption — nothing to bill or time
      }
    } catch (err) {
      // Telemetry never breaks a call.
      this.log(`stats: dropped a ${m.type ?? 'unknown'} metric — ${String(err)}`);
    }
  }

  private turn(m: AnyMetrics): Turn {
    const key = m.speechId ?? '-';
    let t = this.open.get(key);
    if (!t) {
      t = emptyTurn();
      this.open.set(key, t);
    }
    return t;
  }

  private onEou(m: AnyMetrics): void {
    const delay = num(m.endOfUtteranceDelayMs);
    this.turn(m).eouDelayMs = delay;
    this.totals.eouDelaysMs.push(delay);
  }

  private onLlm(m: AnyMetrics): void {
    const turn = this.turn(m);
    turn.ttftMs = num(m.ttftMs);
    turn.promptTokens = num(m.promptTokens);
    turn.cachedTokens = num(m.promptCachedTokens);
    turn.completionTokens = num(m.completionTokens);

    const t = this.totals;
    t.llmRequests += 1;
    t.promptTokens += turn.promptTokens;
    t.cachedTokens += turn.cachedTokens;
    t.completionTokens += turn.completionTokens;
    t.ttftsMs.push(turn.ttftMs);

    void this.sendUsage('llm', m, {
      prompt_tokens: turn.promptTokens,
      prompt_cached_tokens: turn.cachedTokens,
      completion_tokens: turn.completionTokens,
    });
  }

  private onTts(m: AnyMetrics): void {
    const turn = this.turn(m);
    turn.ttfbMs = num(m.ttfbMs);
    turn.characters = num(m.charactersCount);

    const t = this.totals;
    t.ttsRequests += 1;
    t.ttsCharacters += turn.characters;
    t.ttsAudioMs += num(m.audioDurationMs);
    t.ttfbsMs.push(turn.ttfbMs);

    void this.sendUsage('tts', m, { characters: turn.characters });

    // The first synthesis of a turn is when the caller starts hearing the
    // reply, so that is where the turn line is worth printing. Later segments
    // of the same turn only add to the totals.
    const key = m.speechId ?? '-';
    const done = this.open.get(key);
    if (done) {
      this.open.delete(key);
      t.turns += 1;
      this.logTurn(t.turns, done);
    }
  }

  private onStt(m: AnyMetrics): void {
    this.totals.sttAudioMs += num(m.audioDurationMs);
    void this.sendUsage('stt', m, { audio_seconds: num(m.audioDurationMs) / 1000 });
  }

  private logTurn(n: number, turn: Turn): void {
    const cached = turn.cachedTokens ? `, ${turn.cachedTokens} cached` : '';
    // eou + ttft + ttfb is what the caller waits through before the first byte
    // of the reply plays: the number to watch on a phone call.
    const waited = turn.eouDelayMs + turn.ttftMs + turn.ttfbMs;
    this.log(
      `turn ${n} | eou ${turn.eouDelayMs.toFixed(0)} ms · ` +
        `llm ttft ${turn.ttftMs.toFixed(0)} ms (${turn.promptTokens}→${turn.completionTokens} tok${cached}) · ` +
        `tts ttfb ${turn.ttfbMs.toFixed(0)} ms (${turn.characters} ch) | ` +
        `caller waited ${waited.toFixed(0)} ms`,
    );
  }

  summaryLines(): string[] {
    const t = this.totals;
    const label = (stage: Stage) => (this.opts.models?.[stage] ?? stage).padEnd(16);
    const cached = t.cachedTokens ? ` (${t.cachedTokens} cached)` : '';
    const p = (values: number[]) =>
      `${pct(values, 0.5).toFixed(0)}/${pct(values, 0.95).toFixed(0)} ms`;
    return [
      '──── call summary ────',
      `turns        ${t.turns}`,
      `llm  ${label('llm')} ${t.promptTokens} prompt${cached} + ${t.completionTokens} completion ` +
        `= ${t.promptTokens + t.completionTokens} tokens over ${t.llmRequests} requests`,
      `stt  ${label('stt')} ${(t.sttAudioMs / 1000).toFixed(1)} s audio`,
      `tts  ${label('tts')} ${t.ttsCharacters} characters → ${(t.ttsAudioMs / 1000).toFixed(1)} s audio ` +
        `over ${t.ttsRequests} requests`,
      `latency p50/p95  eou ${p(t.eouDelaysMs)} · ttft ${p(t.ttftsMs)} · ttfb ${p(t.ttfbsMs)}`,
    ];
  }

  /** Shutdown callback: print the totals for the finished call. */
  logSummary = (): void => {
    for (const line of this.summaryLines()) this.log(line);
  };

  /** TeleQuick forwarding. A no-op on a LiveKit room, and never throws. */
  private async sendUsage(
    stage: Stage,
    m: AnyMetrics,
    amounts: Record<string, number>,
  ): Promise<void> {
    if (!this.forward) return;
    try {
      const { currentConnection, currentCallId } = await import('@telequick/livekit-transport');
      const conn = currentConnection();
      const callId = currentCallId();
      if (!conn || callId === undefined) return; // on a room, not on QUIC
      conn.sendUsage(
        callId,
        stage,
        amounts,
        m.metadata?.modelProvider ?? this.opts.providers?.[stage] ?? '',
        m.metadata?.modelName ?? this.opts.models?.[stage] ?? '',
      );
    } catch (err) {
      // Not installed, or the report failed — either way the call goes on.
      this.forward = false;
      this.log(`stats: ${stage} usage report off — ${String(err)}`);
    }
  }
}
