export type MiniApiErrorKind = 'network' | 'timeout' | 'http' | 'business' | 'protocol'

export interface MiniApiErrorOptions {
  code: string
  kind: MiniApiErrorKind
  statusCode: number | null
  requestId: string | null
  retryable: boolean
}

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  city_not_found: '未找到该城市',
  listing_not_found: '未找到该房源',
  service_unavailable: '服务暂不可用，请稍后重试',
}

const KIND_MESSAGES: Readonly<Record<MiniApiErrorKind, string>> = {
  network: '网络连接异常，请检查网络后重试',
  timeout: '请求超时，请稍后重试',
  http: '服务暂不可用，请稍后重试',
  business: '请求未能完成，请稍后重试',
  protocol: '服务响应异常，请稍后重试',
}

function resolveUserMessage(code: string, kind: MiniApiErrorKind): string {
  return CODE_MESSAGES[code] ?? KIND_MESSAGES[kind]
}

export class MiniApiError extends Error {
  readonly code: string
  readonly kind: MiniApiErrorKind
  readonly statusCode: number | null
  readonly requestId: string | null
  readonly retryable: boolean

  constructor(options: MiniApiErrorOptions) {
    super(resolveUserMessage(options.code, options.kind))
    this.name = 'MiniApiError'
    this.code = options.code
    this.kind = options.kind
    this.statusCode = options.statusCode
    this.requestId = options.requestId
    this.retryable = options.retryable
  }
}
