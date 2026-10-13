import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  type AssistantMessage,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  AssistantEntry,
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  BackgroundSubagents,
  BackgroundSubagentsDoc,
} from "../src/index.js";

const context = BACKGROUND_CONTEXT;

function messageText(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

async function answerText(
  root: Awaited<ReturnType<Harness["root"]>>,
  content: string,
): Promise<string> {
  const settled = await (
    await root.submit({ type: "input", content }, context)
  ).wait(context);
  assert.equal(settled.status, "done");
  assert.equal(settled.type, "input");
  if (settled.status !== "done" || settled.type !== "input") return "";
  const entry = await root.commit(
    (tx) => tx.entry(AssistantEntry, settled.answer),
    context,
  );
  return messageText(entry?.model?.[0] as AssistantMessage | undefined);
}

test("background subagent stores a named child and reports one answer", async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast(
      (message) => message.role !== "system",
    );
    assert.ok(last);
    const content =
      typeof last.content === "string"
        ? last.content
        : last.content
            .flatMap((part) => ("text" in part ? [part.text] : []))
            .join("");

    if (last.role === "toolResult") {
      return fauxAssistantMessage([fauxText(`Tool result: ${content}`)]);
    }
    if (content.includes("Start researcher")) {
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", {
            action: "spawn",
            name: "researcher",
            message: "Find one AI update.",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
    if (content.includes("Find one AI update")) {
      return fauxAssistantMessage([fauxText("A verified AI update.")]);
    }
    return fauxAssistantMessage([fauxText("Noted.")]);
  };
  faux.setResponses(Array.from({ length: 12 }, () => route));

  const registry = createRegistry();
  registry.install(BackgroundSubagents);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );

  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    await answerText(root, "Start researcher.");

    const reporters =
      (await harness.snapshot(BackgroundSubagentsDoc, root.id, context))
        ?.reporters ?? {};
    for (const reporterId of Object.values(reporters)) {
      await harness.waitForTask(reporterId, context);
    }
    await root.waitForIdle(context);

    const state = await harness.snapshot(
      BackgroundSubagentsDoc,
      root.id,
      context,
    );
    assert.ok(state?.agents.researcher);
    assert.equal(state.agents.researcher.reported.length, 1);
  } finally {
    await harness.close(context);
  }
});

test("background tool reports missing names and an empty status", async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast(
      (message) => message.role !== "system",
    );
    assert.ok(last);
    const text =
      typeof last.content === "string"
        ? last.content
        : last.content
            .flatMap((part) => ("text" in part ? [part.text] : []))
            .join("");
    if (last.role === "toolResult") {
      return fauxAssistantMessage([fauxText(text)]);
    }
    if (text.includes("missing name")) {
      return fauxAssistantMessage(
        [fauxToolCall("subagent", { action: "spawn", message: "work" })],
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(
      [fauxToolCall("subagent", { action: "status" })],
      { stopReason: "toolUse" },
    );
  };
  faux.setResponses(Array.from({ length: 8 }, () => route));

  const registry = createRegistry();
  registry.install(BackgroundSubagents);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );

  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    assert.equal(await answerText(root, "Try spawning with a missing name."), "spawn needs a name.");
    assert.equal(await answerText(root, "Show status."), "No subagents.");
  } finally {
    await harness.close(context);
  }
});

test("spawning a duplicate name preserves the original child", async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast(
      (message) => message.role !== "system",
    );
    assert.ok(last);
    const text =
      typeof last.content === "string"
        ? last.content
        : last.content
            .flatMap((part) => ("text" in part ? [part.text] : []))
            .join("");
    if (last.role === "toolResult") {
      return fauxAssistantMessage([fauxText(text)]);
    }
    if (text.includes("Start reader again")) {
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", {
            action: "spawn",
            name: "reader",
            message: "Duplicate work.",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
    if (text.includes("Start reader")) {
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", {
            action: "spawn",
            name: "reader",
            message: "Original work.",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage([fauxText("Child answer.")]);
  };
  faux.setResponses(Array.from({ length: 16 }, () => route));

  const registry = createRegistry();
  registry.install(BackgroundSubagents);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );

  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    await answerText(root, "Start reader.");
    const first = await harness.snapshot(
      BackgroundSubagentsDoc,
      root.id,
      context,
    );
    const originalId = first?.agents.reader?.conversationId;
    assert.ok(originalId);

    const duplicateResult = await answerText(root, "Start reader again.");
    const second = await harness.snapshot(
      BackgroundSubagentsDoc,
      root.id,
      context,
    );

    assert.match(duplicateResult, /already exists/);
    assert.equal(second?.agents.reader?.conversationId, originalId);
  } finally {
    await harness.close(context);
  }
});

test("a background reporter resumes after the harness reopens", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-durable-subagents-test-"));
  const database = join(directory, "session.sqlite");
  const faux = fauxProvider({ tokensPerSecond: 100 });
  const models = createModels();
  models.setProvider(faux.provider);

  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast(
      (message) => message.role !== "system",
    );
    assert.ok(last);
    const text =
      typeof last.content === "string"
        ? last.content
        : last.content
            .flatMap((part) => ("text" in part ? [part.text] : []))
            .join("");
    if (last.role === "toolResult") {
      return fauxAssistantMessage([fauxText(text)]);
    }
    if (text.includes("Start slow reader")) {
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", {
            action: "spawn",
            name: "reader",
            message: "Produce a long report.",
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
    if (text.includes("Produce a long report")) {
      return fauxAssistantMessage([
        fauxText(Array.from({ length: 120 }, () => "report").join(" ")),
      ]);
    }
    return fauxAssistantMessage([fauxText("Report received.")]);
  };
  faux.setResponses(Array.from({ length: 16 }, () => route));

  const registry = createRegistry();
  registry.install(BackgroundSubagents);
  const open = async () => {
    const harness = await Harness.open(
      await openNodeSqliteStorage(database),
      { models, registry },
      context,
    );
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    return { harness, root };
  };

  try {
    let { harness, root } = await open();
    await answerText(root, "Start slow reader.");
    const before = await harness.snapshot(
      BackgroundSubagentsDoc,
      root.id,
      context,
    );
    const reporterIds = Object.values(before?.reporters ?? {});
    assert.equal(reporterIds.length, 1);
    await harness.close(context);

    ({ harness, root } = await open());
    for (const reporterId of reporterIds) {
      await harness.waitForTask(reporterId, context);
    }
    await root.waitForIdle(context);

    const after = await harness.snapshot(
      BackgroundSubagentsDoc,
      root.id,
      context,
    );
    assert.equal(after?.agents.reader?.reported.length, 1);
    await harness.close(context);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
