import { createHmac } from "node:crypto";
import { fetchWithTimeout } from "./http";

export interface FeishuMessage {
  title: string;
  text: string;
}

export interface FeishuConfig {
  webhookUrl: string;
  secret: string;
}

/** 飞书自定义机器人的签名：以 “{timestamp}\n{secret}” 为 key、空串为消息的 HMAC-SHA256，base64 输出。 */
function sign(secret: string, timestamp: number): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

/**
 * 发送一条 post 富文本消息到飞书自定义机器人。
 * secret 非空时附加 timestamp + sign 签名字段；失败抛错，由调用方记录日志。
 */
export async function sendFeishu(config: FeishuConfig, message: FeishuMessage): Promise<void> {
  if (!config.webhookUrl) {
    throw new Error("webhook URL is not configured");
  }
  const body: Record<string, unknown> = {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: message.title,
          content: [[{ tag: "text", text: message.text }]],
        },
      },
    },
  };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = sign(config.secret, timestamp);
  }
  const response = await fetchWithTimeout(config.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
  if (!result || typeof result.code !== "number") {
    throw new Error(`feishu webhook returned HTTP ${response.status} without a code`);
  }
  if (result.code !== 0) {
    throw new Error(`feishu error ${result.code}: ${result.msg ?? "unknown"}`);
  }
}
