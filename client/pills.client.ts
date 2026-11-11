import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { notifyStateGet, notifyStateSetAgent, type NotifyState } from "../shared/contracts";
import { broadcastNotifyState, subscribeNotifyState } from "./state-broadcast.client";

/** 兜底轮询间隔：广播之外的刷新途径（宿主重连、插件重载后）。 */
const STATE_POLL_MS = 10_000;

/**
 * 为每个 agent 注册一个 composer 铃铛 pill：点亮 = 该 agent 的任务完成时通知。
 * 生效规则是「全局开 或 该 agent 开」，图标实时反映两者之一。
 */
export function contributeNotifyPills(client: PluginClientContext): () => void {
  const registrations = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let snapshot: NotifyState = { globalEnabled: false, agents: {} };
  let stopped = false;

  function effective(agentId: string): boolean {
    return snapshot.globalEnabled || snapshot.agents[agentId] === true;
  }

  function iconFor(agentId: string): "Bell" | "BellOff" {
    return effective(agentId) ? "Bell" : "BellOff";
  }

  function syncIcon(agentId: string): void {
    registrations.get(agentId)?.update({ icon: iconFor(agentId) });
  }

  function syncAllIcons(): void {
    for (const agentId of registrations.keys()) syncIcon(agentId);
  }

  async function refreshState(): Promise<void> {
    try {
      const state = await client.rpc(notifyStateGet, {});
      if (stopped) return;
      snapshot = state;
      syncAllIcons();
    } catch {
      // 宿主离线或插件重载中：保持现有图标，下次轮询再试。
    }
  }

  function register(agent: { id: string; workspaceId?: string | null }): void {
    if (stopped || lifetime.signal.aborted) return;
    const workspaceId = agent.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId === "") return;
    const agentId = agent.id;
    if (registrations.has(agentId)) return;
    const handle = client.addComposerPill({
      id: "notify",
      workspaceId,
      agentId,
      button: {
        title: "任务完成通知",
        icon: iconFor(agentId),
        label: "通知",
        behavior: {
          kind: "action",
          async onPress() {
            try {
              const state = await client.rpc(notifyStateSetAgent, {
                agentId,
                enabled: !effective(agentId),
              });
              snapshot = state;
              broadcastNotifyState(state);
              syncIcon(agentId);
            } catch (error) {
              console.error("[paseo-task-notify] toggle failed", error);
            }
          },
        },
      },
    });
    registrations.set(agentId, handle);
  }

  function unregister(agentId: string): void {
    registrations.get(agentId)?.remove();
    registrations.delete(agentId);
  }

  // 订阅 agent 目录：快照给出全部 agent，之后增量更新。
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot({ entries }) {
          if (stopped) return;
          // 快照重放即完整目录：先清空再按当前目录重建。
          for (const agentId of [...registrations.keys()]) unregister(agentId);
          for (const entry of entries) register(entry.agent);
        },
        update(message) {
          if (stopped || message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") unregister(update.agentId);
          else register(update.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("[paseo-task-notify] agent observation failed", error);
    });

  // 其他入口（/notify、命令中心、设置页）切换开关时立即刷新图标。
  const unsubscribe = subscribeNotifyState((state) => {
    snapshot = state;
    syncAllIcons();
  });

  void refreshState();
  const poll = setInterval(() => void refreshState(), STATE_POLL_MS);

  return () => {
    stopped = true;
    lifetime.abort();
    clearInterval(poll);
    unsubscribe();
    for (const handle of registrations.values()) handle.remove();
    registrations.clear();
  };
}
