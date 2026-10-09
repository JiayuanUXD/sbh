import { randomBytes } from 'node:crypto'

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  MINI_CACHE_CONTROL,
  miniError,
  miniRequestId,
  miniWriteOk,
} from '@/domain/mini-program/response'
import { issueAnonymousContextToken } from '@/domain/mini-program/session'
import {
  readMiniProgramRuntimeConfig,
  readMiniTrustedProxyRuntimeConfig,
} from '@/lib/mini-program/runtime-config'
import {
  createWechatGateway,
  WechatGatewayError,
  type WechatGatewayLogEntry,
} from '@/lib/mini-program/wechat-gateway'
import type { PoolLike } from '@/lib/rate-limit-pg'

import { readBoundedJsonBody } from '../bounded-json-body'
import { resolveMiniTrustedClientIp, runMiniRateLimit } from '../rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024
const LOGIN_CODE_MAX_LENGTH = 128

type SafeLogger = Readonly<{
  info?(entry: unknown, event: string): void
  error?(entry: unknown, event: string): void
}>

function safeLog(
  logger: SafeLogger,
  level: 'info' | 'error',
  entry: unknown,
  event: string,
): void {
  try {
    logger[level]?.(entry, event)
  } catch {
    // 日志设施不能改变写请求结果或泄露它自己的异常。
  }
}

function response(
  body: unknown,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
      ...headers,
    },
  })
}

function invalid(
  requestId: string,
  status: number,
  field: string,
): Response {
  return response(
    miniError('invalid_request', '请求参数无效', requestId, [field]),
    status,
    requestId,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLoginCode(value: unknown):
  | Readonly<{ ok: true; loginCode: string }>
  | Readonly<{ ok: false; field: string }> {
  if (!isRecord(value)) return { ok: false, field: 'invalid_body' }
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'loginCode') {
    return { ok: false, field: 'invalid_body_fields' }
  }
  if (
    typeof value.loginCode !== 'string'
    || value.loginCode.length < 1
    || value.loginCode.length > LOGIN_CODE_MAX_LENGTH
  ) {
    return { ok: false, field: 'login_code_invalid' }
  }
  return { ok: true, loginCode: value.loginCode }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = miniRequestId()
  const proxyConfig = readMiniTrustedProxyRuntimeConfig()
  const client = proxyConfig.ok
    ? resolveMiniTrustedClientIp(request, proxyConfig.value.trustedProxyHops)
    : { ok: false as const }
  if (!client.ok) {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }
  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    payload = await getPayload({ config })
    const rate = await runMiniRateLimit(
      client.clientIp,
      'mini-session',
      (payload.db as unknown as { pool: PoolLike }).pool,
    )
    if (!rate.allowed) {
      if (rate.storeFailed) {
        return response(
          miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
          503,
          requestId,
        )
      }
      return response(
        miniError('rate_limited', '请求过于频繁，请稍后重试', requestId),
        429,
        requestId,
        { 'Retry-After': String(rate.retryAfterSeconds) },
      )
    }
  } catch {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? ''
  if (contentType !== 'application/json') {
    return invalid(requestId, 415, 'invalid_content_type')
  }
  const body = await readBoundedJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    return invalid(
      requestId,
      body.error === 'body_too_large' ? 413 : 400,
      body.error,
    )
  }
  const parsed = parseLoginCode(body.value)
  if (!parsed.ok) return invalid(requestId, 422, parsed.field)

  const runtimeConfig = readMiniProgramRuntimeConfig()
  if (!runtimeConfig.ok) {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }

  const logger = payload.logger as unknown as SafeLogger
  const gateway = createWechatGateway(runtimeConfig.value, {
    fetchImpl: fetch,
    now: () => Date.now(),
    logger: {
      error(entry: WechatGatewayLogEntry) {
        safeLog(logger, 'error', { requestId, ...entry }, 'mini_wechat_gateway_error')
      },
    },
  })
  try {
    const identity = await gateway.exchangeLoginCode(parsed.loginCode)
    const issued = issueAnonymousContextToken(identity.openId, {
      signingSecret: runtimeConfig.value.sessionSigningSecret,
      now: () => Date.now(),
      randomBytes: (size) => randomBytes(size),
    })
    safeLog(logger, 'info', {
      operation: 'mini_session',
      requestId,
      errorCode: null,
    }, 'mini_session_success')
    return response(miniWriteOk({
      anonymousContextToken: issued.token,
      expiresAt: issued.expiresAt,
    }, requestId), 200, requestId)
  } catch (error) {
    const code = error instanceof WechatGatewayError
      && error.errorCode === 'wechat_login_rejected'
      ? 'login_code_invalid'
      : 'service_unavailable'
    safeLog(logger, 'error', {
      operation: 'mini_session',
      requestId,
      errorCode: code,
    }, 'mini_session_error')
    return response(
      miniError(
        code,
        code === 'login_code_invalid' ? '登录凭证已失效，请重试' : '服务暂不可用，请稍后重试',
        requestId,
      ),
      code === 'login_code_invalid' ? 422 : 503,
      requestId,
    )
  }
}
