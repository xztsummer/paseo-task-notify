import type { NotifyState } from "../shared/contracts";

/**
 * 客户端 bundle 内的开关状态广播：任一入口（铃铛、/notify 命令、命令中心、
 * 设置页）变更状态后立即广播，让所有铃铛图标同步刷新，不必等轮询。
 */
type Listener = (state: NotifyState) => void;

const listeners = new Set<Listener>();

export function broadcastNotifyState(state: NotifyState): void {
  for (const listener of listeners) listener(state);
}

export function subscribeNotifyState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
