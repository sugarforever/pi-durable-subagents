# Pi Durable Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or implement the plan natively task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the two article examples as a tested npm package with foreground and persistent background Pi Durable subagent extensions.

**Architecture:** The package exports one foreground extension and one background extension. Both use Pi Durable Conversations and task ownership; the foreground tool returns a child answer synchronously, while the background tool stores named children in a document and uses durable Reporter tasks to deliver answers back to the parent.

**Tech Stack:** TypeScript, Node.js 22.19+, `@earendil-works/pi-durable@1.2.0`, `@earendil-works/pi-ai@1.2.0`, `@earendil-works/chord@1.2.0`, Node test runner through `tsx`.

**Spec:** `/Users/wyang14/github/verysmallwoods/studio/paid/20261013-pi-durable-subagents/content/ARTICLE.md` and `/Users/wyang14/github/verysmallwoods/studio/paid/20261014-pi-durable-subagents-background/content/ARTICLE.md`

## Global Constraints

- Package consumers integrate with `registry.install(...)`; this is not a Pi coding-agent `pi install` package.
- Extension, document and task names remain stable across process restarts.
- A child may not recursively receive the same subagent extension.
- Foreground execution is replay-safe through owner lookup and a stable request ID.
- Background management actions remain replay-unsafe because repeating `stop` can affect newer work.

## Review Focus

- Duplicate foreground execution must reuse the same child and submission.
- A background spawn with a duplicate name must preserve the existing child.
- Missing action arguments must return useful tool results instead of throwing.
- Background reports must be submitted exactly once after restart or replay.
- Child configuration must remove the extension that created it.

---

### Task 1: Foreground extension

**Files:**

- Create: `src/foreground.ts`
- Create: `src/shared.ts`
- Test: `test/foreground.test.ts`

**Interfaces:**

- Produces: `ForegroundSubagents`, an installable Pi Durable `Extension` with a `subagent` tool.

- [x] Write an integration test in which a parent delegates, a child answers, and the parent receives the tool result.
- [x] Run `npm test -- test/foreground.test.ts` and verify it fails because the export is missing.
- [x] Implement answer extraction, child creation, extension removal, stable request ID and tool details.
- [x] Run the focused test and verify it passes.

### Task 2: Background extension

**Files:**

- Create: `src/background.ts`
- Test: `test/background.test.ts`

**Interfaces:**

- Produces: `BackgroundSubagents`, `BackgroundSubagentsDoc`, and named spawn/send/stop/status behavior.
- Consumes: shared answer-text extraction from Task 1.

- [x] Write integration tests for spawn/report, duplicate name, missing arguments and status.
- [x] Run `npm test -- test/background.test.ts` and verify failures identify missing exports.
- [x] Implement the background anchor, Reporter task, state document and management tool.
- [x] Run focused tests and verify they pass.

### Task 3: Package surface and examples

**Files:**

- Create: `src/index.ts`
- Create: `examples/foreground.ts`
- Create: `examples/background.ts`
- Create: `README.md`
- Create: `package.json`
- Create: `tsconfig.json`

**Interfaces:**

- Produces: npm exports, documented installation with `registry.install(...)`, and runnable examples.

- [x] Add package metadata and TypeScript configuration.
- [x] Export both extensions and their public state types.
- [x] Add one runnable example for each article.
- [x] Document the choice between foreground and background and the restart requirement.
- [x] Run `npm run typecheck`, `npm test`, and `npm run build`.
