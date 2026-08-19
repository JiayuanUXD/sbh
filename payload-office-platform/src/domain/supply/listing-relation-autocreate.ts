/**
 * 新建房源时自动创建商户供给关系
 *
 * 起因：管理员保存即发布（OPT-033）绕过完整度校验，而完整度清单里恰好有
 * 「请确保存在当前有效的商户供给关系」。于是新建的房源可以立刻变成「已发布」，
 * 却因为 `listing-merchant-relations` 里一条记录都没有而在前台不可见——
 * 真实案例：生产 listing #2464「test08192325」，自身条件全齐、前台查无此房。
 *
 * 单靠给 `listings.merchant` 加默认值解决不了这个问题，反而更糟：完整度校验用
 * `snapshot.merchant != null` **近似**判断「有没有有效商户关系」，字段一填完整度就
 * 变绿，唯一的警告信号也没了。本 hook 把那个近似**变成真的**——字段有值时，
 * 关系记录也确实存在。
 *
 * ## 为什么失败不阻断房源创建
 *
 * 关系表的 protect hook 有准入门禁：商户必须启用、资质有效、**服务城市覆盖房源
 * 所在城市**。而默认商户「官网」目前只服务上海（2026-08-19 实测）。平台是七城，
 * 一旦在其他城市建房源，自动建关系必然被门禁拒绝。
 *
 * 若让它抛错，等于「非上海城市无法新建房源」——为了一个便利功能把主流程打死。
 * 所以这里吞掉异常并记 warn 日志：房源照常创建，只是没有关系、前台不可见，
 * 与本 hook 出现之前的行为一致，不产生新的破坏。
 *
 * 当前 7 城里只有上海有供给（72 楼盘 / 2214 房源，其余 6 城为 0），所以实际
 * 覆盖率是 100%；扩城时需要给对应商户补 serviceCities，否则会退回静默不可见。
 *
 * ## 只在 create 触发
 *
 * 编辑房源改 `merchant` 字段**不会**新建关系——关系有自己的有效期语义（快照 +
 * 半开区间 + 不重叠），换商户是一次显式的供给关系变更，应当在关系表里操作，
 * 不能靠改一个字段悄悄发生。
 */

import type { CollectionAfterChangeHook } from 'payload'

/** relationship 值可能是 id 或已 populate 的对象；统一取 id。 */
export function toRelationId(value: unknown): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

export const autoCreateListingRelation: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  const listing = doc as Record<string, unknown>
  const merchantId = toRelationId(listing.merchant)
  // 没有商户就没什么可建的——不猜、不兜底选一个，否则会造出运营没预期的供给关系。
  if (merchantId === null) return doc

  try {
    await req.payload.create({
      collection: 'listing-merchant-relations',
      data: {
        listing: listing.id as number,
        merchant: merchantId as number,
        effectiveFrom: new Date().toISOString(),
        createdReason: '新建房源时自动创建（默认供给商户）',
      } as never,
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // 不阻断：见文件头「为什么失败不阻断房源创建」。
    // 记 warn 而不是静默——否则扩城后「前台看不到」会毫无线索。
    req.payload.logger.warn(
      {
        listingId: listing.id,
        merchantId,
        err: error instanceof Error ? error.message : String(error),
      },
      '[supply] 新建房源时自动创建商户供给关系失败；房源已创建但前台不可见，需手工补关系',
    )
  }

  return doc
}
