import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * 插件配置（host 作用域 settings）：通知渠道参数与通知行为。
 * 每个字段独立 `.catch()` 兜底，单个别名值不会让整份配置失效。
 * 渠道投递规则：开关开启 且 配置齐全（飞书 = webhookUrl 非空；
 * Telegram = botToken 与 chatId 都非空）。开关默认开启，作为暂停推送用，
 * 关闭时配置保留。
 */
export const notifySettingsSchema = z.object({
  webhookUrl: z.string().catch(""),
  secret: z.string().catch(""),
  telegramBotToken: z.string().catch(""),
  telegramChatId: z.string().catch(""),
  feishuEnabled: z.boolean().catch(true),
  telegramEnabled: z.boolean().catch(true),
  minDurationSeconds: z.number().int().min(0).max(3600).catch(60),
  notifyOnFailed: z.boolean().catch(true),
  notifyOnPermission: z.boolean().catch(true),
  /** 消息标题前缀：多台设备/多个机器人同时推送时用来区分来源，空串表示不加。 */
  titlePrefix: z.string().max(20).catch(""),
});

export type NotifySettings = z.output<typeof notifySettingsSchema>;

export const NOTIFY_SETTINGS = defineSettings({
  id: "notify",
  scope: "host",
  version: 1,
  schema: notifySettingsSchema,
});
