# Task completion notifications

Sends a message through Feishu (Lark) or Telegram when a top-level agent task finishes, fails, or waits for permission. Subagent turns and intermediate steps stay silent.

## How it works

The plugin subscribes to agent lifecycle events from the paseo daemon: the end of a top-level agent turn (completed or failed) and pending permission requests. Before sending, it checks the notification switches and the minimum task duration, takes the last assistant message of the turn as the summary, and delivers to every enabled channel. It runs as a plugin subprocess inside the daemon and needs no separate service.

## Setup

- Notification switches: notifications are off by default. The bell button beside the composer enables them for one agent. `/notify on` and `/notify off` switch every agent at once, and the command center (Ctrl+K) or the settings page can toggle the global switch.
- Feishu: enter the webhook URL of a custom bot in the settings page. The signing secret is optional.
- Telegram: enter a bot token from @BotFather and a chat id. Send the bot a message first; the settings page can detect the chat id for you.
- Channel switches: Feishu and Telegram each have an independent switch, on by default. A channel sends only when its switch is on and its configuration is complete. Turning a switch off pauses that channel and keeps its configuration.
- Behavior: choose whether to notify on failed tasks and on pending permission requests. Tasks that finish in less than the configured minimum (60 seconds by default) are not announced. The test button reports the result for each channel.
- Title prefix (up to 20 characters, empty by default): shown as `[prefix]` in message titles to tell apart several machines or bots that share one destination.

## Permissions and limits

The plugin sends HTTPS requests only to the configured Feishu webhook URL and the Telegram Bot API at api.telegram.org. It listens on no ports and reads no files other than its own settings. Configuration and switch state are stored in the paseo home and are not uploaded anywhere. When the daemon stops, the plugin stops with it, and no tasks run in that state. Requires paseo 0.14.0 or later with plugins enabled.
