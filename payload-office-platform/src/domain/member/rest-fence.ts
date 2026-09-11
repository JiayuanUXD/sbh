/**
 * Payload 给每个 auth collection 都挂 login / logout / refresh-token / me / first-register /
 * forgot-password / reset-password / unlock / verify 九个 REST 端点。会员的 HTTP 入口全在
 * /api/member/*（注意单数），这九个对 members 一律 404：它们会发 payload-token cookie、
 * 绕过我们的限流与同意校验，first-register 在表空时还能匿名建号。
 * 文档 REST（/api/members、/api/members/:id）不拦——后台编辑会员要用，且已有 access 把关。
 */
export const BLOCKED_MEMBER_AUTH_PATHS = [
  'login',
  'logout',
  'refresh-token',
  'me',
  'first-register',
  'forgot-password',
  'reset-password',
  'unlock',
  'verify',
] as const

export function isBlockedMemberAuthPath(segments: readonly string[] | undefined): boolean {
  if (!segments || segments.length < 2) return false
  if (segments[0] !== 'members') return false
  return (BLOCKED_MEMBER_AUTH_PATHS as readonly string[]).includes(segments[1])
}
