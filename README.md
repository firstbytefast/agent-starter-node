<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# LiveKit Agents Starter - Node.js

A complete starter project for building voice AI apps with [LiveKit Agents for Node.js](https://github.com/livekit/agents-js) and [LiveKit Cloud](https://cloud.livekit.io/).

The starter project includes:

- A simple voice AI assistant, ready for extension and customization
- A voice AI pipeline built on [LiveKit Inference](https://docs.livekit.io/agents/models/inference), providing zero-configuration access to [models](https://docs.livekit.io/agents/models) from top labs
  - Uses the fast, open-weight Gemma 4 31B model, [hosted by LiveKit](https://docs.livekit.io/agents/models/llm/livekit/) and tuned for optimal performance in voice AI, as the default LLM
  - Uses Fish Audio S2.1 Pro for TTS, which renders the inline delivery markup that expressive mode relies on
  - Supports more than 50 models from OpenAI, Cartesia, Deepgram, and other providers
  - Access to a wide range of other models, including [Realtime models](https://docs.livekit.io/agents/models/realtime), through extensive plugin ecosystem
- Expressive mode, enabled by default: the framework injects the TTS provider's markup guide into the LLM prompt, so the model emits inline delivery tags (emotion, pacing, non-verbal sounds) that the TTS renders and the transcript never shows
- Eval suite based on the LiveKit Agents [testing & evaluation framework](https://docs.livekit.io/agents/start/testing)
- [LiveKit Turn Detector](https://docs.livekit.io/agents/logic/turns/turn-detector/), an end-of-turn model that listens to the user's audio directly, combining semantic understanding with acoustic cues for state-of-the-art accuracy across 14 languages
- [Background voice cancellation](https://docs.livekit.io/transport/media/noise-cancellation/)
- Deep session insights from LiveKit [Agent Observability](https://docs.livekit.io/deploy/observability/)
- A Dockerfile ready for [production deployment to LiveKit Cloud](https://docs.livekit.io/deploy/agents/)

This starter app is compatible with any [custom web/mobile frontend](https://docs.livekit.io/frontends/) or [telephony](https://docs.livekit.io/telephony/).

## Using coding agents

This project is designed to work with coding agents like [Claude Code](https://claude.com/product/claude-code), [Cursor](https://www.cursor.com/), and [Codex](https://openai.com/codex/).

For your convenience, LiveKit offers both a CLI and an [MCP server](https://docs.livekit.io/reference/developer-tools/docs-mcp/) that can be used to browse and search its documentation. The [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/) (`lk docs`) works with any coding agent that can run shell commands. Install it for your platform:

**macOS:**

```console
brew install livekit-cli
```

**Linux:**

```console
curl -sSL https://get.livekit.io/cli | bash
```

**Windows:**

```console
winget install LiveKit.LiveKitCLI
```

The `lk docs` subcommand requires version 2.15.0 or higher. Check your version with `lk --version` and update if needed. Once installed, your coding agent can search and browse LiveKit documentation directly from the terminal:

```console
lk docs search "voice agents"
lk docs get-page /agents/start/voice-ai-quickstart
```

See the [Coding agent support](https://docs.livekit.io/intro/coding-agents/) guide for more details, including MCP server setup.

The project includes a complete [AGENTS.md](AGENTS.md) file for these assistants. You can modify this file to suit your needs. To learn more about this file, see [https://agents.md](https://agents.md).

## Dev Setup

Create a project from this template with the LiveKit CLI (recommended):

```bash
lk cloud auth
lk agent init my-agent --template agent-starter-node
```

The CLI clones the template and configures your environment. Then follow the rest of this guide from [Run the agent](#run-the-agent).

This project uses [pnpm](https://pnpm.io/) as the package manager.

<details>
<summary>Alternative: Manual setup without the CLI</summary>

Clone the repository and install dependencies:

```console
cd agent-starter-node
pnpm install
```

Sign up for [LiveKit Cloud](https://cloud.livekit.io/) then set up the environment by copying `.env.example` to `.env.local` and filling in the required keys:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

You can load the LiveKit environment automatically using the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/):

```bash
lk cloud auth
lk app env -w -d .env.local
```

</details>

## Run the agent

To run the agent during development, use the `dev` command:

```console
pnpm run dev
```

In production, use the `start` command:

```console
pnpm run start
```

## Frontend & Telephony

Get started quickly with our pre-built frontend starter apps, or add telephony support:

| Platform         | Link                                                                                                                | Description                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Web**          | [`livekit-examples/agent-starter-react`](https://github.com/livekit-examples/agent-starter-react)                   | Web voice AI assistant with React & Next.js        |
| **iOS/macOS**    | [`livekit-examples/agent-starter-swift`](https://github.com/livekit-examples/agent-starter-swift)                   | Native iOS, macOS, and visionOS voice AI assistant |
| **Flutter**      | [`livekit-examples/agent-starter-flutter`](https://github.com/livekit-examples/agent-starter-flutter)               | Cross-platform voice AI assistant app              |
| **React Native** | [`livekit-examples/voice-assistant-react-native`](https://github.com/livekit-examples/voice-assistant-react-native) | Native mobile app with React Native & Expo         |
| **Android**      | [`livekit-examples/agent-starter-android`](https://github.com/livekit-examples/agent-starter-android)               | Native Android app with Kotlin & Jetpack Compose   |
| **Web Embed**    | [`livekit-examples/agent-starter-embed`](https://github.com/livekit-examples/agent-starter-embed)                   | Voice AI widget for any website                    |
| **Telephony**    | [Documentation](https://docs.livekit.io/telephony/)                                                                 | Add inbound or outbound calling to your agent      |

For advanced customization, see the [complete frontend guide](https://docs.livekit.io/frontends/).

## Tests and evals

Simulations run full multi-turn conversations between a simulated user and your agent on LiveKit Cloud, then judge each transcript. The scenarios live in [`scenarios.yaml`](scenarios.yaml). Run them locally with the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/):

```console
lk agent simulate --scenarios scenarios.yaml
```

The `Simulations` workflow in `.github/workflows/simulations.yml` runs the same file on every merge to `main` and on demand from the Actions tab. It runs there rather than on every pull request push because each run spends real inference. See the [simulations guide](https://docs.livekit.io/agents/start/testing/simulations/) for how to write scenarios and read results.

For turn-level checks that don't need a live session, the LiveKit Agents [testing & evaluation framework](https://docs.livekit.io/agents/start/testing/) runs your agent in-process under `vitest`. A commented-out example lives in [`src/agent.test.ts`](src/agent.test.ts).

## Using this template repo for your own project

Once you've started your own project based on this repo, you should:

1. **Check in your `pnpm-lock.yaml`**: This file is currently untracked for the template, but you should commit it to your repository for reproducible builds and proper configuration management. (The same applies to `livekit.toml`, if you run your agents in LiveKit Cloud)

2. **Add your own repository secrets**: You must [add secrets](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/using-secrets-in-github-actions) for `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` so that the simulations can run in CI.

## Deploying to production

This project is production-ready and includes a working `Dockerfile`. To deploy it to LiveKit Cloud or another environment, see the [deploying to production](https://docs.livekit.io/deploy/agents/) guide.

## Self-hosted LiveKit

You can also self-host LiveKit instead of using LiveKit Cloud. See the [self-hosting](https://docs.livekit.io/transport/self-hosting/local/) guide for more information. If you choose to self-host, you'll need to also use [model plugins](https://docs.livekit.io/agents/models/#plugins) instead of LiveKit Inference and will need to remove the [LiveKit Cloud noise cancellation](https://docs.livekit.io/transport/media/noise-cancellation/) plugin.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Run over TeleQuick (no LiveKit server)

This fork also runs the same agent over [TeleQuick](https://telequick.dev)'s
QUIC transport instead of a LiveKit room: phone calls reach the agent through
the TeleQuick engine, media rides WebTransport/QUIC datagrams, and no LiveKit
server or WebRTC stack is involved. The agent code in `src/agent.ts` and
`src/main.ts` is standard `@livekit/agents` code (with LiveKit Inference swapped
for model plugins, as any self-hosted deployment requires); only
`src/telequick-worker.ts` is TeleQuick-specific.

```console
docker build -f Dockerfile.telequick -t cc-starter-agent-node .
docker run -d --name cc-starter-agent-node \
  -e CC_APP_KEY=ck_... -e CC_SECRET=... -e CC_AGENT=salesbot \
  -e OPENAI_API_KEY=sk-... -e DEEPGRAM_API_KEY=... \
  cc-starter-agent-node
```

Or locally, once `.env.local` has the provider keys:

```console
pnpm install
CC_APP_KEY=ck_... CC_SECRET=... CC_AGENT=salesbot pnpm telequick
```

The worker registers the agent by name with the engine and serves inbound calls
dispatched to it (route a DID to the agent with a TeleQuick external-agent
config). The transport is published at `https://artifacts.clutchcall.dev/npm/`
as `@telequick/livekit-transport`; `.npmrc` already points the `@telequick`
scope there.

### Thinking sound and call stats

The agent plays a sound while the LLM thinks, and prints what each turn used.
Two files do this, and both work on LiveKit and over TeleQuick:

- [`src/thinking-audio.ts`](src/thinking-audio.ts) — fills the dead air between
  the end of the caller's sentence and the first byte of the reply. A caller
  cannot see a spinner, and silence on a phone line sounds like a dropped call.
- [`src/call-stats.ts`](src/call-stats.ts) — prints one line for each turn, and
  a summary at the end of the call.

The two transports need two different players, and `startThinkingSound(ctx,
session)` selects the correct one:

| Transport       | Player                        | How it plays                                                                                   |
| --------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| LiveKit room    | `voice.BackgroundAudioPlayer` | publishes a second audio track and mixes the clips into it                                     |
| TeleQuick QUIC | `TransportThinkingAudio`      | writes 20 ms frames on the caller's audio lane, because the call has only one lane and no room |

The sound starts 400 ms after the agent enters the `thinking` state, so a fast
turn stays silent. The default sound is synthesized, and the repo holds no audio
file. To use your own sound, set `CC_THINKING_WAV` to the path of a mono 16-bit
WAV file:

```console
CC_APP_KEY=ck_... CC_SECRET=... CC_THINKING_WAV=./sounds/hold.wav pnpm telequick
```

`CallStats` reads the `metrics_collected` events that `@livekit/agents` emits
for each stage. It prints one line for each turn while the call runs:

```
turn 3 | eou 180 ms · llm ttft 420 ms (312→48 tok) · tts ttfb 890 ms (96 ch) | caller waited 1490 ms
```

At the end of the call it prints the totals:

```
──── call summary ────
turns        7
llm  gpt-4.1-mini     4210 prompt (1024 cached) + 512 completion = 4722 tokens over 7 requests
stt  nova-3           61.4 s audio
tts  gpt-4o-mini-tts  742 characters → 48.1 s audio over 9 requests
latency p50/p95  eou 170/240 ms · ttft 402/780 ms · ttfb 830/1210 ms
```

Over TeleQuick the same numbers also go to the engine (`sendUsage`), so the
token counts land on the call timeline and in ClickHouse next to the CDR. On
LiveKit that step does nothing. Telemetry never stops a call: a bad metric, a
missing field, or a failed report is logged and dropped.

Node metrics are in milliseconds (`ttftMs`, `audioDurationMs`); the Python
starter's are in seconds. The two files carry the same numbers.

Run `pnpm test` to test these two files. The tests use fake metric objects and a
fake transport, so they need no models, no network, and no call.

### TeleQuick mirror

This tree is CANONICAL for both brands. `./mirror-telequick.sh` writes the
TeleQuick-branded copy to `.mirror/telequick/` — package scope
(`@telequick/livekit-transport`), engine host, env prefixes and file names all
rewritten in one mechanical pass. The mirror is generated and gitignored: make
every change here and re-run the script. The package origin
`artifacts.clutchcall.dev` is protected, because one origin serves both brands.

### What differs from upstream, and why

| Change                                                                    | Reason                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inference.LLM/STT/TTS/TurnDetector` → OpenAI + Deepgram + Silero plugins | LiveKit Inference is a LiveKit Cloud service; there is no Cloud here. Each provider bills you directly.                                                                                                                       |
| `vad:` passed explicitly                                                  | Omitting it makes `AgentSession` auto-provision the bundled _Inference_ VAD — the Cloud path being replaced.                                                                                                                  |
| `turnDetection: 'vad'`                                                    | Upstream's `inference.TurnDetector()` is a Cloud-served end-of-turn model. VAD endpoints on silence instead.                                                                                                                  |
| ai-coustics noise cancellation removed                                    | It attaches to a LiveKit room's input track; there is no room.                                                                                                                                                                |
| `expressive: true` removed                                                | Needs a markup-capable TTS, and the option does not exist in `@livekit/agents` 1.6.1.                                                                                                                                         |
| Dependency versions pinned exactly                                        | LiveKit lockstep-pins each plugin's peer to one exact `@livekit/agents` version, and the transport peers on 1.6.1 because its shim patches `AgentSession` internals. Upstream's `^1.6.3` would float to 1.8.0 and break that. |
| `cli.runApp()` guarded by an entry-file check                             | The TeleQuick worker imports the agent definition from `main.ts`; without the guard that import also starts LiveKit's CLI, which then looks for a LiveKit server.                                                            |
| `onnxruntime-node: true` in `pnpm-workspace.yaml`                         | Upstream ships that key as a literal `set this to true or false` placeholder. Silero's VAD needs the native runtime, and left unbuilt it throws _after_ the worker has registered.                                            |

### Known gaps

- Not yet voice-verified end to end over a live call. The thinking sound and the
  stats lines are covered by unit tests only.
- Upstream's `src/agent.test.ts` is entirely commented out, which left the file
  with no test suite — and vitest fails such a file. A `it.todo` now holds the
  place, so `pnpm test` runs the two new suites and stays green.
