export type BoundedJsonBodyResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; error: 'body_too_large' | 'invalid_json' }>

/** 逐 chunk 限界；越界时立即 cancel，不先完整缓冲请求体。 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBodyResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    if (request.body) {
      try {
        await request.body.cancel('body_too_large')
      } catch {
        // 取消失败也不继续读取，仍按越界拒绝。
      }
    }
    return { ok: false, error: 'body_too_large' }
  }

  if (!request.body) return { ok: true, value: null }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      totalBytes += result.value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('body_too_large')
        } catch {
          // 取消失败也不继续读取，仍按越界拒绝。
        }
        return { ok: false, error: 'body_too_large' }
      }
      chunks.push(result.value)
    }
  } catch {
    return { ok: false, error: 'invalid_json' }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, value: raw ? JSON.parse(raw) : null }
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
}
