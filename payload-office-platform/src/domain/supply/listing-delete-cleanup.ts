/**
 * 房源永久删除前的依赖清理
 *
 * 起因：后台「回收站 → 永久删除」恒报 500（Payload 兜底文案 "Something went wrong."）。
 * 真实异常是 PG 23502 not_null_violation——引用 listings 的三张表外键都是
 * `ON DELETE SET NULL`，而那几列本身是 NOT NULL，PG 置 NULL 时直接违反约束。
 *
 * 三张表按语义分两类处理：
 *   - `listing-merchant-relations`：**本模块删掉**。它是纯关系表，房源没了留一行
 *     listing 为空的关系记录没有任何意义，只会变成查询里的垃圾。
 *   - `listing-reviews` / `listing-reports`：**保留并脱钩**（列改可空，走原本的 SET NULL）。
 *     它们是审计，房源删了记录也该在；而且 listing-reviews 自带 `snapshot`，
 *     脱钩之后仍然能看出当时审的是什么。
 *
 * 为什么不直接把关系表的外键改成 `ON DELETE CASCADE`：Payload 的 drizzle 适配器
 * 对 relationship 字段**恒生成 `set null`**，且 schema 快照（`src/migrations/*.json`）
 * 会跟踪 `onDelete`。手工改成 cascade 之后，下一次任何人跑 `payload migrate:create`
 * 都会把它当作漂移、生成一条改回 `set null` 的迁移——修复会被静默撤销。
 * 放在 hook 里语义相同，但不与生成器打架。
 *
 * 只在**硬删除**触发：软删除（`trash: true`，后台点「删除」的默认行为）走的是
 * update 路径，不经过 beforeDelete，因此回收站里的房源不会被这里清理掉。
 */

import type { CollectionBeforeDeleteHook } from 'payload'

/**
 * 永久删除房源前，先删掉它的商户供给关系。
 *
 * 用 `req` 传递上下文，与本次删除同一请求；`overrideAccess: true` 是必要的——
 * 调用方已经通过了 listings 的删除权限校验，不该再被关系表的字段级权限二次拦截，
 * 否则会出现「房源删了一半、关系还在」这种比原 bug 更糟的中间态。
 */
export const cleanupListingRelations: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await req.payload.delete({
    collection: 'listing-merchant-relations',
    where: { listing: { equals: id } },
    overrideAccess: true,
    req,
  })
}
