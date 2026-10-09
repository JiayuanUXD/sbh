/**
 * Mini 微信能力的局部服务端配置。
 *
 * 本模块只提供惰性读取函数；导入它不会验证环境，也不会阻断现有 Web 容器启动。
 */

export type MiniWechatRuntimeConfig = Readonly<{
  appId: string
  appSecret: string
}>

export type MiniSessionSigningRuntimeConfig = Readonly<{
  sessionSigningSecret: Uint8Array
}>

export type MiniTrustedProxyRuntimeConfig = Readonly<{
  trustedProxyHops: number
}>

export type MiniProgramRuntimeConfig = MiniWechatRuntimeConfig & MiniSessionSigningRuntimeConfig

export type MiniProgramRuntimeConfigResult =
  | Readonly<{ ok: true; value: MiniProgramRuntimeConfig }>
  | Readonly<{ ok: false; errorCode: 'mini_program_config_unavailable' }>

type Environment = Readonly<Record<string, string | undefined>>

type ConfigResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; errorCode: 'mini_program_config_unavailable' }>

const APP_ID_PATTERN = /^wx[a-f0-9]{16}$/i
const APP_SECRET_PATTERN = /^[a-f0-9]{32}$/i
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const PLACEHOLDER_PATTERN = /(?:change|example|placeholder|replace|sample|secret|test)/i
const MIN_SIGNING_SECRET_BYTES = 32
const MIN_DISTINCT_SECRET_BYTES = 16

function decodeSigningSecret(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value)) return null
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value || decoded.length < MIN_SIGNING_SECRET_BYTES) {
    return null
  }
  if (PLACEHOLDER_PATTERN.test(decoded.toString('utf8'))) return null
  if (new Set(decoded).size < MIN_DISTINCT_SECRET_BYTES) return null
  return Uint8Array.from(decoded)
}

/** 缺失或错误配置统一折叠为安全错误码，不回显具体变量值。 */
export function readMiniWechatRuntimeConfig(
  env: Environment = process.env,
): ConfigResult<MiniWechatRuntimeConfig> {
  if (typeof window !== 'undefined') {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  const appId = env.WECHAT_MINIPROGRAM_APP_ID
  const appSecret = env.WECHAT_MINIPROGRAM_APP_SECRET
  if (
    typeof appId !== 'string'
    || !APP_ID_PATTERN.test(appId)
    || typeof appSecret !== 'string'
    || !APP_SECRET_PATTERN.test(appSecret)
  ) {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  return { ok: true, value: { appId, appSecret } }
}

export function readMiniSessionSigningRuntimeConfig(
  env: Environment = process.env,
): ConfigResult<MiniSessionSigningRuntimeConfig> {
  if (typeof window !== 'undefined') {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  const encodedSigningSecret = env.MINI_SESSION_SIGNING_SECRET
  if (typeof encodedSigningSecret !== 'string') {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  const sessionSigningSecret = decodeSigningSecret(encodedSigningSecret)
  if (!sessionSigningSecret) {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  return { ok: true, value: { sessionSigningSecret } }
}

export function readMiniTrustedProxyRuntimeConfig(
  env: Environment = process.env,
): ConfigResult<MiniTrustedProxyRuntimeConfig> {
  if (typeof window !== 'undefined') {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  const raw = env.MINI_TRUSTED_PROXY_HOPS
  if (!raw || !/^[1-5]$/.test(raw)) {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  return { ok: true, value: { trustedProxyHops: Number(raw) } }
}

export function readMiniProgramRuntimeConfig(
  env: Environment = process.env,
): MiniProgramRuntimeConfigResult {
  const wechat = readMiniWechatRuntimeConfig(env)
  const signing = readMiniSessionSigningRuntimeConfig(env)
  if (!wechat.ok || !signing.ok) {
    return { ok: false, errorCode: 'mini_program_config_unavailable' }
  }
  return {
    ok: true,
    value: { ...wechat.value, ...signing.value },
  }
}
