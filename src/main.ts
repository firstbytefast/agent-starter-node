import { ServerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_MODEL, createAgent } from './agent.ts';
import { CallStats } from './call-stats.ts';
import { startThinkingSound } from './thinking-audio.ts';

// One place for the model names: the pipeline is built from them, and the stats
// line labels the tokens with them. The LLM name lives with the agent that
// uses it, in agent.ts.
const STT_MODEL = 'nova-3';
const TTS_MODEL = 'gpt-4o-mini-tts';

// Silero's VAD loads an ONNX model — expensive enough that it must not happen
// per call. Cached at module scope so the first call pays for it and every
// later call on this worker reuses it. (Upstream leans on LiveKit Inference's
// bundled VAD, which has no local model to load.)
// Typed off the loader itself rather than naming the VAD type: the concrete
// class lives in @livekit/agents' root export, not under `voice`.
let vadPromise: ReturnType<typeof silero.VAD.load> | undefined;
const loadVAD = () => (vadPromise ??= silero.VAD.load());

// Load environment variables from a local file.
// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
// when running locally or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

export default defineAgent({
  entry: async (ctx) => {
    // A self-hosted voice pipeline: Deepgram STT, OpenAI TTS, Silero VAD.
    //
    // Upstream builds this from `inference.*`, which routes STT/TTS/VAD/turn
    // detection through LiveKit Inference — a LiveKit Cloud service. Over
    // TeleQuick there is no LiveKit Cloud, so each piece comes from its
    // provider plugin and is billed by that provider directly.
    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
      // nova-3 + language 'multi' handles code-switching callers.
      stt: new deepgram.STT({ model: STT_MODEL, language: 'multi' }),

      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear
      tts: new openai.TTS({ model: TTS_MODEL, voice: 'alloy' }),

      // Voice Activity Detection. This MUST be passed explicitly: omitting it
      // makes AgentSession auto-provision the bundled `inference.VAD`, which is
      // the Cloud path we are replacing.
      vad: await loadVAD(),

      turnHandling: {
        // 'vad' endpoints on silence. Upstream's `inference.TurnDetector()` is
        // a multimodal end-of-turn model served by LiveKit Inference, so it is
        // not available here.
        turnDetection: 'vad',
        // Upstream also sets `interruption: { mode: 'adaptive' }`, which exists
        // to tell a real interruption from a backchannel ("mhm", "right") using
        // the turn detector's prediction. With plain VAD there is no such
        // prediction to consult, so it is left at the default rather than
        // configured to look like something it cannot do.

        // Allow the LLM to generate a response while waiting for the end of turn
        preemptiveGeneration: { enabled: true },
      },

      // Upstream sets `expressive: true`, which injects a TTS markup guide into
      // the LLM prompt so the model emits inline delivery tags. It needs a
      // markup-capable TTS (the Fish Audio model it pairs with) and the option
      // does not exist on AgentSession in @livekit/agents 1.6.1, which is the
      // version this fork pins. Dropped.
    });

    // Per-turn latency and token use on the console, totals at hangup. Over
    // the TeleQuick transport the same numbers also reach the engine, so they
    // land on the call timeline next to the CDR.
    const stats = new CallStats({
      models: { llm: LLM_MODEL, stt: STT_MODEL, tts: TTS_MODEL },
      providers: { llm: 'openai', stt: 'deepgram', tts: 'openai' },
    });
    stats.attach(session);
    ctx.addShutdownCallback(async () => stats.logSummary());

    // Start the session, which initializes the voice pipeline and warms up the models
    // Over TeleQuick, `room` is the transport's JobContext veneer and the
    // installed shim binds the session to QUIC audio instead of a LiveKit room.
    // Upstream also passes ai-coustics noise cancellation through
    // `inputOptions`; that plugin attaches to a LiveKit room's input track, so
    // it has nothing to attach to here and is dropped.
    await session.start({
      agent: createAgent(),
      room: ctx.room,
    });

    // Fill the dead air while the LLM thinks. The caller has no spinner, and
    // a silent gap on a phone line reads as a dropped call. This has to come
    // AFTER session.start: the transport player reads the audio lane the
    // session binds there.
    const thinking = await startThinkingSound(ctx, session);
    if (thinking) ctx.addShutdownCallback(() => thinking.close());

    // // Add a virtual avatar to the session, if desired
    // // For other providers, see https://docs.livekit.io/agents/models/avatar/
    // const avatar = new anam.AvatarSession({
    //   personaConfig: {
    //     name: '...',
    //     avatarId: '...', // See https://docs.livekit.io/agents/models/avatar/plugins/anam
    //   },
    // });
    // // Start the avatar and wait for it to join
    // await avatar.start(session, ctx.room);

    // Join the room and connect to the user
    await ctx.connect();

    // Greet the user on joining
    session.generateReply({
      instructions: 'Greet the user in a helpful and friendly manner.',
    });
  },
});

// Run the agent server — but ONLY when this file is the process entry.
//
// src/telequick-worker.ts imports the agent definition above to run the very
// same entrypoint over QUIC. Without this guard that import would also start
// LiveKit's CLI app, which then tries to reach a LiveKit server that is not
// part of this deployment.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: 'my-agent',
    }),
  );
}
