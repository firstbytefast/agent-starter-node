/**
 * Stats tests that need no models, no network and no room. The metric objects
 * are stand-ins with the same field names @livekit/agents emits.
 */
import type { voice } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import { CallStats, pct } from './call-stats.ts';

class FakeSession {
  handlers = new Map<string, Array<(e: unknown) => void>>();
  on(ev: string, cb: (e: unknown) => void) {
    const list = this.handlers.get(ev) ?? [];
    list.push(cb);
    this.handlers.set(ev, list);
  }
  emit(ev: string, payload: unknown) {
    for (const cb of this.handlers.get(ev) ?? []) cb(payload);
  }
}

const newStats = () => {
  const lines: string[] = [];
  const stats = new CallStats({
    models: { llm: 'gpt-4.1-mini', stt: 'nova-3', tts: 'gpt-4o-mini-tts' },
    forwardToTeleQuick: false,
    log: (line) => lines.push(line),
  });
  const session = new FakeSession();
  stats.attach(session as unknown as voice.AgentSession);
  return { stats, session, lines };
};

const runTurn = (
  session: FakeSession,
  speechId: string,
  opts: { prompt: number; completion: number; chars: number },
) => {
  session.emit('metrics_collected', {
    metrics: { type: 'eou_metrics', speechId, endOfUtteranceDelayMs: 200 },
  });
  session.emit('metrics_collected', {
    metrics: {
      type: 'llm_metrics',
      speechId,
      ttftMs: 400,
      promptTokens: opts.prompt,
      completionTokens: opts.completion,
    },
  });
  session.emit('metrics_collected', {
    metrics: {
      type: 'tts_metrics',
      speechId,
      ttfbMs: 900,
      charactersCount: opts.chars,
      audioDurationMs: 3000,
    },
  });
};

describe('CallStats', () => {
  it('accumulates tokens across turns', () => {
    const { stats, session } = newStats();
    runTurn(session, 's1', { prompt: 100, completion: 20, chars: 80 });
    runTurn(session, 's2', { prompt: 140, completion: 30, chars: 95 });

    const t = stats.totals;
    expect(t.turns).toBe(2);
    expect(t.promptTokens).toBe(240);
    expect(t.completionTokens).toBe(50);
    expect(t.ttsCharacters).toBe(175);
    expect(t.llmRequests).toBe(2);
  });

  it('prints one line per turn', () => {
    const { session, lines } = newStats();
    runTurn(session, 's1', { prompt: 312, completion: 48, chars: 96 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('turn 1');
    expect(lines[0]).toContain('312→48 tok');
    expect(lines[0]).toContain('caller waited 1500 ms'); // 200 + 400 + 900
  });

  it('renders a summary with the model names and totals', () => {
    const { stats, session, lines } = newStats();
    runTurn(session, 's1', { prompt: 10, completion: 2, chars: 8 });
    session.emit('metrics_collected', {
      metrics: { type: 'stt_metrics', audioDurationMs: 4500 },
    });
    stats.logSummary();

    const text = lines.join('\n');
    expect(text).toContain('gpt-4.1-mini');
    expect(text).toContain('12 tokens');
    expect(text).toContain('4.5 s audio');
  });

  it('does not throw on a metric with missing fields', () => {
    const { stats, session } = newStats();
    session.emit('metrics_collected', { metrics: { type: 'llm_metrics', speechId: 's1' } });
    session.emit('metrics_collected', { metrics: { type: 'vad_metrics' } });

    expect(stats.totals.llmRequests).toBe(1);
    expect(stats.totals.promptTokens).toBe(0);
  });

  it('takes percentiles by nearest rank', () => {
    expect(pct([], 0.5)).toBe(0);
    expect(pct([100, 200, 300], 0.5)).toBe(200);
    expect(pct([100, 200, 300], 0.95)).toBe(300);
  });
});
