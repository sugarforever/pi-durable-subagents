import type { Context } from "@earendil-works/chord";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type EntryId,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";

export function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

export async function answerText(
  api: ToolExecutionApi,
  answer: EntryId,
  context: Context,
): Promise<string> {
  const entry = await api.commit(
    (tx) => tx.entry(AssistantEntry, answer),
    context,
  );
  return textOf(entry?.model?.[0] as AssistantMessage | undefined);
}
