/**
 * Run the starter agent over TeleQuick's QUIC transport instead of a LiveKit room.
 *
 * The agent in `main.ts` / `agent.ts` is ordinary @livekit/agents code — this
 * worker is the only TeleQuick-specific file. `runAgentWorker` opens one
 * authenticated WebTransport/QUIC connection to the engine, registers the agent
 * by name, and runs the very same entrypoint for every phone call the engine
 * dispatches. Media rides QUIC datagrams (8 kHz pcm16 telephony); no LiveKit
 * server, room, or WebRTC is involved.
 *
 * Required environment:
 *     CC_APP_KEY / CC_SECRET   TeleQuick media app credential
 *     CC_AGENT                 agent name to register (default: salesbot)
 *     CC_HOST / CC_PORT        engine endpoint (default: engine.telequick.dev:443)
 *     OPENAI_API_KEY           LLM + TTS
 *     DEEPGRAM_API_KEY         STT
 *
 * Usage:
 *     pnpm telequick
 */
import {
  type JobContextVeneer,
  defaultConfig,
  runAgentWorker,
} from '@telequick/livekit-transport';
import type { JobContext } from '@livekit/agents';
import dotenv from 'dotenv';
import agentDefinition from './main.ts';

dotenv.config({ path: '.env.local' });

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    // Fail here rather than at connect time: an agent that registers and only
    // then discovers it has no credential takes calls it cannot answer.
    console.error(`telequick: ${name} is required`);
    process.exit(2);
  }
  return v;
};

const host = process.env.CC_HOST ?? 'engine.telequick.dev';
const port = Number(process.env.CC_PORT ?? 443);
const agentName = process.env.CC_AGENT ?? 'salesbot';

const cfg = defaultConfig({
  engineUrl: `https://${host}`,
  appKey: required('CC_APP_KEY'),
  appSecret: required('CC_SECRET'),
  agentName,
  // Telephony: 8 kHz mono pcm16 is what the engine carries on the media path.
  sampleRate: 8000,
  numChannels: 1,
  codec: 'pcm16',
});

console.log(
  `[telequick] starting worker agent=${agentName} on ` +
    `${host}:${port}/media/${cfg.appKey} — awaiting calls`,
);

await runAgentWorker(cfg, {
  host,
  port,
  verify: !process.env.CC_NO_VERIFY,
  // The entrypoint is upstream's, untouched. The transport hands it a
  // JobContext veneer (a `room` with the call id, ANI/DNIS as sip.* attributes,
  // a no-op connect()) rather than a real LiveKit JobContext; it is duck-typed
  // at runtime, so the cast is what keeps the agent file itself unmodified.
  entrypoint: (ctx: JobContextVeneer) => agentDefinition.entry(ctx as unknown as JobContext),
});
