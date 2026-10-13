import { Type } from "@earendil-works/pi-ai";
import {
  configure,
  defineExtension,
  defineTool,
  type Extension,
} from "@earendil-works/pi-durable";
import { answerText } from "./shared.js";

export const ForegroundSubagents: Extension = defineExtension({
  name: "foreground-subagents",
  tools: [
    defineTool({
      name: "subagent",
      description:
        "Delegate a self-contained task to a subagent and get its answer back.",
      parameters: Type.Object({
        task: Type.String({ description: "What the subagent should do" }),
      }),
      replay: "safe",
      execute: async ({ task }, api, context) => {
        const childId = await api.commit(async (tx) => {
          const existing = (
            await tx.scanConversations({ ownerTaskId: api.taskId }, 1)
          ).items[0];
          if (existing !== undefined) return existing.id;

          const child = await tx.createConversation({
            ownership: { kind: "task", taskId: api.taskId },
          });
          await configure(tx, child.id, {
            extensions: { remove: [ForegroundSubagents] },
            instructions:
              "Complete the delegated task and return a concise answer.",
          });
          return child.id;
        }, context);

        await api.details({ conversationId: childId }, context);
        const child = await api.conversation(childId, context);
        if (child === undefined) {
          throw new Error("Child conversation not found");
        }

        const submission = await child.submit(
          {
            type: "input",
            content: task,
            requestId: `subagent:${api.taskId}`,
          },
          context,
        );
        const settled = await submission.wait(context);
        if (settled.status !== "done" || settled.type !== "input") {
          throw new Error(`Subagent failed: ${settled.status}`);
        }

        return {
          output: [
            {
              type: "text" as const,
              text: await answerText(api, settled.answer, context),
            },
          ],
          details: { conversationId: childId },
        };
      },
    }),
  ],
});
