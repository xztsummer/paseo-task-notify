import type { PluginClientContext } from "@getpaseo/plugin/client";
import { broadcastNotifyState } from "./client/state-broadcast.client";
import { contributeNotifyPills } from "./client/pills.client";
import { NotifySettingsScreen } from "./client/settings.client";
import { notifyStateGet, notifyStateSetGlobal } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "notify-settings",
    title: "设置",
    icon: "Bell",
    Component: NotifySettingsScreen,
  });

  client.addCommandCenterItem({
    id: "notify-toggle",
    title: "切换任务通知（全局）",
    icon: "Bell",
    keywords: ["notify", "notification", "任务通知", "通知", "bell", "feishu", "telegram"],
    context: "workspace",
    async onSelect({ rpc }) {
      const current = await rpc(notifyStateGet, {});
      const next = await rpc(notifyStateSetGlobal, {
        enabled: !current.globalEnabled,
        clearAgents: false,
      });
      broadcastNotifyState(next);
    },
  });

  client.addSlashCommand({
    name: "notify",
    description: "任务完成通知开关：on 开启 / off 全部关闭 / status 查看状态",
    argumentHint: "[on|off|status]",
    context: "workspace",
    async onSubmit({ args, rpc, openSettings }) {
      const command = args.trim().toLowerCase();
      if (command === "on" || command === "off") {
        const next = await rpc(notifyStateSetGlobal, {
          enabled: command === "on",
          clearAgents: command === "off",
        });
        broadcastNotifyState(next);
      }
      // 命令本身没有成功提示界面，打开设置页让当前状态可见。
      openSettings("notify-settings");
    },
  });

  const removePills = contributeNotifyPills(client);
  return () => {
    removePills();
  };
}
