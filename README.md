# pi-durable-subagents

Subagent extensions for [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable).

The package provides two implementations:

- `ForegroundSubagents` creates a child Conversation, waits for its answer, and returns the answer as the tool result.
- `BackgroundSubagents` manages named, persistent child Conversations and reports their answers back to the parent through durable Reporter tasks.

Pi Durable is an embedded TypeScript SDK. Install this package with npm and register the selected extension in your application's Registry. Pi coding agent's `pi install` command does not register extensions in a Pi Durable Harness.

## Requirements

- Node.js 22.19 or newer
- `@earendil-works/pi-durable` 1.2.x
- `@earendil-works/pi-ai` 1.2.x
- `@earendil-works/chord` 1.2.x

## Install

```bash
npm install github:sugarforever/pi-durable-subagents \
  @earendil-works/pi-durable \
  @earendil-works/pi-ai \
  @earendil-works/chord
```

## Foreground subagents

Use the foreground extension when the parent must wait for the delegated answer before it can continue.

```typescript
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { ForegroundSubagents } from "pi-durable-subagents";

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

Each tool call creates an independently configured child Conversation. The child inherits the parent's Agent configuration, then removes `ForegroundSubagents` so it cannot recursively delegate again. A stable request ID and task ownership let replay-safe execution reuse the original child and submission after a restart.

Run the complete example with an OpenAI API key:

```bash
OPENAI_API_KEY=... npm run example:foreground
```

## Background subagents

Use the background extension when a named child should continue after the parent's current turn finishes.

```typescript
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { BackgroundSubagents } from "pi-durable-subagents";

const registry = createRegistry();
registry.install(BackgroundSubagents);

const harness = await Harness.open(
  storage,
  { models, registry },
  context,
);
```

The extension exposes one management tool with four actions:

```text
subagent({ action: "spawn", name, message })
subagent({ action: "send", name, message, followUp? })
subagent({ action: "stop", name })
subagent({ action: "status", name? })
```

`spawn` creates a named child behind a background anchor task. `send` uses `steer` by default and `followUp` when requested. Reporter tasks wait for child answers and submit them to the parent as follow-up inputs. `stop` aborts current work but keeps the Conversation and transcript available for later messages.

Run the complete example with:

```bash
OPENAI_API_KEY=... npm run example:background
```

## Choose one mode per Conversation

Both extensions expose a tool named `subagent`. Install only the mode a Conversation should use. Separate Harness instances or per-Conversation extension selection can use different modes.

```typescript
await root.configure(
  { extensions: { add: [BackgroundSubagents], remove: [ForegroundSubagents] } },
  context,
);
```

## Persistence and restart

The Registry is process-local and is not stored in Pi Durable Storage. Install the same extension before reopening a Harness:

```typescript
const registry = createRegistry();
registry.install(BackgroundSubagents);

const harness = await Harness.open(storage, { models, registry }, context);
```

Pending Reporter tasks resume after their definitions are installed. Use SQLite, JSONL, or another persistent Storage implementation when work must survive process restarts; `MemoryStorage` is suitable only for examples and tests.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The implementation follows Pi Durable's official foreground and background subagent examples, adapted to the 1.2.x `ToolExecutionResult.output` API.
