'use client'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'INTERNAL', message: '服务暂时不可用' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  if (res.ok && b.ok === true) return { ok: true, data: body as T }
  return { ok: false, code: typeof b.code === 'string' ? b.code : 'INTERNAL', message: typeof b.message === 'string' ? b.message : '服务暂时不可用' }
}

export async function memberPost<T>(path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body ?? {}) })
    return await parse<T>(res)
  } catch {
    return { ok: false, code: 'NETWORK', message: '网络异常，请稍后重试' }
  }
}

export async function memberGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
    return await parse<T>(res)
  } catch {
    return { ok: false, code: 'NETWORK', message: '网络异常，请稍后重试' }
  }
}
