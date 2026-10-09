import type {
  MiniApiFailure,
  MiniApiSuccess,
  MiniApiWriteSuccess,
  MiniErrorCode,
} from './contracts'

/** HTTP responses are caller-specific; maxAgeSeconds describes the server-side data snapshot TTL. */
export const MINI_CACHE_CONTROL = 'private, no-store'

export function miniRequestId(): string {
  return crypto.randomUUID()
}

export function miniOk<T>(
  data: T,
  meta: Readonly<{ requestId: string; asOf: string }>,
): MiniApiSuccess<T> {
  return { ok: true, data, meta: { ...meta, maxAgeSeconds: 300 } }
}

export function miniWriteOk<T>(data: T, requestId: string): MiniApiWriteSuccess<T> {
  return { ok: true, data, meta: { requestId } }
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
