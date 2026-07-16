# pi-provider-kiro

A [pi](https://shittycodingagent.ai/) provider extension for the Kiro API (AWS CodeWhisperer/Q). It handles Kiro authentication, model discovery, message conversion, reasoning events, and streaming.

## Why this exists

Kiro gives you a strong free model menu, but pi needs a provider that speaks Kiro's auth, model catalog, and streaming protocol cleanly. `pi-provider-kiro` handles that bridge, including:

- AWS Builder ID, IAM Identity Center, Google, and GitHub login flows
- shared credentials from an existing `kiro-cli` session when available
- native reasoning events and signed reasoning-history replay when Kiro emits them
- model-family-specific reasoning effort for Claude and GPT models
- startup model discovery from `kiro-cli`, with a 24-hour regional cache
- region-aware model selection after authentication
- bounded recovery for Kiro-specific stream failures

## Quick start

Install the maintained fork from its `main` branch:

```bash
pi package install 'git:github.com/andrewtengson/pi-provider-kiro@main'
```

Restart pi after installation. The package remains pinned to the `main` ref in pi settings; rerun the command to fetch newer commits.

Then log in from pi:

```text
/login kiro
```

The login flow supports:
- **AWS Builder ID** — native device-code flow, works well over SSH/remotes
- **Your organization** — IAM Identity Center start URL
- **Google** — social login via `kiro-cli`
- **GitHub** — social login via `kiro-cli`

If you already use [kiro-cli](https://kiro.dev), the provider can reuse those credentials instead of forcing a second login.

## Models

At startup, the provider runs `kiro-cli chat --list-models --format json` when the regional cache is missing or older than 24 hours. It writes `~/.kiro-models-cache.json` before provider registration, so pi startup validation and the model picker see newly released models. If the CLI is missing or fails, the provider keeps the existing cache or its built-in catalog.

The current `us-east-1` catalog contains 18 models:

| Family | Models | Context | Max output | Reasoning | Images |
|--------|--------|---------|------------|-----------|--------|
| GPT-5.6 | `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna` | 272K | 128K | Yes | Yes |
| Claude Opus | `claude-opus-4-8`, `claude-opus-4-7` | 1M | 128K | Yes | Yes |
| Claude Opus | `claude-opus-4-6` | 1M | 32,768 | Yes | Yes |
| Claude Opus | `claude-opus-4-5` | 200K | 65,536 | Yes | Yes |
| Claude Sonnet | `claude-sonnet-5` | 1M | 128K | Yes | Yes |
| Claude Sonnet | `claude-sonnet-4-6` | 1M | 65,536 | Yes | Yes |
| Claude Sonnet | `claude-sonnet-4-5`, `claude-sonnet-4` | 200K | 65,536 | Yes | Yes |
| Claude Haiku | `claude-haiku-4-5` | 200K | 65,536 | No | Yes |
| DeepSeek | `deepseek-3-2` | 164K | 8K | Yes | No |
| MiniMax | `minimax-m2-1`, `minimax-m2-5` | 196K | 8K | No | No |
| GLM | `glm-5` | 200K | 8K | Yes | No |
| Qwen3 Coder | `qwen3-coder-next` | 256K | 8K | Yes | No |
| Auto | `auto` | 1M | 65,536 | Yes | Yes |

Availability can differ by Kiro API region. After login, the provider selects the cache for the credential's mapped API region and rewrites model endpoints for that region.

## Usage

Once logged in, select any Kiro model in pi:

```text
/model claude-sonnet-4-6
```

Or let Kiro pick automatically:

```text
/model auto
```

Reasoning effort follows each model family's native Kiro request schema. Claude models use `output_config.effort`; GPT models use `reasoning.effort`. When Kiro sends `reasoningContentEvent` frames, the provider emits pi thinking events and stores signatures for later history replay. XML `<thinking>` parsing remains a fallback for models that send tagged text.

Kiro currently accepts GPT-5.6 reasoning effort but does not consistently emit native reasoning frames for GPT-5.6. In that case pi has no live thinking content to display. `hideThinkingBlock` only controls rendered reasoning blocks; it does not disable provider thinking events.

## Retry Behavior

This provider keeps local recovery for Kiro-specific cases:
- `403` authentication races, including credential refresh through `kiro-cli`
- first-token timeout and stalled-stream recovery
- empty response and echo-loop retries
- capacity retries for `INSUFFICIENT_MODEL_CAPACITY`
- immediate failure for hard quota responses such as `MONTHLY_REQUEST_COUNT`
- one retry when a text-only response ends without context usage or tool calls, which indicates a truncated Kiro stream
- stream abortion after more than 4,096 consecutive whitespace characters, preventing runaway partial responses from entering session history

Generic HTTP `429` and `5xx` retries remain the responsibility of pi's session layer.

A protocol-valid text-only `stop` cannot be distinguished from a final answer. At high context usage, GPT-5.6 can return progress prose with a normal `stop`; the provider does not retry those responses because doing so would also retry genuine final answers. Configure pi compaction before the model's degradation range if this occurs in long sessions.

## Development

```bash
npm run format      # Format source and tests
npm run lint        # Run Biome lint checks
npm run check       # Type check without emitting files
npm test            # Run the Vitest suite
npm run test:watch  # Watch mode
npm run build       # Bundle dist/index.js
```

## Architecture

The provider keeps its public registration surface in `index.ts` and groups protocol responsibilities into focused modules:

```
src/
├── index.ts            # Startup discovery and provider registration
├── models.ts           # Built-in catalog, CLI discovery, regional cache, metadata
├── oauth.ts            # Builder ID, Identity Center, Google, and GitHub auth
├── kiro-cli.ts         # kiro-cli credential sharing and refresh
├── transform.ts        # Request conversion and signed reasoning replay
├── history.ts          # Conversation history conversion
├── thinking-parser.ts  # XML reasoning fallback
├── event-parser.ts     # Native Kiro stream events, including reasoning
└── stream.ts           # Streaming, retries, tool calls, and safety guards
```

See [AGENTS.md](AGENTS.md) for detailed development guidance and [.agents/summary/](/.agents/summary/index.md) for full architecture documentation.

## License

MIT
