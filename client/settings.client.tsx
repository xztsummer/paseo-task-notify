import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import {
  notifyStateGet,
  notifyStateSetGlobal,
  notifyTelegramProbe,
  notifyTestSend,
} from "../shared/contracts";
import { NOTIFY_SETTINGS, type NotifySettings } from "../shared/settings";
import { broadcastNotifyState } from "./state-broadcast.client";

const DURATION_MIN = 0;
const DURATION_MAX = 3600;

export function NotifySettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(NOTIFY_SETTINGS);
  const getState = useRpc(notifyStateGet);
  const setGlobal = useRpc(notifyStateSetGlobal);
  const sendTest = useRpc(notifyTestSend);
  const probeTelegram = useRpc(notifyTelegramProbe);

  const [draft, setDraft] = useState<NotifySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // settings 就绪后初始化一次表单草稿；之后由用户编辑，不被外部刷新覆盖。
  useEffect(() => {
    if (draft === null && settings.status === "ready") {
      setDraft(settings.values);
    }
  }, [draft, settings]);

  useEffect(() => {
    let cancelled = false;
    void getState({})
      .then((state) => {
        if (!cancelled) setGlobalEnabled(state.globalEnabled);
      })
      .catch(() => {
        // 读取失败时保持 null，界面显示「读取中」。
      });
    return () => {
      cancelled = true;
    };
  }, [getState]);

  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);

  if (settings.status === "loading" || settings.status === "error" || draft === null) {
    const message =
      settings.status === "error" ? `配置加载失败：${settings.error}` : "正在加载…";
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>{message}</Text>
      </View>
    );
  }
  if (settings.status === "invalid") {
    return (
      <View style={styles.screen}>
        <Text style={styles.errorText}>配置无效：{settings.error}</Text>
      </View>
    );
  }

  // 早退守卫之后 status 已收敛为 ready；把 revision 捕获为常量供闭包使用。
  const revision = settings.revision;

  async function saveDraft(): Promise<void> {
    if (draft === null) return;
    setBusy("save");
    setSaved(false);
    // save 永不抛错，失败以返回值表示。
    const ok = await settings.save(draft, revision);
    setBusy(null);
    setSaved(ok);
    if (!ok) setFeedback("保存失败（配置可能被其他界面修改），请重试。");
  }

  async function toggleGlobal(): Promise<void> {
    if (globalEnabled === null) return;
    setBusy("global");
    setFeedback(null);
    try {
      const state = await setGlobal({ enabled: !globalEnabled, clearAgents: false });
      setGlobalEnabled(state.globalEnabled);
      broadcastNotifyState(state);
    } catch (error) {
      setFeedback(`切换失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  const channelLabels: Record<string, string> = { feishu: "飞书", telegram: "Telegram" };

  async function runTestSend(): Promise<void> {
    setBusy("test");
    setFeedback(null);
    try {
      const result = await sendTest({});
      const lines = result.results.map((entry) => {
        const label = channelLabels[entry.channel] ?? entry.channel;
        if (entry.skipped) {
          const why = entry.reason === "disabled" ? "已关闭" : "未配置";
          return `${label}：${why}，跳过`;
        }
        return entry.ok ? `${label}：已发送 ✓` : `${label}：失败 — ${entry.error ?? "未知错误"}`;
      });
      setFeedback(lines.length > 0 ? lines.join("\n") : "没有任何渠道被测试。");
    } catch (error) {
      setFeedback(`发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runTelegramProbe(): Promise<void> {
    if (draft === null) return;
    setBusy("probe");
    setFeedback(null);
    try {
      const result = await probeTelegram({ token: draft.telegramBotToken });
      if (result.error) {
        setFeedback(`Chat ID 探测失败：${result.error}`);
      } else if (result.chats.length === 0) {
        setFeedback(
          "机器人还没有收到过消息：请先在 Telegram 里给它发送任意一条消息（如 /start），然后再点探测。",
        );
      } else if (result.chats.length === 1) {
        const chat = result.chats[0]!;
        setDraft((current) => (current ? { ...current, telegramChatId: chat.id } : current));
        setSaved(false);
        setFeedback(`已填入 Chat ID ${chat.id}（${chat.title}），点击「保存配置」生效。`);
      } else {
        const found = result.chats.map((chat) => `${chat.title}（${chat.id}）`).join("、");
        setFeedback(`发现多个会话：${found}。请把要接收通知的那个 Chat ID 填入输入框。`);
      }
    } catch (error) {
      setFeedback(`探测失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  const switchTrack = { true: theme.colors.accent, false: theme.colors.border };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>通知开关</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.text}>全局开关</Text>
            <Text style={styles.muted}>
              {globalEnabled === null
                ? "读取中…"
                : globalEnabled
                  ? "已开启：所有主任务的完成、失败、等待授权都会通知"
                  : "已关闭：仅通知点亮了铃铛的 agent"}
            </Text>
          </View>
          <Switch
            value={globalEnabled ?? false}
            onValueChange={() => void toggleGlobal()}
            disabled={globalEnabled === null || busy === "global"}
            trackColor={switchTrack}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>飞书机器人</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.text}>启用飞书通知</Text>
            <Text style={styles.muted}>
              {draft.webhookUrl
                ? "关闭后暂停飞书推送，配置保留"
                : "填写 Webhook 地址后才会推送"}
            </Text>
          </View>
          <Switch
            value={draft.feishuEnabled}
            onValueChange={(feishuEnabled) => {
              setDraft({ ...draft, feishuEnabled });
              setSaved(false);
            }}
            trackColor={switchTrack}
          />
        </View>
        <Text style={styles.label}>Webhook 地址</Text>
        <TextInput
          style={styles.input}
          value={draft.webhookUrl}
          onChangeText={(webhookUrl) => {
            setDraft({ ...draft, webhookUrl });
            setSaved(false);
          }}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>签名密钥（Secret，选填）</Text>
        <TextInput
          style={styles.input}
          value={draft.secret}
          onChangeText={(secret) => {
            setDraft({ ...draft, secret });
            setSaved(false);
          }}
          placeholder="机器人未开启签名校验可留空"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.sectionTitle}>Telegram 机器人</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.text}>启用 Telegram 通知</Text>
            <Text style={styles.muted}>
              {draft.telegramBotToken.trim() && draft.telegramChatId.trim()
                ? "关闭后暂停 Telegram 推送，配置保留"
                : "填写 Bot Token 与 Chat ID 后才会推送"}
            </Text>
          </View>
          <Switch
            value={draft.telegramEnabled}
            onValueChange={(telegramEnabled) => {
              setDraft({ ...draft, telegramEnabled });
              setSaved(false);
            }}
            trackColor={switchTrack}
          />
        </View>
        <Text style={styles.label}>Bot Token</Text>
        <TextInput
          style={styles.input}
          value={draft.telegramBotToken}
          onChangeText={(telegramBotToken) => {
            setDraft({ ...draft, telegramBotToken });
            setSaved(false);
          }}
          placeholder="由 @BotFather 创建机器人后获得，形如 123456:ABC-DEF…"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Chat ID</Text>
        <TextInput
          style={styles.input}
          value={draft.telegramChatId}
          onChangeText={(telegramChatId) => {
            setDraft({ ...draft, telegramChatId });
            setSaved(false);
          }}
          placeholder="先给机器人发条消息，再点下方按钮自动探测"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="探测 Telegram Chat ID"
          onPress={() => void runTelegramProbe()}
          style={styles.secondaryButton}
          disabled={busy !== null}
        >
          <Text style={styles.secondaryButtonText}>
            {busy === "probe" ? "探测中…" : "探测 Chat ID"}
          </Text>
        </Pressable>
        <Text style={styles.muted}>
          Bot Token 与 Chat ID 都填写且开关打开时推送；两个渠道的开关都打开时会同时发送。
        </Text>
      </View>

      <Text style={styles.sectionTitle}>通知行为</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.text}>任务失败也通知</Text>
            <Text style={styles.muted}>关闭后仅通知成功完成</Text>
          </View>
          <Switch
            value={draft.notifyOnFailed}
            onValueChange={(notifyOnFailed) => {
              setDraft({ ...draft, notifyOnFailed });
              setSaved(false);
            }}
            trackColor={switchTrack}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.text}>等待授权时通知</Text>
            <Text style={styles.muted}>任务被权限确认阻塞时提醒你回来处理</Text>
          </View>
          <Switch
            value={draft.notifyOnPermission}
            onValueChange={(notifyOnPermission) => {
              setDraft({ ...draft, notifyOnPermission });
              setSaved(false);
            }}
            trackColor={switchTrack}
          />
        </View>
        <Text style={styles.label}>最短任务时长（秒）</Text>
        <TextInput
          style={styles.input}
          value={String(draft.minDurationSeconds)}
          keyboardType="numeric"
          onChangeText={(text) => {
            const parsed = Number.parseInt(text, 10);
            const clamped = Number.isFinite(parsed)
              ? Math.min(DURATION_MAX, Math.max(DURATION_MIN, parsed))
              : DURATION_MIN;
            setDraft({ ...draft, minDurationSeconds: clamped });
            setSaved(false);
          }}
        />
        <Text style={styles.muted}>短于该时长完成的任务不通知，默认 60 秒。</Text>
        <Text style={styles.label}>标题前缀（选填，最多 20 字）</Text>
        <TextInput
          style={styles.input}
          value={draft.titlePrefix}
          maxLength={20}
          onChangeText={(titlePrefix) => {
            setDraft({ ...draft, titlePrefix });
            setSaved(false);
          }}
          placeholder="如 MBP，标题会变成 [MBP] ✅ 任务完成…"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.muted}>
          多台设备或多个机器人同时推送时用来区分来源，留空则不加前缀。
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="保存任务通知配置"
        onPress={() => void saveDraft()}
        style={styles.primaryButton}
        disabled={busy !== null}
      >
        <Text style={styles.primaryButtonText}>
          {busy === "save" ? "保存中…" : saved ? "已保存 ✓" : "保存配置"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="发送测试消息到飞书"
        onPress={() => void runTestSend()}
        style={styles.secondaryButton}
        disabled={busy !== null}
      >
        <Text style={styles.secondaryButtonText}>
          {busy === "test" ? "发送中…" : "发送测试消息"}
        </Text>
      </Pressable>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </ScrollView>
  );
}

function createStyles(theme: PluginSurfaceProps["theme"], compact: boolean) {
  const pad = compact ? 16 : 24;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, gap: compact ? 10 : 14, paddingBottom: pad * 2 },
    sectionTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 8 },
    card: {
      backgroundColor: theme.colors.surface1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: compact ? 12 : 16,
      gap: 10,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    grow: { flex: 1, gap: 2 },
    label: { color: theme.colors.foregroundMuted, fontSize: 13 },
    text: { color: theme.colors.foreground, fontSize: 14 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    input: {
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 13,
    },
    primaryButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
      marginTop: 6,
    },
    primaryButtonText: { color: theme.colors.accentForeground, fontSize: 14, fontWeight: "600" },
    secondaryButton: {
      backgroundColor: theme.colors.surface1,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: 10,
      alignItems: "center",
    },
    secondaryButtonText: { color: theme.colors.foreground, fontSize: 14 },
    feedback: { color: theme.colors.foregroundMuted, fontSize: 12 },
    errorText: { color: theme.colors.statusDanger, fontSize: 13 },
  });
}
