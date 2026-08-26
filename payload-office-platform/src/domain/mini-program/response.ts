import type { MiniApiFailure, MiniApiSuccess, MiniErrorCode } from './contracts'

/** HTTP responses are caller-specific; maxAgeSeconds describes the server-side data snapshot TTL. */
export const MINI_CACHE_CONTROL = 'private, no-store'
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/

export function miniRequestId(value: string | null): string {
  return value && REQUEST_ID.test(value) ? value : crypto.randomUUID()
}

export function miniOk<T>(
  data: T,
  meta: Readonly<{ requestId: string; asOf: string }>,
): MiniApiSuccess<T> {
  return { ok: true, data, meta: { ...meta, maxAgeSeconds: 300 } }
}

export function miniError(
  code: MiniErrorCode,
  message: string,
  requestId: string,
  fields?: readonly string[],
): MiniApiFailure {
  return {
    ok: false,
    error: { code, message, ...(fields && fields.length > 0 ? { fields } : {}) },
    meta: { requestId },
  }
}
