import { homedir } from "node:os";
import { join } from "node:path";

/** 本插件的数据目录：daemon home 下的 plugin-data，与其他插件隔离。 */
export function pluginDataDir(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(home, "plugin-data", "paseo-task-notify");
}
