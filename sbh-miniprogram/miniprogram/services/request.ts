import {
  getCurrentRuntimeEnvironment,
  type RuntimeEnvironment,
} from '../config/environment.js'
import type { JSONObject, RequestData, RequestMethod, RequestOptions } from './mini-api-contracts.js'
import { MiniApiError, type MiniApiErrorKind } from './mini-api-error.js'
import { createWxTransport, type WxTransportApi } from './wx-transport.js'

export type {
  JSONObject,
  JSONValue,
  MiniApiFailure,
  MiniApiReadMeta,
  MiniApiSuccess,
  MiniApiWriteMeta,
  RequestData,
  RequestMethod,
  RequestOptions,
} from './mini-api-contracts.js'
export { MiniApiError } from './mini-api-error.js'

export interface RequestTransportInput {
  environment: RuntimeEnvironment
  path: string
  method: RequestMethod
  data: RequestData | undefined
  timeoutMs: number
  headers: Readonly<Record<string, string>>
}

export interface RequestTransportResponse {
  statusCode: number
  data: unknown
  headers?: Readonly<Record<string, unknown>>
}

export type RequestTransport = (
  input: RequestTransportInput,
) => Promise<RequestTransportResponse>

export interface RequestDependencies {
  transport: RequestTransport
  environment: () => RuntimeEnvironment
}

type ResponseClassification<T> =
  | Readonly<{ type: 'success'; data: T }>
  | Readonly<{ type: 'error'; error: MiniApiError }>

const API_PATH_PREFIX = '/api/mini/v1/'
const DEFAULT_TIMEOUT_MS = 10_000
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value)
}

function isCanonicalUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}

function isJsonArray(value: readonly unknown[], ancestors: WeakSet<object>): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false
  }

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isJsonValue(descriptor.value, ancestors)) {
      return false
    }
  }

  return true
}

function isJsonObject(value: object, ancestors: WeakSet<object>): value is JSONObject {
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return false
  }

  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isJsonValue(descriptor.value, ancestors)) {
      return false
    }
  }

  return true
}

function isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value !== 'object' || ancestors.has(value)) {
    return false
  }

  ancestors.add(value)
  try {
    return Array.isArray(value)
      ? isJsonArray(value, ancestors)
      : isJsonObject(value, ancestors)
  } catch {
    return false
  } finally {
    ancestors.delete(value)
  }
}

function assertRequestMethod(value: unknown): asserts value is RequestMethod {
  if (value === 'GET' || value === 'POST' || value === 'PUT' || value === 'DELETE') {
    return
  }

  throw new MiniApiError({
    kind: 'protocol',
    code: 'invalid_method',
    statusCode: null,
    requestId: null,
    retryable: false,
  })
}

function assertTimeoutMs(value: unknown): asserts value is number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return
  }

  throw new MiniApiError({
    kind: 'protocol',
    code: 'invalid_timeout',
    statusCode: null,
    requestId: null,
    retryable: false,
  })
}

function assertRequestData(value: unknown): asserts value is RequestData | undefined {
  if (
    value === undefined ||
    typeof value === 'string' ||
    value instanceof ArrayBuffer ||
    (typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value, new WeakSet()))
  ) {
    return
  }

  throw new MiniApiError({
    kind: 'protocol',
    code: 'invalid_data',
    statusCode: null,
    requestId: null,
    retryable: false,
  })
}

function findRequestIdInBody(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.meta) || !isSafeRequestId(value.meta.requestId)) {
    return null
  }

  return value.meta.requestId
}

function findRequestIdInHeaders(headers: unknown): string | null {
  if (!isRecord(headers)) {
    return null
  }

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'x-request-id' && isSafeRequestId(value)) {
      return value
    }
  }

  return null
}

function resolveRequestId(response: RequestTransportResponse): string | null {
  return findRequestIdInBody(response.data) ?? findRequestIdInHeaders(response.headers)
}

function isMiniApiSuccess(value: unknown, method: RequestMethod): value is {
  ok: true
  data: unknown
  meta: { requestId: string; asOf?: string; maxAgeSeconds?: number }
} {
  if (!isRecord(value) || value.ok !== true || !Object.hasOwn(value, 'data') || !isRecord(value.meta)) {
    return false
  }

  if (!isSafeRequestId(value.meta.requestId)) return false
  if (!isGetMethod(method)) return true
  return isCanonicalUtcIso(value.meta.asOf) && value.meta.maxAgeSeconds === 300
}

function isMiniApiFailure(value: unknown): value is {
  ok: false
  error: { code: string; message: string; fields?: string[] }
  meta: { requestId: string }
} {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error) || !isRecord(value.meta)) {
    return false
  }

  return (
    typeof value.error.code === 'string' &&
    ERROR_CODE.test(value.error.code) &&
    typeof value.error.message === 'string' &&
    value.error.message.trim().length > 0 &&
    (value.error.fields === undefined || isStringArray(value.error.fields)) &&
    isSafeRequestId(value.meta.requestId)
  )
}

function assertMiniApiPath(path: string): void {
  if (!path.startsWith(API_PATH_PREFIX) || path.includes('\\') || path.includes('#')) {
    throw new MiniApiError({
      kind: 'protocol',
      code: 'invalid_path',
      statusCode: null,
      requestId: null,
      retryable: false,
    })
  }

  const terminatorIndex = path.indexOf('?')
  const pathname = terminatorIndex === -1 ? path : path.slice(0, terminatorIndex)
  const segments = pathname.split('/').slice(1)

  for (const segment of segments) {
    let decodedSegment: string

    try {
      decodedSegment = decodeURIComponent(segment)
    } catch {
      throw new MiniApiError({
        kind: 'protocol',
        code: 'invalid_path',
        statusCode: null,
        requestId: null,
        retryable: false,
      })
    }

    if (
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('/') ||
      decodedSegment.includes('\\') ||
      /%(?:2e|2f|5c)/i.test(decodedSegment)
    ) {
      throw new MiniApiError({
        kind: 'protocol',
        code: 'invalid_path',
        statusCode: null,
        requestId: null,
        retryable: false,
      })
    }
  }
}

function isGetMethod(method: RequestMethod): boolean {
  return method === 'GET'
}

function createError(
  kind: MiniApiErrorKind,
  code: string,
  statusCode: number | null,
  requestId: string | null,
  method: RequestMethod,
): MiniApiError {
  const retryable = isGetMethod(method) && (kind === 'network' || kind === 'timeout' || (kind === 'http' && (statusCode ?? 0) >= 500))

  return new MiniApiError({ kind, code, statusCode, requestId, retryable })
}

function classifyTransportFailure(error: unknown, method: RequestMethod): MiniApiError {
  const message = error instanceof Error
    ? error.message
    : isRecord(error) && typeof error.errMsg === 'string'
      ? error.errMsg
      : ''
  const kind: MiniApiErrorKind = /timeout/i.test(message) ? 'timeout' : 'network'

  return createError(kind, kind === 'timeout' ? 'request_timeout' : 'network_error', null, null, method)
}

async function classifyResponse<T>(
  response: RequestTransportResponse,
  method: RequestMethod,
  parse: (value: unknown) => T | PromiseLike<T>,
): Promise<ResponseClassification<T>> {
  const requestId = resolveRequestId(response)

  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    return {
      type: 'error',
      error: createError('protocol', 'invalid_response', null, requestId, method),
    }
  }

  if (response.statusCode >= 300 && response.statusCode < 400) {
    return {
      type: 'error',
      error: createError('http', 'http_error', response.statusCode, requestId, method),
    }
  }

  if (response.statusCode >= 500) {
    const code = isMiniApiFailure(response.data) ? response.data.error.code : 'http_error'
    return {
      type: 'error',
      error: createError('http', code, response.statusCode, requestId, method),
    }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (response.statusCode >= 400 && isMiniApiFailure(response.data)) {
      return {
        type: 'error',
        error: createError('business', response.data.error.code, response.statusCode, response.data.meta.requestId, method),
      }
    }

    return {
      type: 'error',
      error: createError('http', 'http_error', response.statusCode, requestId, method),
    }
  }

  if (isMiniApiSuccess(response.data, method)) {
    try {
      return { type: 'success', data: await parse(response.data.data) }
    } catch {
      return {
        type: 'error',
        error: createError(
          'protocol',
          'invalid_response',
          response.statusCode,
          response.data.meta.requestId,
          method,
        ),
      }
    }
  }

  if (isMiniApiFailure(response.data)) {
    return {
      type: 'error',
      error: createError('business', response.data.error.code, response.statusCode, response.data.meta.requestId, method),
    }
  }

  return {
    type: 'error',
    error: createError('protocol', 'invalid_response', response.statusCode, requestId, method),
  }
}

export function createRequestClient(dependencies: RequestDependencies): <T>(options: RequestOptions<T>) => Promise<T> {
  return async <T>(options: RequestOptions<T>): Promise<T> => {
    assertMiniApiPath(options.path)

    const method = options.method === undefined ? 'GET' : options.method
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs
    assertRequestMethod(method)
    assertTimeoutMs(timeoutMs)
    assertRequestData(options.data)
    if (options.anonymousContextToken !== undefined) {
      if (method === 'GET' || typeof options.anonymousContextToken !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(options.anonymousContextToken)) {
        throw new MiniApiError({
          kind: 'protocol',
          code: 'invalid_authentication',
          statusCode: null,
          requestId: null,
          retryable: false,
        })
      }
    }
    const runtimeEnvironment = dependencies.environment()
    const requestInput: RequestTransportInput = {
      environment: runtimeEnvironment,
      path: options.path,
      method,
      data: options.data,
      timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(options.anonymousContextToken === undefined
          ? {}
          : { Authorization: `Bearer ${options.anonymousContextToken}` }),
      },
    }
    const attempts = isGetMethod(method) ? 2 : 1
    let lastError: MiniApiError | null = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await dependencies.transport(requestInput)
        const classification = await classifyResponse(response, method, options.parse)

        if (classification.type === 'success') {
          return classification.data
        }

        lastError = classification.error
      } catch (error) {
        lastError = error instanceof MiniApiError ? error : classifyTransportFailure(error, method)
      }

      if (!lastError.retryable) {
        throw lastError
      }
    }

    throw lastError ?? new MiniApiError({
      kind: 'protocol',
      code: 'invalid_response',
      statusCode: null,
      requestId: null,
      retryable: false,
    })
  }
}

const wxTransportApi: WxTransportApi = {
  request: (input) => {
    wx.request(input)
  },
  cloud: {
    init: (input) => {
      wx.cloud.init(input)
    },
    callContainer: (input) => {
      wx.cloud.callContainer(input)
    },
  },
}

export const request = createRequestClient({
  environment: getCurrentRuntimeEnvironment,
  transport: createWxTransport(wxTransportApi),
})
