import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  type ConversationId,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  type EntryId,
  type Extension,
  LiveDoc,
  type TaskId,
} from "@earendil-works/pi-durable";
import { textOf } from "./shared.js";

export type BackgroundSubagentRecord = {
  conversationId: ConversationId;
  reported: EntryId[];
};

export type BackgroundSubagentsState = {
  agents: Record<string, BackgroundSubagentRecord>;
  reporters: Record<string, TaskId>;
};

export const BackgroundSubagentsDoc = defineDoc<BackgroundSubagentsState>({
  kind: "pi-durable-subagents.background",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ agents: {}, reporters: {} }),
});

const BackgroundAnchor = defineTask<null, { phase: "done" }, null>({
  name: "pi-durable-subagents.anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_anchor, runtime, context) =>
      runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        context,
      ),
  },
  abort: (_anchor, runtime, context) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      context,
    ),
});

type ReporterInput = {
  name: string;
  conversationId: ConversationId;
  message: string;
  followUp: boolean;
};

type ReporterState =
  | { phase: "deliver" }
  | { phase: "report"; report?: string };

const Reporter = defineTask<ReporterInput, ReporterState, null>({
  name: "pi-durable-subagents.reporter",
  version: 1,
  initial: () => ({ phase: "deliver" }),
  phases: {
    deliver: async (reporter, runtime, context) => {
      const { name, conversationId, message, followUp } = reporter.input;
      const child = await runtime.conversation(conversationId, context);
      if (child === undefined) {
        throw new Error(`Subagent conversation not found: ${conversationId}`);
      }

      const submission = await child.submit(
        {
          type: "input",
          content: message,
          whenBusy: followUp ? "followUp" : "steer",
          requestId: `subagent:${reporter.id}`,
        },
        context,
      );
      const settled = await submission.wait(context);

      await runtime.commit(async (tx) => {
        const next = (report?: string) => ({
          status: "running" as const,
          checkpoint:
            report === undefined
              ? ({ phase: "report" } as const)
              : ({ phase: "report", report } as const),
        });

        if (settled.status === "unanswered") {
          return next(
            settled.reason === "aborted"
              ? undefined
              : `[subagent ${name} failed: ${settled.reason}]`,
          );
        }
        if (settled.type !== "input") return next();

        const state = await tx.doc(
          BackgroundSubagentsDoc,
          runtime.conversationId,
        );
        const agent = state.agents[name];
        if (agent === undefined || agent.reported.includes(settled.answer)) {
          return next();
        }

        agent.reported.push(settled.answer);
        const answer = (await tx.entry(AssistantEntry, settled.answer))
          ?.model?.[0] as AssistantMessage | undefined;
        return next(
          `[subagent ${name} answered, no reply needed] ${textOf(answer)}`,
        );
      }, context);
    },
    report: async (reporter, runtime, context) => {
      const report = reporter.state.checkpoint.report;
      if (report !== undefined) {
        const main = await runtime.conversation(runtime.conversationId, context);
        if (main === undefined) {
          throw new Error("Parent conversation not found");
        }
        await main.submit(
          {
            type: "input",
            content: report,
            whenBusy: "followUp",
            requestId: `subagent-report:${reporter.id}`,
          },
          context,
        );
      }
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "completed", result: null },
        }),
        context,
      );
    },
  },
  abort: (_reporter, runtime, context) =>
    runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      context,
    ),
});

const backgroundTool = defineTool({
  name: "subagent",
  description:
    "Manage persistent background subagents. Actions: spawn, send, stop, and status.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("spawn"),
      Type.Literal("send"),
      Type.Literal("stop"),
      Type.Literal("status"),
    ]),
    name: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    followUp: Type.Optional(Type.Boolean()),
  }),
  replay: "unsafe",
  execute: async ({ action, name, message, followUp }, api, context) => {
    const reply = (text: string, conversationId?: ConversationId) => ({
      output: [{ type: "text" as const, text }],
      ...(conversationId === undefined || name === undefined
        ? {}
        : { details: { name, conversationId } }),
    });

    const state =
      (await api.snapshot(
        BackgroundSubagentsDoc,
        api.conversationId,
        context,
      )) ?? { agents: {}, reporters: {} };

    if (action === "status") {
      const names = name === undefined ? Object.keys(state.agents) : [name];
      const lines: string[] = [];
      for (const each of names) {
        const found = Object.hasOwn(state.agents, each)
          ? state.agents[each]
          : undefined;
        if (found === undefined) continue;
        const busy =
          (await api.snapshot(LiveDoc, found.conversationId, context))?.run !==
          undefined;
        lines.push(`${each}: ${busy ? "working" : "idle"}`);
      }
      return reply(lines.length === 0 ? "No subagents." : lines.join("\n"));
    }

    if (name === undefined) return reply(`${action} needs a name.`);
    const existing = Object.hasOwn(state.agents, name)
      ? state.agents[name]
      : undefined;
    if (action !== "spawn" && existing === undefined) {
      return reply(`No subagent named ${name}.`);
    }

    if (action === "stop") {
      const child = await api.conversation(existing!.conversationId, context);
      await child?.abort(context);
      return reply(`Stopped ${name}.`, existing!.conversationId);
    }

    if (message === undefined) return reply(`${action} needs a message.`);

    const result = await api.commit(async (tx) => {
      const current = await tx.doc(
        BackgroundSubagentsDoc,
        api.conversationId,
      );
      const background = {
        ownership: { kind: "conversation" },
        background: true,
      } as const;

      if (action === "spawn") {
        if (Object.hasOwn(current.agents, name)) {
          return `${name} already exists; use send.`;
        }
        const anchor = await tx.createTask(BackgroundAnchor, null, background);
        const child = await tx.createConversation({
          ownership: { kind: "task", taskId: anchor },
        });
        await configure(tx, child.id, {
          extensions: { remove: [BackgroundSubagents] },
          instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
        });
        current.agents[name] = { conversationId: child.id, reported: [] };
      }

      const conversationId = current.agents[name]!.conversationId;
      const input: ReporterInput = {
        name,
        conversationId,
        message,
        followUp: action === "send" && followUp === true,
      };
      current.reporters[api.taskId] = await tx.createTask(
        Reporter,
        input,
        background,
      );
      return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
    }, context);

    const current = (
      await api.snapshot(
        BackgroundSubagentsDoc,
        api.conversationId,
        context,
      )
    )?.agents[name];
    return reply(result, current?.conversationId);
  },
});

export const BackgroundSubagents: Extension = defineExtension({
  name: "background-subagents",
  tasks: [BackgroundAnchor, Reporter],
  tools: [backgroundTool],
});
