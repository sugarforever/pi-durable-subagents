import assert from "node:assert/strict";
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
import { ForegroundSubagents } from "../src/index.js";

const context = BACKGROUND_CONTEXT;

function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

test("foreground subagent returns the child answer to the parent", async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("subagent", { task: "Name three prime numbers." })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([fauxText("2, 3, and 5.")]),
    fauxAssistantMessage([fauxText("The child answered: 2, 3, and 5.")]),
  ] satisfies FauxResponseStep[]);

  const registry = createRegistry();
  registry.install(ForegroundSubagents);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry },
    context,
  );

  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const submission = await root.submit(
      { type: "input", content: "Delegate the prime-number task." },
      context,
    );
    const settled = await submission.wait(context);

    assert.equal(settled.status, "done");
    assert.equal(settled.type, "input");
    if (settled.status !== "done" || settled.type !== "input") return;

    const entry = await root.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    assert.equal(
      textOf(entry?.model?.[0] as AssistantMessage | undefined),
      "The child answered: 2, 3, and 5.",
    );
  } finally {
    await harness.close(context);
  }
});
