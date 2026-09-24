/**
 * Filler audio while the LLM thinks. TypeScript analogue of the Python
 * starter's `thinking_audio.py`.
 *
 * A caller cannot see a spinner. Between the end of their sentence and the
 * first byte of TTS there is dead air — on a phone line that reads as a dropped
 * call, and callers start saying "hello? hello?" into it. A soft sound during
 * that gap tells them the agent is still there.
 *
 * There are two transports, and they need two different players:
 *
 *   - LiveKit room (`pnpm dev` / `pnpm start`): the SDK's own
 *     `voice.BackgroundAudioPlayer`. It publishes a second audio track and
 *     mixes ambience + thinking clips into it. It NEEDS a room.
 *
 *   - TeleQuick QUIC (`pnpm telequick`): there is no room and no second
 *     track — `ctx.room` is a veneer, and the call has exactly one audio lane
 *     to the caller. `TransportThinkingAudio` writes the filler straight onto
 *     that lane, one 20 ms frame per 20 ms tick.
 *
 * `startThinkingSound(ctx, session)` picks the right one and returns a handle
 * with `close()`. Nothing else depends on it: if the sound cannot start (no
 * room, no transport), the call runs on in silence and the reason is logged
 * once.
 *
 * The default sound is synthesized, so the repo carries no audio asset. Point
 * `CC_THINKING_WAV` at a mono 16-bit WAV (hold music, keyboard typing, a hum)
 * to use your own.
 */
import { voice } from '@livekit/agents';
import { readFileSync } from 'node:fs';

/** Wait this long inside `thinking` before playing anything. A fast turn is
 *  answered well before this, and filler over a 300 ms gap sounds nervous. */
export const DEFAULT_DELAY_MS = 400;
export const DEFAULT_VOLUME = 0.25;
export const FRAME_MS = 20;

/** Structurally what the transport's sendFrame takes (and rtc-node's shape). */
interface Frame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

interface TransportLike {
  readonly sampleRate?: number;
  sendFrame(frame: Frame): Promise<void>;
}

export interface ThinkingHandle {
  close(): Promise<void>;
}

/**
 * A soft two-tone pulse every 1.2 s: present, but not a ringtone.
 *
 * Each pulse is a raised-cosine envelope over a sine — the envelope is what
 * keeps it from clicking at the edges, which is the whole difference between
 * "the agent is thinking" and "the line is broken".
 */
export function synthLoop(sampleRate: number, volume = DEFAULT_VOLUME): Int16Array {
  const periodS = 1.2;
  const pulses: Array<[number, number, number]> = [
    [0.0, 420, 0.09],
    [0.22, 320, 0.09],
  ];
  const samples = new Int16Array(Math.round(sampleRate * periodS));
  const peak = 32767 * Math.min(1, Math.max(0, volume));
  for (const [startS, hz, durS] of pulses) {
    const first = Math.round(startS * sampleRate);
    const count = Math.round(durS * sampleRate);
    for (let i = 0; i < count; i++) {
      const envelope = 0.5 * (1 - Math.cos((2 * Math.PI * i) / count));
      samples[first + i] = Math.round(
        peak * envelope * Math.sin((2 * Math.PI * hz * i) / sampleRate),
      );
    }
  }
  return samples;
}

/**
 * Read a mono 16-bit WAV and resample it to the wire rate.
 *
 * Linear resampling is crude, but this is a looped filler clip on an 8 kHz
 * telephony leg — the loop is the audible thing, not the interpolation.
 */
export function loadWav(path: string, sampleRate: number, volume = DEFAULT_VOLUME): Int16Array {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  // Walk the chunks rather than assuming a 44-byte header: plenty of encoders
  // write LIST/fact chunks first, and a fixed offset would read those as audio.
  let pos = 12;
  let channels = 0;
  let srcRate = 0;
  let bits = 0;
  let data: Buffer | undefined;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      srcRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!data || channels !== 1 || bits !== 16) {
    throw new Error(`${path}: need mono 16-bit PCM`);
  }
  const src = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const gain = Math.min(1, Math.max(0, volume));
  if (srcRate === sampleRate) {
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i]! * gain);
    return out;
  }
  const ratio = srcRate / sampleRate;
  const out = new Int16Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const low = Math.floor(p);
    const high = Math.min(low + 1, src.length - 1);
    const frac = p - low;
    out[i] = Math.round((src[low]! * (1 - frac) + src[high]! * frac) * gain);
  }
  return out;
}

export function loadClip(sampleRate: number, volume = DEFAULT_VOLUME): Int16Array {
  const path = process.env.CC_THINKING_WAV;
  if (path) {
    try {
      return loadWav(path, sampleRate, volume);
    } catch (err) {
      // A bad file is not a dead call.
      console.warn(`thinking audio: cannot read ${path} — using the synth clip (${String(err)})`);
    }
  }
  return synthLoop(sampleRate, volume);
}

/**
 * Thinking filler on the TeleQuick QUIC lane (no room, no mixer).
 *
 * Frames go to `transport.sendFrame` directly, NOT to `session.output.audio`:
 * the audio output counts segments and answers each flush with exactly one
 * `onPlaybackFinished`, which is what advances the SDK's turn loop. Filler
 * pushed through it would add segments the turn loop never asked for.
 *
 * Stopping is just "stop pushing". We never call `signalClear`, because clear
 * is barge-in: it would drop the caller's downstream buffer and put a playout
 * report in the queue that the next real flush would read as its own. Pacing
 * one frame per tick is what makes that safe — when the LLM answers, at most
 * one 20 ms frame of filler is still in flight ahead of the reply.
 */
export class TransportThinkingAudio implements ThinkingHandle {
  private clip: Int16Array;
  private samplesPerFrame: number;
  private transport: TransportLike;
  private sampleRate: number;
  private delayMs: number;
  private playing = false;
  private closed = false;
  private done: Promise<void> = Promise.resolve();

  constructor(
    transport: TransportLike,
    sampleRate = 8000,
    delayMs = DEFAULT_DELAY_MS,
    volume = DEFAULT_VOLUME,
  ) {
    this.transport = transport;
    this.sampleRate = sampleRate;
    this.delayMs = delayMs;
    this.clip = loadClip(sampleRate, volume);
    this.samplesPerFrame = Math.round((sampleRate * FRAME_MS) / 1000);
  }

  attach(session: voice.AgentSession): void {
    (session as unknown as { on(ev: string, cb: (e: unknown) => void): void }).on(
      'agent_state_changed',
      (ev) => {
        const state = (ev as { newState?: string }).newState;
        if (state === 'thinking') this.start();
        else this.stop();
      },
    );
  }

  start(): void {
    if (this.closed || this.playing) return;
    this.playing = true;
    this.done = this.play();
  }

  stop(): void {
    this.playing = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.playing = false;
    await this.done;
  }

  private async play(): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    await sleep(this.delayMs);
    let offset = 0;
    // Sleep to an absolute deadline, not a fixed 20 ms: a fixed sleep drifts
    // late by however long each send took, and the filler would then arrive
    // slower than real time.
    let deadline = Date.now();
    while (this.playing && !this.closed) {
      deadline += FRAME_MS;
      const chunk = new Int16Array(this.samplesPerFrame);
      for (let i = 0; i < chunk.length; i++) {
        chunk[i] = this.clip[offset]!;
        offset = (offset + 1) % this.clip.length; // wrap the loop
      }
      try {
        await this.transport.sendFrame({
          data: chunk,
          sampleRate: this.sampleRate,
          channels: 1,
          samplesPerChannel: chunk.length,
        });
      } catch (err) {
        // Filler must never end a call.
        console.warn(`thinking audio: playback stopped — ${String(err)}`);
        this.playing = false;
        return;
      }
      await sleep(deadline - Date.now());
    }
  }
}

/** The TeleQuick transport this session is bound to, or undefined. */
async function transportFor(session: voice.AgentSession): Promise<TransportLike | undefined> {
  try {
    const plugin = (await import('@telequick/livekit-transport')) as {
      currentTransport?: () => TransportLike | undefined;
    };
    // Published after 0.1.7; older builds only have the bound audio output,
    // which holds the same transport.
    const fromPlugin = plugin.currentTransport?.();
    if (fromPlugin) return fromPlugin;
  } catch {
    return undefined; // plugin not installed — LiveKit-only checkout
  }
  const out = (session as unknown as { output?: { audio?: { transport?: TransportLike } } }).output
    ?.audio;
  return out?.transport;
}

/**
 * Play filler while the agent thinks. Returns a handle with `close()`.
 *
 * Picks the room player on LiveKit and the transport player over TeleQuick.
 * Returns undefined when neither is available, after logging why — the call
 * itself is never blocked on this.
 */
export async function startThinkingSound(
  ctx: { room?: unknown },
  session: voice.AgentSession,
  opts: { ambience?: boolean } = {},
): Promise<ThinkingHandle | undefined> {
  const room = ctx.room as { localParticipant?: unknown } | undefined;
  if (room?.localParticipant) {
    try {
      const player = new voice.BackgroundAudioPlayer({
        // Two clips so a long think does not loop one sample audibly.
        thinkingSound: [
          { source: voice.BuiltinAudioClip.KEYBOARD_TYPING, volume: 0.6 },
          { source: voice.BuiltinAudioClip.KEYBOARD_TYPING2, volume: 0.5 },
        ],
        // Spread rather than `undefined`: the option is typed as absent-or-set,
        // and an explicit undefined is a different thing to the type checker.
        ...(opts.ambience
          ? { ambientSound: { source: voice.BuiltinAudioClip.OFFICE_AMBIENCE, volume: 0.5 } }
          : {}),
      });
      await player.start({
        room: room as never,
        agentSession: session,
      });
      console.log('thinking audio: room player started');
      return { close: () => player.close() };
    } catch (err) {
      console.warn(`thinking audio: room player did not start — ${String(err)}`);
      return undefined;
    }
  }

  const transport = await transportFor(session);
  if (!transport) {
    console.log('thinking audio: no room and no transport — staying silent');
    return undefined;
  }
  const player = new TransportThinkingAudio(transport, transport.sampleRate ?? 8000);
  player.attach(session);
  console.log('thinking audio: transport player attached');
  return player;
}
