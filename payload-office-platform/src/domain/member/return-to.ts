/** 登录后回跳只认站内路径（OPT-088 §8.3 / S2 防御）：开放重定向是登录页最常见的漏洞。 */
export function safeReturnTo(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string') return fallback
  if (value.length > 500) return fallback
  // S2 防御：严格拒绝 ASCII 控制字符（如 \t, \r, \n, 0x00-0x1F, 0x7F），防止浏览器客户端 WHATWG URL 解析时剥除控制字符外跳
  if (/[\x00-\x1f\x7f]/.test(value)) return fallback
  // 严禁协议相对路径或反斜杠
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  try {
    const dummyBase = 'http://localhost'
    const parsed = new URL(value, dummyBase)
    if (parsed.origin !== dummyBase) return fallback
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) return fallback
  } catch {
    return fallback
  }
  return value
}
