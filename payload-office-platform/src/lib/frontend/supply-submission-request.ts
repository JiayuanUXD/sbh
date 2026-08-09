import { normalizePhone } from '@/domain/shared/phone'

const STORAGE_KEY = 'sbh:publish:submission-request:v1'
const STORAGE_VERSION = 1

/**
 * 幂等身份取材字段。必须与服务端 computeSupplyIdempotencyKey 的取材一致，
 * 否则同一业主在同一楼盘的第二套房源会复用 requestId、被服务端判为重放而丢弃。
 */
type SupplyIntentValues = Readonly<{
  buildingName: string
  address: string
  contactPhone: string
}>

type StoredSupplyRequest = Readonly<{
  version: typeof STORAGE_VERSION
  intentFingerprint: string
  requestId: string
}>

export type SupplyPendingRequestStore = Readonly<{
  readRequestId: (intentFingerprint: string) => string | null
  rememberRequestId: (intentFingerprint: string, requestId: string) => void
}>

function isStoredSupplyRequest(value: unknown): value is StoredSupplyRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.version === STORAGE_VERSION &&
    typeof record.intentFingerprint === 'string' &&
    record.intentFingerprint.length === 64 &&
    typeof record.requestId === 'string' &&
    record.requestId.length > 0 &&
    record.requestId.length <= 100
  )
}

/** Session storage contains only a SHA-256 intent fingerprint and an opaque request ID. */
export function createSupplyPendingRequestStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
): SupplyPendingRequestStore {
  return {
    readRequestId(intentFingerprint) {
      if (!storage) return null
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) return null
        const value: unknown = JSON.parse(raw)
        if (!isStoredSupplyRequest(value)) return null
        return value.intentFingerprint === intentFingerprint ? value.requestId : null
      } catch {
        return null
      }
    },
    rememberRequestId(intentFingerprint, requestId) {
      if (!storage) return
      try {
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: STORAGE_VERSION, intentFingerprint, requestId }),
        )
      } catch {
        // Privacy mode and storage quotas must not prevent a form submission.
      }
    },
  }
}

export function createBrowserSupplyPendingRequestStore(): SupplyPendingRequestStore {
  try {
    return createSupplyPendingRequestStore(
      typeof window === 'undefined' ? undefined : window.sessionStorage,
    )
  } catch {
    return createSupplyPendingRequestStore(undefined)
  }
}

export function getSupplyIntentIdentity(values: SupplyIntentValues): string {
  return [
    normalizePhone(values.contactPhone.trim()),
    values.buildingName.trim(),
    values.address.trim(),
  ].join('|')
}

export async function createSupplyIntentFingerprint(
  values: SupplyIntentValues,
): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null
    const encoded = new TextEncoder().encode(getSupplyIntentIdentity(values))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
