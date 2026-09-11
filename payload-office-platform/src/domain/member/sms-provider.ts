/**
 * 短信适配器（OPT-088 §6.2）。三个实现：
 *   console  非生产缺省，把验证码打进日志（脱敏手机号）；
 *   fixture  E2E 用，什么都不发（验证码由 sms-code 的 fixture 模式恒为 123456）；
 *   tencent  腾讯云短信 v20210111 SendSms。
 * 生产未配 SMS_PROVIDER → 返回 null，路由据此回 503；生产取 console / fixture → config-guard 拒绝启动。
 */
import { maskPhone } from '@/domain/shared/phone'

export type SmsProvider = Readonly<{
  name: 'console' | 'fixture' | 'tencent'
  send: (input: { phone: string; code: string; minutes: number }) => Promise<void>
}>

export type SmsEnv = Readonly<
  Partial<
    Record<
      | 'NODE_ENV'
      | 'CI'
      | 'SMS_PROVIDER'
      | 'TENCENT_SMS_SECRET_ID'
      | 'TENCENT_SMS_SECRET_KEY'
      | 'TENCENT_SMS_SDK_APP_ID'
      | 'TENCENT_SMS_SIGN_NAME'
      | 'TENCENT_SMS_TEMPLATE_ID'
      | 'TENCENT_SMS_TEMPLATE_PARAMS'
      | 'TENCENT_SMS_REGION',
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

export function collectSmsProductionViolations(env: SmsEnv): { field: string; reason: string }[] {
  if (env.NODE_ENV !== 'production') return []
  const provider = env.SMS_PROVIDER
  if (!provider) return []
  // CI E2E 允许 fixture 模式（验证码恒为 123456）；真实生产环境（无 CI）严格禁止
  if (env.CI && provider === 'fixture') return []
  if (provider === 'console' || provider === 'fixture') {
    return [
      {
        field: 'SMS_PROVIDER',
        reason: `生产环境不允许 SMS_PROVIDER=${provider}（验证码会进日志或恒为常量）`,
      },
    ]
  }
  if (provider === 'tencent') {
    return missingTencent(env).map((field) => ({ field, reason: 'SMS_PROVIDER=tencent 时必填' }))
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
): SmsProvider | null {
  const provider = env.SMS_PROVIDER
  const isProd = env.NODE_ENV === 'production'
  if (!provider) return isProd ? null : consoleProvider(log)
  if (provider === 'console') return isProd ? null : consoleProvider(log)
  if (provider === 'fixture') return isProd && !env.CI ? null : fixtureProvider()
  if (provider === 'tencent') return tencentProvider(env)
  return null
}
