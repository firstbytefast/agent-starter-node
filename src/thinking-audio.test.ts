/**
 * The transport filler player: gated on agent state, paced one frame per tick.
 * Runs against a fake transport — no QUIC, no engine, no call.
 */
import type { voice } from '@livekit/agents';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportThinkingAudio, loadWav, synthLoop } from './thinking-audio.ts';

interface Frame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

class FakeTransport {
  readonly sampleRate = 8000;
  frames: Frame[] = [];
  async sendFrame(frame: Frame): Promise<void> {
    this.frames.push(frame);
  }
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A mono 16-bit WAV, written the long way so the reader is tested for real. */
function writeWav(path: string, samples: Int16Array, sampleRate: number): void {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.byteLength, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.from(samples.buffer)]));
}

describe('synthLoop', () => {
  it('is one quiet loop that starts and ends at silence', () => {
    const clip = synthLoop(8000, 0.25);
    expect(clip.length).toBe(Math.round(8000 * 1.2));
    const peak = clip.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(Math.round(32767 * 0.25) + 1);
    // Pulses fade in and out, so looping the clip cannot click.
    expect(clip[0]).toBe(0);
    expect(clip[clip.length - 1]).toBe(0);
  });
});

describe('loadWav', () => {
  it('reads a mono 16-bit file and resamples it to the wire rate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinking-'));
    const path = join(dir, 'clip.wav');
    writeWav(path, synthLoop(16000, 1), 16000);

    const clip = loadWav(path, 8000, 1);
    expect(clip.length).toBe(Math.round(16000 * 1.2) / 2); // half the samples at half the rate
  });

  it('rejects a file that is not mono 16-bit PCM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thinking-'));
    const path = join(dir, 'bad.wav');
    writeFileSync(path, Buffer.from('not a wav at all'));
    expect(() => loadWav(path, 8000)).toThrow();
  });
});

describe('TransportThinkingAudio', () => {
  afterEach(() => vi.restoreAllMocks());

  it('plays only while the agent is thinking', async () => {
    const transport = new FakeTransport();
    const player = new TransportThinkingAudio(transport, 8000, 0);
    const session = new FakeSession();
    player.attach(session as unknown as voice.AgentSession);

    session.emit('agent_state_changed', { newState: 'listening' });
    await sleep(80);
    expect(transport.frames).toHaveLength(0);

    session.emit('agent_state_changed', { newState: 'thinking' });
    await sleep(120);
    expect(transport.frames.length).toBeGreaterThan(0);

    session.emit('agent_state_changed', { newState: 'speaking' });
    await sleep(20);
    const sent = transport.frames.length;
    await sleep(120);
    // Nothing more once the reply starts — filler must not play under TTS.
    expect(transport.frames.length).toBe(sent);

    await player.close();
  });

  it('sends 20 ms frames paced in real time', async () => {
    const transport = new FakeTransport();
    const player = new TransportThinkingAudio(transport, 8000, 0);
    player.start();
    await sleep(220);
    await player.close();

    expect(transport.frames.length).toBeGreaterThan(0);
    for (const frame of transport.frames) {
      expect(frame.samplesPerChannel).toBe(160); // 20 ms at 8 kHz
      expect(frame.data.length).toBe(160);
    }
    // Paced, not dumped: ~11 frames in 220 ms, never the whole 1.2 s loop.
    expect(transport.frames.length).toBeLessThanOrEqual(16);
  });

  it('does not throw into the call when the transport fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      sampleRate: 8000,
      sendFrame: async () => {
        throw new Error('connection lost');
      },
    };
    const player = new TransportThinkingAudio(broken, 8000, 0);
    player.start();
    await sleep(60);
    await expect(player.close()).resolves.toBeUndefined();
  });
});
