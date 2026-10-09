import { createHash } from 'node:crypto'

import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'

const CODE2SESSION_ENDPOINT = 'https://api.weixin.qq.com/sns/jscode2session'
const STABLE_TOKEN_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/stable_token'
const PHONE_NUMBER_ENDPOINT = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber'
const ACCESS_TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000
const ACCESS_TOKEN_MAX_SECONDS = 7200
const CODE_MAX_LENGTH = 128
const TOKEN_INVALID_ERRCODES = new Set([40014, 42001])

export type WechatFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type WechatGatewayLogEntry = Readonly<{
  operation: 'exchange_login_code' | 'exchange_phone_code'
  errorCode: WechatGatewayErrorCode
}>

export type WechatGatewayLogger = Readonly<{
  error(entry: WechatGatewayLogEntry): void
}>

export type WechatGatewayErrorCode =
  | 'login_code_invalid'
  | 'phone_code_invalid'
  | 'wechat_network_error'
  | 'wechat_http_error'
  | 'wechat_response_invalid'
  | 'wechat_login_rejected'
  | 'wechat_access_token_rejected'
  | 'wechat_phone_code_rejected'
  | 'wechat_phone_rejected'
  | 'wechat_phone_invalid'
  | 'wechat_gateway_error'

export class WechatGatewayError extends Error {
  readonly errorCode: WechatGatewayErrorCode

  constructor(errorCode: WechatGatewayErrorCode) {
    super(errorCode)
    this.name = 'WechatGatewayError'
    this.errorCode = errorCode
  }
}

export type WechatGateway = Readonly<{
  exchangeLoginCode(loginCode: string): Promise<Readonly<{ openId: string }>>
  exchangePhoneCode(phoneCode: string): Promise<Readonly<{ phone: string }>>
}>

export type WechatGatewayConfig = Readonly<{
  appId: string
  appSecret: string
}>

export type WechatGatewayDeps = Readonly<{
  fetchImpl: WechatFetch
  now(): number
  logger: WechatGatewayLogger
}>

type JsonRecord = Record<string, unknown>
type CachedAccessToken = Readonly<{ value: string; expiresAt: number }>
type AccessTokenRequest = Readonly<{
  owner: 'ordinary' | 'force'
  generation: number
  promise: Promise<CachedAccessToken>
}>
type AccessTokenCoordinator = {
  readonly secretFingerprint: string
  cachedAccessToken: CachedAccessToken | null
  accessTokenGeneration: number
  accessTokenInFlight: AccessTokenRequest | null
}

const accessTokenCoordinators = new Map<string, AccessTokenCoordinator>()

function accessTokenCoordinator(config: WechatGatewayConfig): AccessTokenCoordinator {
  const secretFingerprint = createHash('sha256')
    .update(config.appSecret, 'utf8')
    .digest('hex')
  const existing = accessTokenCoordinators.get(config.appId)
  if (existing?.secretFingerprint === secretFingerprint) return existing
  const created: AccessTokenCoordinator = {
    secretFingerprint,
    cachedAccessToken: null,
    accessTokenGeneration: 0,
    accessTokenInFlight: null,
  }
  accessTokenCoordinators.set(config.appId, created)
  return created
}

/** 仅供单测隔离 module-scope token 协调状态。 */
export function __resetWechatGatewayTokenStateForTests(): void {
  accessTokenCoordinators.clear()
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function validCode(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= CODE_MAX_LENGTH
}

function errcode(value: JsonRecord): number | null {
  if (value.errcode === undefined) return null
  return typeof value.errcode === 'number' && Number.isSafeInteger(value.errcode)
    ? value.errcode
    : Number.NaN
}

function safeError(error: unknown): WechatGatewayError {
  return error instanceof WechatGatewayError
    ? error
    : new WechatGatewayError('wechat_gateway_error')
}

async function requestJson(
  fetchImpl: WechatFetch,
  input: string | URL,
  init?: RequestInit,
): Promise<JsonRecord> {
  let response: Response
  try {
    response = await fetchImpl(input, init)
  } catch {
    throw new WechatGatewayError('wechat_network_error')
  }
  if (!response.ok) throw new WechatGatewayError('wechat_http_error')
  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    throw new WechatGatewayError('wechat_response_invalid')
  }
  const result = asRecord(parsed)
  if (!result) throw new WechatGatewayError('wechat_response_invalid')
  return result
}

export function createWechatGateway(
  config: WechatGatewayConfig,
  deps: WechatGatewayDeps,
): WechatGateway {
  const tokenState = accessTokenCoordinator(config)

  async function fetchAccessToken(forceRefresh: boolean): Promise<CachedAccessToken> {
    const result = await requestJson(deps.fetchImpl, STABLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: config.appId,
        secret: config.appSecret,
        force_refresh: forceRefresh,
      }),
    })
    const upstreamCode = errcode(result)
    if (upstreamCode !== null && upstreamCode !== 0) {
      throw new WechatGatewayError('wechat_access_token_rejected')
    }
    if (
      typeof result.access_token !== 'string'
      || result.access_token.length < 1
      || result.access_token.length > 2048
      || typeof result.expires_in !== 'number'
      || !Number.isFinite(result.expires_in)
      || result.expires_in <= 0
      || result.expires_in > ACCESS_TOKEN_MAX_SECONDS
    ) {
      throw new WechatGatewayError('wechat_response_invalid')
    }
    return {
      value: result.access_token,
      expiresAt: deps.now() + result.expires_in * 1000,
    }
  }

  async function getAccessToken(forceRefresh: boolean): Promise<string> {
    if (forceRefresh) {
      tokenState.cachedAccessToken = null
      if (tokenState.accessTokenInFlight?.owner === 'force') {
        return (await tokenState.accessTokenInFlight.promise).value
      }
      tokenState.accessTokenGeneration += 1
    }
    if (
      !forceRefresh
      && tokenState.cachedAccessToken
      && deps.now() < tokenState.cachedAccessToken.expiresAt - ACCESS_TOKEN_EARLY_REFRESH_MS
    ) {
      return tokenState.cachedAccessToken.value
    }
    if (!forceRefresh && tokenState.accessTokenInFlight) {
      return (await tokenState.accessTokenInFlight.promise).value
    }

    const request: AccessTokenRequest = {
      owner: forceRefresh ? 'force' : 'ordinary',
      generation: tokenState.accessTokenGeneration,
      promise: fetchAccessToken(forceRefresh),
    }
    tokenState.accessTokenInFlight = request
    try {
      const token = await request.promise
      if (request.generation === tokenState.accessTokenGeneration) {
        tokenState.cachedAccessToken = token
      }
      return token.value
    } finally {
      if (tokenState.accessTokenInFlight === request) tokenState.accessTokenInFlight = null
    }
  }

  function discardAccessToken(value: string): void {
    if (tokenState.cachedAccessToken?.value === value) tokenState.cachedAccessToken = null
  }

  async function getAccessTokenAfterRejection(rejectedValue: string): Promise<string> {
    if (
      tokenState.cachedAccessToken
      && tokenState.cachedAccessToken.value !== rejectedValue
      && deps.now() < tokenState.cachedAccessToken.expiresAt - ACCESS_TOKEN_EARLY_REFRESH_MS
    ) {
      return tokenState.cachedAccessToken.value
    }
    discardAccessToken(rejectedValue)
    return getAccessToken(true)
  }

  async function requestPhone(phoneCode: string, accessToken: string): Promise<JsonRecord> {
    const url = new URL(PHONE_NUMBER_ENDPOINT)
    url.searchParams.set('access_token', accessToken)
    return requestJson(deps.fetchImpl, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: phoneCode }),
    })
  }

  async function runLogged<T>(
    operation: WechatGatewayLogEntry['operation'],
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action()
    } catch (error) {
      const mapped = safeError(error)
      try {
        deps.logger.error({ operation, errorCode: mapped.errorCode })
      } catch {
        // 日志设施不能改变网关的稳定错误合同。
      }
      throw mapped
    }
  }

  async function exchangeLoginCode(loginCode: string): Promise<Readonly<{ openId: string }>> {
    return runLogged('exchange_login_code', async () => {
      if (!validCode(loginCode)) throw new WechatGatewayError('login_code_invalid')
      const url = new URL(CODE2SESSION_ENDPOINT)
      url.searchParams.set('appid', config.appId)
      url.searchParams.set('secret', config.appSecret)
      url.searchParams.set('js_code', loginCode)
      url.searchParams.set('grant_type', 'authorization_code')
      const result = await requestJson(deps.fetchImpl, url, { method: 'GET' })
      const upstreamCode = errcode(result)
      if (upstreamCode !== null && upstreamCode !== 0) {
        throw new WechatGatewayError('wechat_login_rejected')
      }
      if (
        typeof result.openid !== 'string'
        || result.openid.length < 1
        || result.openid.length > 256
        || typeof result.session_key !== 'string'
        || result.session_key.length < 1
      ) {
        throw new WechatGatewayError('wechat_response_invalid')
      }
      return { openId: result.openid }
    })
  }

  async function exchangePhoneCode(phoneCode: string): Promise<Readonly<{ phone: string }>> {
    return runLogged('exchange_phone_code', async () => {
      if (!validCode(phoneCode)) throw new WechatGatewayError('phone_code_invalid')
      let accessToken = await getAccessToken(false)
      let result = await requestPhone(phoneCode, accessToken)
      let upstreamCode = errcode(result)
      if (upstreamCode !== null && TOKEN_INVALID_ERRCODES.has(upstreamCode)) {
        accessToken = await getAccessTokenAfterRejection(accessToken)
        result = await requestPhone(phoneCode, accessToken)
        upstreamCode = errcode(result)
      }
      if (upstreamCode !== 0) {
        throw new WechatGatewayError(
          upstreamCode === 40029
            ? 'wechat_phone_code_rejected'
            : 'wechat_phone_rejected',
        )
      }
      const phoneInfo = asRecord(result.phone_info)
      const candidate = phoneInfo && typeof phoneInfo.purePhoneNumber === 'string'
        ? phoneInfo.purePhoneNumber
        : phoneInfo?.phoneNumber
      if (typeof candidate !== 'string' || !isValidCnMobile(candidate)) {
        throw new WechatGatewayError('wechat_phone_invalid')
      }
      return { phone: normalizePhone(candidate) }
    })
  }

  return { exchangeLoginCode, exchangePhoneCode }
}
