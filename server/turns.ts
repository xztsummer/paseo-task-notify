/** 同时追踪的回合数上限；超过说明有回合未正常收到结束事件，丢弃最早的。 */
const STARTS_KEPT = 1_000;

/**
 * 回合开始时间追踪：turn_started 记录、turn_ended 消费。
 * 插件在回合进行中重启时看不到开始事件，end() 返回 undefined，调用方跳过时长过滤。
 */
export class TurnTracker {
  private readonly starts = new Map<string, number>();

  private key(agentId: string, turnId: string): string {
    return `${agentId}\n${turnId}`;
  }

  start(agentId: string, turnId: string): void {
    this.starts.set(this.key(agentId, turnId), Date.now());
    if (this.starts.size > STARTS_KEPT) {
      const oldest = this.starts.keys().next().value;
      if (oldest !== undefined) this.starts.delete(oldest);
    }
  }

  end(agentId: string, turnId: string): number | undefined {
    const key = this.key(agentId, turnId);
    const startedAt = this.starts.get(key);
    this.starts.delete(key);
    return startedAt;
  }

  clearAgent(agentId: string): void {
    const prefix = `${agentId}\n`;
    for (const key of this.starts.keys()) {
      if (key.startsWith(prefix)) this.starts.delete(key);
    }
  }
}
