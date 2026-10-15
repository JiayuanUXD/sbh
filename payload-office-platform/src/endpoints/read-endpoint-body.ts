import type { PayloadRequest } from 'payload'

/**
 * 自定义端点取 JSON 请求体（OPT-113）。
 *
 * Payload 3.86 的自定义端点不会自动解析 body：`req.data` 只有调用过
 * `addDataAndFileToRequest` 才有，测试夹具则常常直接塞 `req.data`。两条都认；
 * `req.json()` 在空 body / 非 JSON 时会抛，这里收成 null，由调用方决定是 400 还是按缺省处理。
 */
export async function readEndpointBody(
  req: PayloadRequest,
): Promise<Record<string, unknown> | null> {
  let raw: unknown = (req as unknown as { data?: unknown }).data
  if (raw === undefined && typeof req.json === 'function') {
    try {
      raw = await req.json()
    } catch {
      return null
    }
  }
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}
