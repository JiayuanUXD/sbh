import type { Metadata } from 'next'

/**
 * 搜索引擎站长平台的「网站验证」标记（OPT-123）。
 *
 * 验证码由各平台控制台发放，不是密钥，但随账号变化，所以走**服务级运行时环境变量**
 * 而不是写死在代码里：拿到验证码后在 CloudRun 控制台配上、重启即可，不必改代码重新发版。
 * 这三个只在服务端读取（不带 NEXT_PUBLIC_ 前缀），所以改了不需要重新构建。
 *
 * - `SITE_VERIFY_GOOGLE` → `<meta name="google-site-verification">`
 * - `SITE_VERIFY_BAIDU`  → `<meta name="baidu-site-verification">`
 * - `SITE_VERIFY_BING`   → `<meta name="msvalidate.01">`
 *
 * 全部缺省时返回 `undefined`，页面里不输出任何验证标签。
 */
export type SiteVerificationEnv = Readonly<{
  SITE_VERIFY_GOOGLE?: string
  SITE_VERIFY_BAIDU?: string
  SITE_VERIFY_BING?: string
}>

// 验证码只会是字母、数字与 `_` `-` `=` `.`；其它字符一律当作配错而丢弃，
// 避免环境变量里混进引号 / 尖括号后把 meta 标签写坏。
const TOKEN_PATTERN = /^[A-Za-z0-9_\-=.]{6,200}$/

function token(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && TOKEN_PATTERN.test(trimmed) ? trimmed : undefined
}

export function resolveSiteVerification(env: SiteVerificationEnv): Metadata['verification'] | undefined {
  const google = token(env.SITE_VERIFY_GOOGLE)
  const baidu = token(env.SITE_VERIFY_BAIDU)
  const bing = token(env.SITE_VERIFY_BING)
  if (!google && !baidu && !bing) return undefined

  const other: Record<string, string> = {}
  if (baidu) other['baidu-site-verification'] = baidu
  if (bing) other['msvalidate.01'] = bing

  return {
    ...(google ? { google } : {}),
    ...(Object.keys(other).length > 0 ? { other } : {}),
  }
}

/** 读取当前进程环境。写成静态成员表达式，便于一眼看出依赖了哪几个变量。 */
export function readSiteVerification(): Metadata['verification'] | undefined {
  return resolveSiteVerification({
    SITE_VERIFY_GOOGLE: process.env.SITE_VERIFY_GOOGLE,
    SITE_VERIFY_BAIDU: process.env.SITE_VERIFY_BAIDU,
    SITE_VERIFY_BING: process.env.SITE_VERIFY_BING,
  })
}
