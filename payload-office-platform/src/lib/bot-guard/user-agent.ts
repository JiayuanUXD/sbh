/**
 * 脚本 UA 规则（纯函数）。UA 可伪造，这条只挡偷懒的脚本，价值是几乎零误伤。
 * 不拦微信 / 微博分享卡片抓取与 Lighthouse（它们有各自 UA，不在名单内）。
 * 名单是常量，增减不需要改逻辑。
 */
export type UaVerdict = Readonly<{ deny: boolean; rule: string | null; family: string }>

export const DENY_UA_RULES: ReadonlyArray<Readonly<{ name: string; pattern: RegExp }>> = [
  { name: 'python-requests', pattern: /python-requests/i },
  { name: 'python-urllib', pattern: /python-urllib/i },
  { name: 'aiohttp', pattern: /aiohttp/i },
  { name: 'httpx', pattern: /httpx/i },
  { name: 'curl', pattern: /(?:^|[^a-z])curl\//i },
  { name: 'wget', pattern: /(?:^|[^a-z])wget\//i },
  { name: 'libwww-perl', pattern: /libwww-perl/i },
  { name: 'go-http-client', pattern: /go-http-client/i },
  { name: 'java', pattern: /^java\//i },
  { name: 'apache-httpclient', pattern: /apache-httpclient/i },
  { name: 'scrapy', pattern: /scrapy/i },
  { name: 'node-fetch', pattern: /node-fetch/i },
  { name: 'axios', pattern: /axios/i },
  { name: 'headlesschrome', pattern: /headlesschrome/i },
  { name: 'phantomjs', pattern: /phantomjs/i },
]

const FAMILY_MAX_LENGTH = 24
const FAMILY_PATTERN = /^[A-Za-z0-9._-]+/

/** 日志用 UA 族名：首个产品令牌，只保留 [A-Za-z0-9._-]，截断到 24，取不到为 other。 */
function extractFamily(ua: string): string {
  const head = ua.trimStart().slice(0, 256)
  const match = FAMILY_PATTERN.exec(head)
  return match ? match[0].slice(0, FAMILY_MAX_LENGTH) : 'other'
}

export function classifyUserAgent(ua: string | null): UaVerdict {
  if (ua === null || ua.trim() === '') {
    return { deny: true, rule: 'empty', family: 'other' }
  }
  const family = extractFamily(ua)
  for (const rule of DENY_UA_RULES) {
    if (rule.pattern.test(ua)) return { deny: true, rule: rule.name, family }
  }
  return { deny: false, rule: null, family }
}
