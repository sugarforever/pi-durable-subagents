# @sugarforever/pi-durable-subagents

Subagent extensions for
[`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable).

The package provides two implementations:

- `ForegroundSubagents` creates a child Conversation, waits for its answer, and
  returns the answer as the tool result.
- `BackgroundSubagents` manages named, persistent child Conversations and
  reports their answers back to the parent through durable Reporter tasks.

Pi Durable is an embedded TypeScript SDK. Install this package with npm and
register the selected extension in your application's Registry. Pi coding
agent's `pi install` command does not register extensions in a Pi Durable
Harness.

## Requirements

- Node.js 22.19 or newer
- `@earendil-works/pi-durable` 1.2.x
- `@earendil-works/pi-ai` 1.2.x
- `@earendil-works/chord` 1.2.x

## Install

```bash
npm install @sugarforever/pi-durable-subagents \
  @earendil-works/pi-durable \
  @earendil-works/pi-ai \
  @earendil-works/chord
```

## Foreground subagents

Use the foreground extension when the parent must wait for the delegated answer
before it can continue.

```typescript
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { ForegroundSubagents } from "@sugarforever/pi-durable-subagents";

const registry = createRegistry();
registry.install(ForegroundSubagents);

const harness = await Harness.open(
  storage,
  {
    models,
    registry,
    settings: { toolExecution: "parallel" },
  },
  context,
);
```

The extension exposes one tool:

```text
subagent({ task })
```

Each tool call creates an independently configured child Conversation. The child
inherits the parent's Agent configuration, then removes `ForegroundSubagents` so
it cannot recursively delegate again. A stable request ID and task ownership let
replay-safe execution reuse the original child and submission after a restart.

Run the complete example with an OpenAI API key:

```bash
OPENAI_API_KEY=... npm run example:foreground
```

## Background subagents

Use the background extension when a named child should continue after the
parent's current turn finishes.

```typescript
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { BackgroundSubagents } from "@sugarforever/pi-durable-subagents";

const registry = createRegistry();
registry.install(BackgroundSubagents);

const harness = await Harness.open(storage, { models, registry }, context);
```

The extension exposes one management tool with four actions:

```text
subagent({ action: "spawn", name, message })
subagent({ action: "send", name, message, followUp? })
subagent({ action: "stop", name })
subagent({ action: "status", name? })
```

`spawn` creates a named child behind a background anchor task. `send` uses
`steer` by default and `followUp` when requested. Reporter tasks wait for child
answers and submit them to the parent as follow-up inputs. `stop` aborts current
work but keeps the Conversation and transcript available for later messages.

Run the complete example with:

```bash
OPENAI_API_KEY=... npm run example:background
```

## Choose one mode per Conversation

Both extensions expose a tool named `subagent`. Install only the mode a
Conversation should use. Separate Harness instances or per-Conversation
extension selection can use different modes.

```typescript
await root.configure(
  { extensions: { add: [BackgroundSubagents], remove: [ForegroundSubagents] } },
  context,
);
```

## Persistence and restart

The Registry is process-local and is not stored in Pi Durable Storage. Install
the same extension before reopening a Harness:

```typescript
const registry = createRegistry();
registry.install(BackgroundSubagents);

const harness = await Harness.open(storage, { models, registry }, context);
```

Pending Reporter tasks resume after their definitions are installed. Use SQLite,
JSONL, or another persistent Storage implementation when work must survive
process restarts; `MemoryStorage` is suitable only for examples and tests.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Publishing

Releases are published by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml). Ordinary
pushes and tags do not publish the package. To release:

1. Update `version` in `package.json` and `package-lock.json`, then merge the
   change.
2. Create and publish a non-prerelease GitHub Release whose tag is exactly
   `v<version>` (for example, `v0.1.0`).
3. The workflow installs dependencies, type-checks, tests, builds, verifies the
   package contents, and publishes the public
   `@sugarforever/pi-durable-subagents` package.

The unscoped `pi-durable-subagents` name belongs to a different project and must
not be used for this repository.

### Recommended: npm trusted publishing

After the scoped package exists on npm, configure a GitHub Actions trusted
publisher in the package settings on npmjs.com:

- Organization or user: `sugarforever`
- Repository: `pi-durable-subagents`
- Workflow filename: `publish.yml`
- Environment: leave blank unless the workflow is updated to use a matching
  GitHub Environment
- Allowed action: allow direct `npm publish`

The workflow uses a GitHub-hosted runner, grants only `contents: read` and
`id-token: write`, and installs an OIDC-capable npm CLI. No publishing token is
required after trusted publishing is configured. npm requires the package to
exist before a trusted publisher can be added, so use the token bootstrap below
for the first publication. Create the trusted publisher within two days of the
first OIDC release because an unverified new configuration expires.

### First publish or token fallback

Create a granular npm access token that has read/write access only to
`@sugarforever/pi-durable-subagents`, enables bypass 2FA for publishing if
required by the npm account policy, and save it as the GitHub Actions repository
secret `NPM_TOKEN`. Publishing a GitHub Release then uses that secret when OIDC
is not configured.

After one successful token-based publication, configure trusted publishing as
described above, remove the `NPM_TOKEN` secret, and revoke the npm token. For
additional protection, configure GitHub tag rules and npm publishing access
restrictions appropriate for trusted publishing.

The implementation follows Pi Durable's official foreground and background
subagent examples, adapted to the 1.2.x `ToolExecutionResult.output` API.
