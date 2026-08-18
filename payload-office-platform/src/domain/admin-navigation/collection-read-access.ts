import type { SanitizedPermissions } from 'payload'

/**
 * Payload 的 collection `read` 权限有两种形态：
 *
 *   - `true` —— 无条件可读
 *   - `{ permission: true, where: {...} }` —— 可读，但结果被 where 收窄（数据范围）
 *
 * 只判 `read === true` 会把第二种误判成「没权限」。后果不是报错而是**静默消失**：
 * 用户能直接用 URL 打开该页面、列表也查得出数据，侧边栏却没有入口，看起来像功能
 * 被删了。
 *
 * 真实事故：审核队列对带城市范围的账号长期不可见 —— `ListingReviews.read` 返回
 * `buildReviewCityScopeWhere(...) ?? true`，城市范围账号拿到的是
 * `{permission: true, where: {'listing.building.city': {in: [1]}}}`，于是
 * `=== true` 为假，导航把整个「审核队列」吞掉。
 *
 * 这个函数只回答「能不能读」。where 不在这里处理，Payload 会在实际查询时施加它。
 */
export function canReadCollection(
  permissions: SanitizedPermissions | undefined,
  slug: string,
): boolean {
  const read = permissions?.collections?.[slug]?.read

  if (read === true) return true

  // 收窄形态：只认显式 permission === true，不因为「是个对象」就放行，
  // 否则 { permission: false, ... } 这种拒绝会被当成通过。
  if (typeof read === 'object' && read !== null) {
    return (read as { permission?: unknown }).permission === true
  }

  return false
}
