import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** 通知开关状态：全局开关 + 按 agent 开关，生效规则为「全局开 或 该 agent 开」。 */
export const notifyStateSchema = z.object({
  globalEnabled: z.boolean(),
  agents: z.record(z.string(), z.boolean()),
});

export type NotifyState = z.output<typeof notifyStateSchema>;

const stateOutput = notifyStateSchema;

// RPC 名称只允许小写字母、数字、点、下划线、连字符（daemon 端 defineRpc 的校验规则）。
export const notifyStateGet = defineRpc({
  name: "notify.state.get",
  input: z.object({}),
  output: stateOutput,
});

export const notifyStateSetGlobal = defineRpc({
  name: "notify.state.set-global",
  input: z.object({
    enabled: z.boolean(),
    /** `/notify off` 时置 true，同时清空所有按 agent 开关。 */
    clearAgents: z.boolean(),
  }),
  output: stateOutput,
});

export const notifyStateSetAgent = defineRpc({
  name: "notify.state.set-agent",
  input: z.object({
    agentId: z.string(),
    enabled: z.boolean(),
  }),
  output: stateOutput,
});

export const notifyTestSend = defineRpc({
  name: "notify.test-send",
  input: z.object({}),
  output: z.object({
    results: z.array(
      z.object({
        channel: z.string(),
        ok: z.boolean(),
        /** 发送失败的错误信息。 */
        error: z.string().optional(),
        /** 渠道被跳过：未配置或开关关闭。 */
        skipped: z.boolean().optional(),
        /** 跳过原因：not-configured（配置不全）或 disabled（开关关闭）。 */
        reason: z.string().optional(),
      }),
    ),
  }),
});

export const notifyTelegramProbe = defineRpc({
  name: "notify.telegram-probe",
  input: z.object({ token: z.string() }),
  output: z.object({
    chats: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
      }),
    ),
    error: z.string().optional(),
  }),
});
