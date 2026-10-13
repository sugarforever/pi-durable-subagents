import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import {
  BackgroundSubagents,
  BackgroundSubagentsDoc,
} from "../src/index.js";

const context = BACKGROUND_CONTEXT;
const models = createModels();
models.setProvider(openaiProvider());

const registry = createRegistry();
registry.install(BackgroundSubagents);

const harness = await Harness.open(
  new MemoryStorage(),
  { models, registry },
  context,
);

try {
  const root = await harness.root(context, {
    agent: {
      model: { provider: "openai", modelId: "gpt-6-sol" },
      instructions:
        "Use the subagent tool to start and manage named background researchers.",
    },
  });

  await (
    await root.submit(
      {
        type: "input",
        content:
          "Start a background subagent named researcher. Ask it to summarize the latest AI news I provide next.",
      },
      context,
    )
  ).wait(context);

  const reporters =
    (await harness.snapshot(BackgroundSubagentsDoc, root.id, context))
      ?.reporters ?? {};
  for (const reporterId of Object.values(reporters)) {
    await harness.waitForTask(reporterId, context);
  }
  await root.waitForIdle(context);
} finally {
  await harness.close(context);
}
