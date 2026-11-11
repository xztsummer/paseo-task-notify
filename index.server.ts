import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerNotifyServer } from "./server/notify";

export default function contribute(server: PluginServerContext) {
  return registerNotifyServer(server);
}
