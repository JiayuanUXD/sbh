/**
 * 楼盘删除前的守护与清理（OPT-050）。
 *
 * ## 病因
 *
 * 引用 `buildings` 的两个外键都是 `ON DELETE SET NULL`，而目标列是 `NOT NULL`：
 *
 *   listings.building_id                      SET NULL + NOT NULL  ❌
 *   building_merchant_relations.building_id   SET NULL + NOT NULL  ❌
 *
 * PG 置 NULL 时撞非空约束 → 事务中止 → 整个删除回滚。运营看到的只有一个 500，
 * 容器日志里也只剩 `current transaction is aborted`（真正失败的那条语句压根没被记下来）。
 *
 * 房源侧当初栽在同一个病上，见迁移 `20260819_113218_listing_hard_delete_nullable_refs`
 * 的头注释。**楼盘侧漏了。**
 *
 * ## 两张子表性质不同，处方也不同
 *
 * `20260819_113218` 已经确立口径：审计表脱钩保留，纯关系表由钩子删除。
 * 套到楼盘侧：
 *
 * ### `building_merchant_relations` → 删掉
 *
 * 纯关系表。楼盘没了，「楼盘-商户关系」就是垃圾行。与 `listing_merchant_relations`
 * 当初的处理同构。**不放宽 NOT NULL**——那只会留下一堆 `building_id IS NULL`
 * 的无意义关系行。
 *
 * ### `listings` → **拦住，不删也不脱钩**
 *
 * 这是与房源侧最大的不同，**不要照抄脱钩**：
 *
 * - 房源不是审计记录，脱钩后留下的「没有楼盘的房源」毫无意义；
 * - 有效供给 §7 要求房源挂在有效楼盘下，`building_id IS NULL` 的房源前台永远
 *   不可见，等于制造隐形垃圾数据；
 * - 级联删除更糟——删一个楼盘顺手删掉几十套房源，是不可逆的静默数据丢失。
 *
 * 正确语义是**拒绝删除并说清原因**。一个删不掉但说明白为什么的系统，比一个
 * 删不掉且不说话的系统好得多：前者是产品规则，后者是缺陷。
 */

import type { CollectionBeforeDeleteHook } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'

/**
 * 楼盘删除守护 + 关系清理。
 *
 * `beforeDelete` 在 Payload 里对**每个**待删文档各调一次（批量删除也是逐个调），
 * 所以这里只需处理单个 `id`。
 */
export const guardBuildingDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req

  // —— 1. 还有房源挂着就不许删 ——
  //
  // 用 limit:0 + depth:0 只取计数，不拉文档体：一个热门楼盘可能挂着上百套房源，
  // 把它们全查出来只为数个数是纯粹的浪费。
  //
  // 刻意**不排除**已下架 / 软删的房源：它们仍然引用着这个楼盘，外键照样会炸。
  // 判定必须与数据库的实际约束一致，而不是与「业务上还算不算数」一致。
  const listings = await payload.count({
    collection: 'listings',
    where: { building: { equals: id } },
    overrideAccess: true,
    req,
  })

  if (listings.totalDocs > 0) {
    // 拿楼盘名拼文案。查不到就退化成编号——**绝不能因为取名字失败而放行删除**。
    let label = `编号 ${String(id)}`
    try {
      const doc = await payload.findByID({
        collection: 'buildings',
        id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (typeof doc?.name === 'string' && doc.name.trim() !== '') label = doc.name
    } catch {
      // 忽略：文案退化不影响拦截本身
    }

    throw new InvalidOperationError({
      domain: 'supply',
      code: 'BUILDING_HAS_LISTINGS',
      message:
        `楼盘「${label}」下还有 ${listings.totalDocs} 套房源，不能删除。` +
        '请先把这些房源删除或转移到其它楼盘，再删楼盘。' +
        '（如果只是想让它从前台消失，用「下架」即可，不必删除。）',
    })
  }

  // —— 2. 没有房源了，清掉纯关系行 ——
  //
  // 放在拦截之后：楼盘删不成时不该产生任何副作用。
  //
  // 失败必须抛出、不能吞：吞掉的话删除会继续走到 PG，然后撞上
  // SET NULL + NOT NULL 那个死结，用户又会看到一个无法理解的 500。
  await payload.delete({
    collection: 'building-merchant-relations',
    where: { building: { equals: id } },
    overrideAccess: true,
    req,
  })
}
