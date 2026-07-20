# pi-provider-kiro

A [pi](https://shittycodingagent.ai/) provider extension for the Kiro API (AWS CodeWhisperer/Q). It handles Kiro authentication, model discovery, message conversion, reasoning events, and streaming.

## Why this exists

Kiro gives you a strong free model menu, but pi needs a provider that speaks Kiro's auth, model catalog, and streaming protocol cleanly. `pi-provider-kiro` handles that bridge, including:

- AWS Builder ID, IAM Identity Center, Google, and GitHub login flows
- shared credentials from an existing `kiro-cli` session when available
- native reasoning events and signed reasoning-history replay when Kiro emits them
- schema-driven reasoning effort derived from each model's Kiro request-fields catalog
- authenticated model discovery from the Kiro management API, cached per region for one hour
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

The provider talks to the current Kiro services: the management control plane
(`management.<region>.kiro.dev`) for profiles, the model catalog, and usage, and
the runtime host (`runtime.<region>.kiro.dev`) for inference.

Model discovery is authenticated and dynamic. After login, token refresh, or a
streaming request whose regional cache is missing or older than one hour, the
provider calls management `ListAvailableModels`, enriches each entry with catalog
metadata (context/output limits and the reasoning-effort schema), and writes a
versioned per-region cache to `~/.kiro-management-models-cache.json`. pi's model
picker reads that cache. If discovery fails, the last valid cache is preserved.

A built-in bootstrap catalog is registered before authentication and whenever no
regional cache exists yet. It contains 18 models:

| Family | Models | Context | Max output | Reasoning | Images |
|--------|--------|---------|------------|-----------|--------|
| GPT-5.6 | `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna` | 272K | 128K | Yes | Yes |
| Claude Opus | `claude-opus-4-8`, `claude-opus-4-7` | 1M | 128K | Yes | Yes |
| Claude Opus | `claude-opus-4-6` | 1M | 32,768 | Yes | Yes |
| Claude Sonnet | `claude-sonnet-5` | 1M | 65,536 | Yes | Yes |
| Claude Sonnet | `claude-sonnet-4-6` | 1M | 65,536 | Yes | Yes |
| Claude Sonnet | `claude-sonnet-4-5`, `claude-sonnet-4` | 200K | 65,536 | Yes | Yes |
| Claude Haiku | `claude-haiku-4-5` | 200K | 65,536 | No | Yes |
| Claude Fable | `claude-fable-5` | 1M | 65,536 | Yes | Yes |
| DeepSeek | `deepseek-3-2` | 164K | 8K | Yes | No |
| MiniMax | `minimax-m2-1`, `minimax-m2-5` | 196K | 8K | No | No |
| GLM | `glm-5` | 200K | 8K | Yes | No |
| Qwen3 Coder | `qwen3-coder-next` | 256K | 8K | Yes | No |
| Auto | `auto` | 1M | 65,536 | Yes | Yes |

Authenticated discovery is the source of truth and can differ from this baseline:
it may surface additional models your account exposes (for example
`claude-opus-4-5`) and corrects context/output limits and reasoning support from
the live catalog. The provider selects the cache for the credential's mapped API
region and points model endpoints at that region's runtime host.

## Usage

Once logged in, select any Kiro model in pi:

```text
/model claude-sonnet-4-6
```

Or let Kiro pick automatically:

```text
/model auto
```

Reasoning effort follows each model family's native Kiro request schema. The
provider reads each model's catalog request-fields schema to learn the effort
field and its allowed values, so Claude models use `output_config.effort` and GPT
models use `reasoning.effort` without hardcoding. When a model has no catalog
schema, the provider falls back to values derived from the model's own thinking
levels. When Kiro sends `reasoningContentEvent` frames, the provider emits pi
thinking events and stores signatures for later history replay. XML `<thinking>`
parsing remains a fallback for models that send tagged text.

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
npm run check       # Type check source and tests without emitting files
npm test            # Run the Vitest suite
npm run test:watch  # Watch mode
npm run build       # Bundle dist/index.js
```

## Architecture

The provider keeps its public registration surface in `index.ts` and groups protocol responsibilities into focused modules:

```
src/
├── index.ts            # Provider registration and region-aware model projection
├── endpoints.ts        # API region resolution and management/runtime host construction
├── management.ts       # Authenticated control plane: profiles, catalog, usage limits
├── models.ts           # Bootstrap catalog, management-catalog mapping, versioned regional cache
├── effort.ts           # Schema-derived reasoning effort with thinking-level fallback
├── oauth.ts            # Builder ID, Identity Center, Google, and GitHub auth
├── kiro-cli.ts         # kiro-cli credential sharing and refresh
├── usage.ts            # Account usage via management GetUsageLimits
├── transform.ts        # Request conversion and signed reasoning replay
├── history.ts          # Conversation history conversion
├── thinking-parser.ts  # XML reasoning fallback
├── event-parser.ts     # Native Kiro stream events, including reasoning
└── stream.ts           # Streaming, retries, tool calls, and safety guards
```

See [AGENTS.md](AGENTS.md) for detailed development guidance and [.agents/summary/](/.agents/summary/index.md) for full architecture documentation.

## License

MIT
