/**
 * 短信适配器（OPT-088 §6.2）。四个实现：
 *   console  非生产缺省，把验证码打进日志（脱敏手机号）；
 *   fixture  E2E 用，什么都不发（验证码由 sms-code 的 fixture 模式恒为 123456）；
 *   tencent  腾讯云短信 v20210111 SendSms；
 *   cloudmarket  腾讯云云市场 API 网关上的第三方短信（杭州华际云数「短信验证码」，产品 32818）。
 * 生产未配 SMS_PROVIDER → 返回 null，路由据此回 503；生产取 console / fixture → config-guard 拒绝启动。
 *
 * cloudmarket 的鉴权是云市场网关通用签名（两份独立公开实现一致，2026-09-11 核对）：
 *   x-date   = 当前 GMT 时间字符串（`Date#toUTCString()`）
 *   签名原文 = `x-date: ${x-date}`
 *   signature = Base64(HMAC-SHA1(secretKey, 签名原文))
 *   Authorization = JSON `{"id": secretId, "x-date": x-date, "signature": signature}`
 * 请求体是 x-www-form-urlencoded：mobile / templateId / tag（模板变量，多个用竖线分隔）。
 * 响应 JSON 的 code === 200 才算发出；HTTP >= 300 网关不计费也不发。
 */
import { createHmac, randomUUID } from 'node:crypto'
import { maskPhone } from '@/domain/shared/phone'

export type SmsProvider = Readonly<{
  name: 'console' | 'fixture' | 'tencent' | 'cloudmarket'
  send: (input: { phone: string; code: string; minutes: number }) => Promise<void>
}>

export type SmsEnv = Readonly<
  Partial<
    Record<
      | 'NODE_ENV'
      | 'CI'
      | 'MEMBER_SMS_FIXTURE'
      | 'SMS_PROVIDER'
      | 'TENCENT_SMS_SECRET_ID'
      | 'TENCENT_SMS_SECRET_KEY'
      | 'TENCENT_SMS_SDK_APP_ID'
      | 'TENCENT_SMS_SIGN_NAME'
      | 'TENCENT_SMS_TEMPLATE_ID'
      | 'TENCENT_SMS_TEMPLATE_PARAMS'
      | 'TENCENT_SMS_REGION'
      | 'CLOUDMARKET_SMS_SECRET_ID'
      | 'CLOUDMARKET_SMS_SECRET_KEY'
      | 'CLOUDMARKET_SMS_TEMPLATE_ID'
      | 'CLOUDMARKET_SMS_TAG_PARAMS'
      | 'CLOUDMARKET_SMS_ENDPOINT',
      string
    >
  >
>

const TENCENT_REQUIRED = [
  'TENCENT_SMS_SECRET_ID',
  'TENCENT_SMS_SECRET_KEY',
  'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME',
  'TENCENT_SMS_TEMPLATE_ID',
] as const

export function expandTemplateParams(
  pattern: string | undefined,
  code: string,
  minutes: number,
): string[] {
  const p = pattern && pattern.trim().length > 0 ? pattern : '{code},{minutes}'
  return p
    .split(',')
    .map((s) => s.trim().replace('{code}', code).replace('{minutes}', String(minutes)))
}

function missingTencent(env: SmsEnv): string[] {
  return TENCENT_REQUIRED.filter((k) => !env[k] || env[k]!.trim().length === 0)
}

const CLOUDMARKET_REQUIRED = [
  'CLOUDMARKET_SMS_SECRET_ID',
  'CLOUDMARKET_SMS_SECRET_KEY',
  'CLOUDMARKET_SMS_TEMPLATE_ID',
] as const

/** 产品页给出的调用地址；服务商换地址时用 CLOUDMARKET_SMS_ENDPOINT 覆盖，不改代码。 */
export const CLOUDMARKET_SMS_DEFAULT_ENDPOINT =
  'https://ap-shanghai.cloudmarket-apigw.com/service-5ipqbocr/sms/send'

function fixtureAllowedInProduction(env: SmsEnv): boolean {
  return Boolean(env.CI) && env.MEMBER_SMS_FIXTURE === '1'
}

function missingCloudMarket(env: SmsEnv): string[] {
  return CLOUDMARKET_REQUIRED.filter((k) => !env[k] || env[k]!.trim().length === 0)
}

export function cloudMarketSignature(secretKey: string, xDate: string): string {
  return createHmac('sha1', secretKey).update(`x-date: ${xDate}`, 'utf8').digest('base64')
}

export function buildCloudMarketAuthorization(
  secretId: string,
  secretKey: string,
  now: Date,
): { xDate: string; authorization: string } {
  const xDate = now.toUTCString()
  const signature = cloudMarketSignature(secretKey, xDate)
  return { xDate, authorization: JSON.stringify({ id: secretId, 'x-date': xDate, signature }) }
}

/** 可注入的外部依赖：单测用假 fetch 验请求形状，生产用全局 fetch。 */
export type CloudMarketSmsDeps = Readonly<{
  fetch: typeof fetch
  now: () => Date
  requestId: () => string
}>

const defaultCloudMarketDeps: CloudMarketSmsDeps = {
  fetch: (...args) => fetch(...args),
  now: () => new Date(),
  requestId: () => randomUUID(),
}

function cloudMarketProvider(env: SmsEnv, deps: CloudMarketSmsDeps): SmsProvider {
  const missing = missingCloudMarket(env)
  if (missing.length > 0) throw new Error(`SMS_PROVIDER=cloudmarket 缺少 ${missing.join(', ')}`)
  const endpoint = env.CLOUDMARKET_SMS_ENDPOINT?.trim() || CLOUDMARKET_SMS_DEFAULT_ENDPOINT
  return {
    name: 'cloudmarket',
    send: async ({ phone, code, minutes }) => {
      const { authorization } = buildCloudMarketAuthorization(
        env.CLOUDMARKET_SMS_SECRET_ID!,
        env.CLOUDMARKET_SMS_SECRET_KEY!,
        deps.now(),
      )
      // 模板变量缺省只有验证码（模板形如「注册验证码 @`code`@」）；多变量用竖线分隔是服务商约定
      const tag = expandTemplateParams(env.CLOUDMARKET_SMS_TAG_PARAMS || '{code}', code, minutes).join('|')
      const body = new URLSearchParams({
        mobile: phone,
        templateId: env.CLOUDMARKET_SMS_TEMPLATE_ID!,
        tag,
      })
      const res = await deps.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'request-id': deps.requestId(),
          Authorization: authorization,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      })
      // 错误信息只带状态与服务商 msg，永远不带验证码本身
      if (res.status >= 300) {
        throw new Error(`云市场短信网关 HTTP ${res.status}`)
      }
      let parsed: unknown = null
      try {
        parsed = await res.json()
      } catch {
        throw new Error('云市场短信网关返回了非 JSON 响应')
      }
      const record = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      if (record.code !== 200) {
        const msg = typeof record.msg === 'string' ? record.msg : ''
        throw new Error(`云市场短信发送失败：code=${String(record.code ?? 'none')} ${msg}`)
      }
    },
  }
}

export function collectSmsProductionViolations(env: SmsEnv): { field: string; reason: string }[] {
  if (env.NODE_ENV !== 'production') return []
  const provider = env.SMS_PROVIDER
  if (!provider) return []
  // fixture 在生产构建下只给 CI 的 E2E 用：必须同时有 CI 与显式的 MEMBER_SMS_FIXTURE=1。
  // 生产容器（Dockerfile / CloudRun 服务级变量）两个都不设。不再按站点域名猜——CI 的
  // NEXT_PUBLIC_SITE_URL 就是线上域名（canonical/sitemap 要它），按域名判会把 CI 自己拒掉。
  if (provider === 'fixture') {
    if (fixtureAllowedInProduction(env)) return []
    return [
      {
        field: 'SMS_PROVIDER',
        reason: '生产环境不允许 SMS_PROVIDER=fixture（验证码恒为常量）',
      },
    ]
  }
  if (provider === 'console') {
    return [
      {
        field: 'SMS_PROVIDER',
        reason: '生产环境不允许 SMS_PROVIDER=console（验证码会进日志）',
      },
    ]
  }
  if (provider === 'tencent') {
    return missingTencent(env).map((field) => ({ field, reason: 'SMS_PROVIDER=tencent 时必填' }))
  }
  if (provider === 'cloudmarket') {
    return missingCloudMarket(env).map((field) => ({ field, reason: 'SMS_PROVIDER=cloudmarket 时必填' }))
  }
  return [{ field: 'SMS_PROVIDER', reason: `未知取值 ${provider}` }]
}

function consoleProvider(log: (msg: string) => void): SmsProvider {
  return {
    name: 'console',
    send: async ({ phone, code }) => {
      log(`[sms:console] phone=${maskPhone(phone)} code=${code}`)
    },
  }
}

function fixtureProvider(): SmsProvider {
  return { name: 'fixture', send: async () => undefined }
}

function tencentProvider(env: SmsEnv): SmsProvider {
  const missing = missingTencent(env)
  if (missing.length > 0) throw new Error(`SMS_PROVIDER=tencent 缺少 ${missing.join(', ')}`)
  return {
    name: 'tencent',
    send: async ({ phone, code, minutes }) => {
      // 动态 import：SDK 只在真的发短信时加载，单测与 console 模式不碰它。
      const { sms } = await import('tencentcloud-sdk-nodejs-sms')
      const Client = sms.v20210111.Client
      const client = new Client({
        credential: {
          secretId: env.TENCENT_SMS_SECRET_ID!,
          secretKey: env.TENCENT_SMS_SECRET_KEY!,
        },
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
      })
      const res = await client.SendSms({
        PhoneNumberSet: [`+86${phone}`],
        SmsSdkAppId: env.TENCENT_SMS_SDK_APP_ID!,
        SignName: env.TENCENT_SMS_SIGN_NAME!,
        TemplateId: env.TENCENT_SMS_TEMPLATE_ID!,
        TemplateParamSet: expandTemplateParams(env.TENCENT_SMS_TEMPLATE_PARAMS, code, minutes),
      })
      const status = res.SendStatusSet?.[0]
      if (!status || status.Code !== 'Ok') {
        throw new Error(`腾讯云短信发送失败：${status?.Code ?? 'no-status'} ${status?.Message ?? ''}`)
      }
    },
  }
}

export function resolveSmsProvider(
  env: SmsEnv,
  log: (msg: string) => void,
  cloudMarketDeps: CloudMarketSmsDeps = defaultCloudMarketDeps,
): SmsProvider | null {
  const provider = env.SMS_PROVIDER
  const isProd = env.NODE_ENV === 'production'
  if (!provider) return isProd ? null : consoleProvider(log)
  if (provider === 'console') return isProd ? null : consoleProvider(log)
  if (provider === 'fixture') {
    if (isProd) return fixtureAllowedInProduction(env) ? fixtureProvider() : null
    return fixtureProvider()
  }
  if (provider === 'tencent') return tencentProvider(env)
  if (provider === 'cloudmarket') return cloudMarketProvider(env, cloudMarketDeps)
  return null
}
