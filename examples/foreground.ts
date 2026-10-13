import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  createRegistry,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { ForegroundSubagents } from "../src/index.js";

const context = BACKGROUND_CONTEXT;
const models = createModels();
models.setProvider(openaiProvider());

const registry = createRegistry();
registry.install(ForegroundSubagents);

const harness = await Harness.open(
  new MemoryStorage(),
  {
    models,
    registry,
    settings: { toolExecution: "parallel" },
  },
  context,
);

try {
  const root = await harness.root(context, {
    agent: {
      model: { provider: "openai", modelId: "gpt-6-sol" },
      instructions:
        "Use the subagent tool for independent investigations. Compare all returned results before answering.",
    },
  });

  const submission = await root.submit(
    {
      type: "input",
      content:
        "Ask two subagents to review this design: one for failure modes and one for unnecessary complexity.",
    },
    context,
  );
  console.log(await submission.wait(context));
} finally {
  await harness.close(context);
}
