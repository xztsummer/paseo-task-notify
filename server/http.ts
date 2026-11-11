/** 请求超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 10_000;

/** 带超时的 fetch：AbortSignal.timeout 在当前类型环境下不可用，用控制器实现。 */
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
