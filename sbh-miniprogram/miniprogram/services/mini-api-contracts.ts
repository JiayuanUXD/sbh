export interface MiniApiMeta {
  requestId: string
  asOf: string
  maxAgeSeconds: 300
}

export type MiniApiSuccess<T> = {
  ok: true
  data: T
  meta: MiniApiMeta
}

export type MiniApiFailure = {
  ok: false
  error: {
    code: string
    message: string
    fields?: string[]
  }
  meta: {
    requestId: string
  }
}

export type JSONValue = string | number | boolean | null | JSONObject | readonly JSONValue[]

export type JSONObject = Readonly<{
  [key: string]: JSONValue
}>

export type RequestData = string | JSONObject | ArrayBuffer

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface RequestOptions<T> {
  path: `/api/mini/v1/${string}`
  method?: RequestMethod
  data?: RequestData
  timeoutMs?: number
  parse: (value: unknown) => T | PromiseLike<T>
}
