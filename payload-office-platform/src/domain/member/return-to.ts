/** 登录后回跳只认站内路径（OPT-088 §8.3）：开放重定向是登录页最常见的漏洞。 */
export function safeReturnTo(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  if (value.length > 500) return fallback
  return value
}
