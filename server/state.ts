import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { notifyStateSchema, type NotifyState } from "../shared/contracts";
import { pluginDataDir } from "./plugin-data";

function statePath(): string {
  return join(pluginDataDir(), "state.json");
}

/** 读取开关状态；文件缺失或损坏时返回「全部关闭」。 */
export async function readState(): Promise<NotifyState> {
  try {
    const parsed = notifyStateSchema.safeParse(JSON.parse(await readFile(statePath(), "utf8")));
    return parsed.success ? parsed.data : { globalEnabled: false, agents: {} };
  } catch {
    return { globalEnabled: false, agents: {} };
  }
}

/** 原子写入开关状态（临时文件 + rename），插件重启后仍生效。 */
export async function writeState(state: NotifyState): Promise<void> {
  const dir = pluginDataDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, "state.json");
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temp, path);
}

/** 该 agent 是否生效：全局开，或该 agent 的铃铛被点亮。 */
export function agentEnabled(state: NotifyState, agentId: string): boolean {
  return state.globalEnabled || state.agents[agentId] === true;
}
