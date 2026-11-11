import { fetchWithTimeout } from "./http";

/** Telegram 单条消息的字符数上限（官方为 4096，留余量）。 */
const MESSAGE_LIMIT = 4000;

/** Telegram Bot Token 的大致形态（数字:字母数字串），用于前置校验。 */
const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramMessage {
  title: string;
  text: string;
}

/** 按 Unicode 码点截断，避免把代理对（emoji）切成两半。 */
function truncateForTelegram(text: string): string {
  return [...text].slice(0, MESSAGE_LIMIT).join("");
}

/** 经 Telegram Bot API 的 sendMessage 发送纯文本消息；失败抛错，由调用方记录日志。 */
export async function sendTelegram(config: TelegramConfig, message: TelegramMessage): Promise<void> {
  const token = config.botToken.trim();
  const chatId = config.chatId.trim();
  if (!token || !chatId) {
    throw new Error("telegram bot token or chat id is not configured");
  }
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncateForTelegram(`${message.title}\n\n${message.text}`),
      disable_web_page_preview: true,
    }),
  });
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error_code?: number;
    description?: string;
  } | null;
  if (!result || result.ok !== true) {
    const detail = result?.description
      ? `${result.error_code ?? `HTTP ${response.status}`}: ${result.description}`
      : `HTTP ${response.status}`;
    throw new Error(`telegram error ${detail}`);
  }
}

/** 调 getUpdates 找出最近给机器人发过消息的会话，供设置页自动探测 Chat ID。 */
export async function probeTelegramChats(
  token: string,
): Promise<{ chats: Array<{ id: string; title: string }>; error?: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { chats: [], error: "请先填写 Bot Token" };
  if (!TOKEN_PATTERN.test(trimmed)) {
    return { chats: [], error: "Token 格式不像 Telegram Bot Token（应为 123456:ABC… 形式）" };
  }
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${trimmed}/getUpdates`, {
    method: "GET",
  });
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: Array<{
      message?: { chat?: { id?: number; title?: string; first_name?: string; username?: string } };
    }>;
  } | null;
  if (!result || result.ok !== true) {
    const detail = result?.description ?? `HTTP ${response.status}`;
    return { chats: [], error: `Telegram 返回错误：${detail}` };
  }
  const seen = new Map<string, string>();
  for (const update of result.result ?? []) {
    const chat = update.message?.chat;
    if (!chat || typeof chat.id !== "number") continue;
    const id = String(chat.id);
    if (seen.has(id)) continue;
    const title =
      chat.title?.trim() || chat.first_name?.trim() || (chat.username ? `@${chat.username}` : `会话 ${id}`);
    seen.set(id, title);
  }
  return { chats: [...seen].map(([id, title]) => ({ id, title })) };
}
