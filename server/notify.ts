import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
// Derived rather than imported: `PaseoApi` lives in `@getpaseo/client`, and the
// compiler rejects a plugin server bundle that imports that specifier directly.
type PaseoApi = PluginHandlerContext["paseo"];
import {
  notifyStateGet,
  notifyStateSetAgent,
  notifyStateSetGlobal,
  notifyTelegramProbe,
  notifyTestSend,
  type NotifyState,
} from "../shared/contracts";
import { NOTIFY_SETTINGS, notifySettingsSchema, type NotifySettings } from "../shared/settings";
import { sendFeishu } from "./feishu";
import { agentEnabled, readState, writeState } from "./state";
import { probeTelegramChats, sendTelegram } from "./telegram";
import { TurnTracker } from "./turns";

/** 消息摘要与错误信息最多保留的字符数。 */
const SUMMARY_LIMIT = 400;
/** 已通知权限请求 id 的内存去重上限，防止集合无限增长。 */
const NOTIFIED_PERMISSIONS_KEPT = 500;

const permissionKindLabels: Record<string, string> = {
  tool: "工具调用",
  plan: "计划确认",
  question: "等待回答",
  mode: "模式变更",
  other: "确认请求",
};

interface TimelineItemLike {
  type: string;
  text?: unknown;
}

function agentLabel(agent: { id: string; title: string | null }): string {
  return agent.title?.trim() || `Agent ${agent.id.slice(0, 8)}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

/** 从时间线条目里找最后一条带文本的助手消息。 */
function summaryFromItems(items: readonly TimelineItemLike[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "assistant_message" && typeof item.text === "string" && item.text.trim()) {
      return truncate(item.text.trim(), SUMMARY_LIMIT);
    }
  }
  return undefined;
}

/** 从时间线尾部再取一页，作为 hook 自带 timeline 为空时的摘要来源。 */
async function fetchSummaryFromTimeline(paseo: PaseoApi, agentId: string): Promise<string | undefined> {
  const page = await paseo.agents.ref(agentId).timeline.refetch({
    direction: "tail",
    projection: "projected",
    limit: 20,
  });
  if (page.error) return undefined;
  return summaryFromItems(page.entries.map((entry) => entry.item as TimelineItemLike));
}

function permissionDescription(request: {
  name: string;
  kind: string;
  title?: string;
  description?: string;
}): string {
  const heading = request.title?.trim() || request.description?.trim();
  if (heading) return truncate(heading, SUMMARY_LIMIT);
  const kindLabel = permissionKindLabels[request.kind] ?? request.kind;
  return request.name ? `${kindLabel}：${request.name}` : kindLabel;
}

/** 标题前缀：多台设备/多个机器人同时推送时区分来源，为空则原样返回。 */
function withTitlePrefix(config: NotifySettings, title: string): string {
  const prefix = config.titlePrefix.trim();
  return prefix ? `[${prefix}] ${title}` : title;
}

/** 注册服务端全部贡献：生命周期钩子、开关状态 RPC、配置 settings。 */
export function registerNotifyServer(server: PluginServerContext): () => void {
  const settings = server.registerSettings(NOTIFY_SETTINGS);
  const turns = new TurnTracker();
  const notifiedPermissions = new Set<string>();

  // 状态写操作排队执行，避免并发的读-改-写互相覆盖。
  let stateWrites: Promise<unknown> = Promise.resolve();
  function enqueueStateWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = stateWrites.then(task, task);
    stateWrites = result.catch(() => undefined);
    return result;
  }

  async function readConfig(): Promise<NotifySettings> {
    const state = await settings.read();
    return state.status === "ready" ? state.values : notifySettingsSchema.parse({});
  }

  /** 渠道启用规则：飞书 = webhookUrl 非空；Telegram = botToken 与 chatId 都非空。 */
  function telegramConfigured(config: NotifySettings): boolean {
    return config.telegramBotToken.trim() !== "" && config.telegramChatId.trim() !== "";
  }

  /** 向所有「开关开启且配置齐全」的渠道并行投递；单渠道失败只记日志，不影响其他渠道与钩子链。 */
  async function deliver(config: NotifySettings, title: string, text: string): Promise<void> {
    const sends: Array<{ channel: string; run: Promise<void> }> = [];
    if (config.webhookUrl && config.feishuEnabled) {
      sends.push({ channel: "feishu", run: sendFeishu(config, { title, text }) });
    }
    if (telegramConfigured(config) && config.telegramEnabled) {
      sends.push({
        channel: "telegram",
        run: sendTelegram(
          { botToken: config.telegramBotToken, chatId: config.telegramChatId },
          { title, text },
        ),
      });
    }
    if (sends.length === 0) {
      console.log(`[paseo-task-notify] no channel enabled, message dropped: ${title}`);
      return;
    }
    await Promise.all(
      sends.map(async ({ channel, run }) => {
        try {
          await run;
          console.log(`[paseo-task-notify] sent via ${channel}: ${title}`);
        } catch (error) {
          // stderr 不进插件日志，统一走 stdout 才可见。
          const detail = error instanceof Error ? error.message : String(error);
          console.log(`[paseo-task-notify] ${channel} send failed: ${detail}`);
        }
      }),
    );
  }

  const removeTurnStarted = server.on("agent.turn_started", ({ agent, turnId }) => {
    if (turnId) turns.start(agent.id, turnId);
  });

  const removeTurnEnded = server.on("agent.turn_ended", async (event, context) => {
    const { agent, turnId, outcome } = event;
    console.log(
      `[paseo-task-notify] turn_ended: agent=${agent.id} parent=${agent.parentAgentId ?? "none"} outcome=${outcome.kind}`,
    );
    // 子代理的回合结束不通知：只关心主任务的最终结果。
    if (agent.parentAgentId != null) return;
    // 用户主动取消的回合不需要通知。
    if (outcome.kind === "canceled") return;
    const state = await readState();
    if (!agentEnabled(state, agent.id)) return;
    const config = await readConfig();
    if (outcome.kind === "failed" && !config.notifyOnFailed) return;
    const startedAt = turnId ? turns.end(agent.id, turnId) : undefined;
    // 短任务通常人还盯着屏幕，通知没有意义。
    if (startedAt !== undefined && Date.now() - startedAt < config.minDurationSeconds * 1000) {
      console.log(
        `[paseo-task-notify] dropped by duration: ${Math.round((Date.now() - startedAt) / 1000)}s < ${config.minDurationSeconds}s`,
      );
      return;
    }
    console.log(
      `[paseo-task-notify] delivering: minDuration=${config.minDurationSeconds}s feishu=${config.feishuEnabled} telegram=${config.telegramEnabled}`,
    );

    let summary = summaryFromItems(event.timeline as readonly TimelineItemLike[]);
    if (!summary) {
      try {
        summary = await fetchSummaryFromTimeline(context.paseo, agent.id);
      } catch {
        // 摘要取不到不影响通知本身。
      }
    }

    const lines: string[] = [];
    if (outcome.kind === "failed") {
      const message = outcome.error?.message?.trim() || "未知错误";
      lines.push(`错误：${truncate(message, SUMMARY_LIMIT)}`);
    }
    if (summary) lines.push(summary);
    if (startedAt !== undefined) lines.push(`⏱ 用时 ${formatDuration(Date.now() - startedAt)}`);
    const title = withTitlePrefix(
      config,
      outcome.kind === "failed"
        ? `❌ 任务失败 · ${agentLabel(agent)}`
        : `✅ 任务完成 · ${agentLabel(agent)}`,
    );
    await deliver(config, title, lines.join("\n\n") || "（无内容）");
  });

  const removePermissionRequested = server.on("agent.permission_requested", async (event) => {
    const { agent, request } = event;
    if (agent.parentAgentId != null) return;
    // 先去重再走异步门控，避免并发触发重复通知。
    if (notifiedPermissions.has(request.id)) return;
    notifiedPermissions.add(request.id);
    if (notifiedPermissions.size > NOTIFIED_PERMISSIONS_KEPT) {
      const oldest = notifiedPermissions.values().next().value;
      if (oldest !== undefined) notifiedPermissions.delete(oldest);
    }
    const config = await readConfig();
    if (!config.notifyOnPermission) return;
    const state = await readState();
    if (!agentEnabled(state, agent.id)) return;
    const title = withTitlePrefix(config, `⏸ 等待授权 · ${agentLabel(agent)}`);
    const text = `${permissionDescription(request)}\n\n任务已暂停，等待你确认后继续。`;
    await deliver(config, title, text);
  });

  const removePermissionResolved = server.on("agent.permission_resolved", ({ requestId }) => {
    notifiedPermissions.delete(requestId);
  });

  const removeAgentArchived = server.on("agent.archived", ({ agent }) => {
    turns.clearAgent(agent.id);
  });

  server.handle(notifyStateGet, () => readState());

  server.handle(notifyStateSetGlobal, ({ enabled, clearAgents }) =>
    enqueueStateWrite(async (): Promise<NotifyState> => {
      const state = await readState();
      const next: NotifyState = { globalEnabled: enabled, agents: clearAgents ? {} : state.agents };
      await writeState(next);
      return next;
    }),
  );

  server.handle(notifyStateSetAgent, ({ agentId, enabled }) =>
    enqueueStateWrite(async (): Promise<NotifyState> => {
      const state = await readState();
      const agents = { ...state.agents };
      if (enabled) agents[agentId] = true;
      else delete agents[agentId];
      const next: NotifyState = { globalEnabled: state.globalEnabled, agents };
      await writeState(next);
      return next;
    }),
  );

  server.handle(notifyTestSend, async () => {
    const config = await readConfig();
    const results: Array<{
      channel: string;
      ok: boolean;
      error?: string;
      skipped?: boolean;
      reason?: string;
    }> = [];
    /** 与 deliver 相同的规则：开关开启且配置齐全才真正发送。 */
    async function runChannel(
      channel: string,
      configured: boolean,
      enabled: boolean,
      send: () => Promise<void>,
    ): Promise<void> {
      if (!configured) {
        results.push({ channel, ok: false, skipped: true, reason: "not-configured" });
        return;
      }
      if (!enabled) {
        results.push({ channel, ok: false, skipped: true, reason: "disabled" });
        return;
      }
      try {
        await send();
        results.push({ channel, ok: true });
      } catch (error) {
        results.push({
          channel,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // 并行测试，一个渠道超时不拖累另一个。
    await Promise.all([
      runChannel("feishu", config.webhookUrl !== "", config.feishuEnabled, () =>
        sendFeishu(config, {
          title: withTitlePrefix(config, "🔔 测试消息"),
          text: "paseo-task-notify 与飞书的连接正常。",
        }),
      ),
      runChannel("telegram", telegramConfigured(config), config.telegramEnabled, () =>
        sendTelegram(
          { botToken: config.telegramBotToken, chatId: config.telegramChatId },
          {
            title: withTitlePrefix(config, "🔔 测试消息"),
            text: "paseo-task-notify 与 Telegram 的连接正常。",
          },
        ),
      ),
    ]);
    return { results };
  });

  server.handle(notifyTelegramProbe, ({ token }) => probeTelegramChats(token));

  return () => {
    removeTurnStarted();
    removeTurnEnded();
    removePermissionRequested();
    removePermissionResolved();
    removeAgentArchived();
  };
}
