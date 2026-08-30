/**
 * 房源「房间号」的归一化与同楼盘唯一性校验（OPT-063）。
 *
 * ## 为什么唯一性要在 hook 里主动查，而不是只靠数据库唯一索引
 *
 * `Listings` 上确实建了 `(building, roomNumber)` 的唯一索引作为并发兜底，但**报错文案
 * 不能指望它**：Payload 3.86 + drizzle 会把所有唯一冲突统一转成 `ValidationError`，
 * `err.cause.code === '23505'` 恒为 false（本仓库已因此写过 7 处死兜底，见
 * `src/domain/shared/unique-violation.ts` 头注释）。用户能看到的只有一句泛泛的校验失败，
 * 说不清"跟谁撞了"，更说不清"撞的那条已经在回收站里"。
 *
 * 所以分工是：**这里负责人话报错，索引负责并发兜底**。
 *
 * ## 为什么查重必须带 `trash: true`
 *
 * 唯一索引覆盖软删行（PG 唯一索引没法在 Payload 配置里带 `WHERE deleted_at IS NULL`
 * 谓词，而手写偏索引要么改生成的迁移正文——仓库明令禁止，要么留一个 drizzle 快照看不见
 * 的影子 schema）。既然索引"软删也占号"，查重就必须同口径，否则会出现
 * **hook 放行 → 数据库拒绝 → 用户看到一句看不懂的话**，正是这个模块想避免的那种体验。
 *
 * 软删命中时给的是另一套文案：明确指路回收站，因为那条冲突房源在列表里根本看不见。
 */

import { ValidationError } from 'payload'
import type { CollectionBeforeValidateHook, Where } from 'payload'

/**
 * 归一化房间号：去首尾空白，空串折成 `null`。
 *
 * 这一步是必需项不是锦上添花——后台文本框清空后提交的是**空串**而不是 null，
 * 而 PG 唯一索引里 `NULL` 互不冲突、空串却会互相冲突。不归一就会出现
 * 「两条都没填房间号的房源不能共存」这种荒谬行为。
 */
export function normalizeRoomNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

/** 关系字段在 hook 里可能是 id、也可能是已填充的对象，统一取 id。 */
function toRelationId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/**
 * 归一化 hook。只在本次提交**确实带了** `roomNumber` 时改写——
 * REST PATCH 是部分更新，没带的字段不能被顺手写成 null。
 */
export const normalizeListingRoomNumber: CollectionBeforeValidateHook = ({ data }) => {
  if (!data || !('roomNumber' in data)) return data
  return { ...data, roomNumber: normalizeRoomNumber(data.roomNumber) }
}

/**
 * 同楼盘唯一性校验 hook。排在 `normalizeListingRoomNumber` 之后，读到的已是归一值。
 *
 * 触发条件刻意收窄：只有「最终的房间号非空」且「最终的所属楼盘有值」才查库。
 * 部分更新时另一半从 `originalDoc` 取——只改楼盘不改房间号同样可能撞号，
 * 只看 `data` 会漏掉这条路径。
 */
export const assertListingRoomNumberUnique: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const roomNumber =
    'roomNumber' in data
      ? normalizeRoomNumber(data.roomNumber)
      : normalizeRoomNumber(originalDoc?.roomNumber)
  if (roomNumber === null) return data

  const buildingId = toRelationId('building' in data ? data.building : originalDoc?.building)
  if (buildingId === null) return data

  const currentId = originalDoc?.id ?? null
  const conditions: Where[] = [
    { building: { equals: buildingId } },
    { roomNumber: { equals: roomNumber } },
  ]
  if (currentId !== null && currentId !== undefined) {
    conditions.push({ id: { not_equals: currentId } })
  }

  const conflicts = await req.payload.find({
    collection: 'listings',
    where: { and: conditions },
    limit: 1,
    depth: 0,
    // 与唯一索引同口径：软删房源也占号，见文件头注释。
    trash: true,
    // 校验是系统行为，不该受调用方身份影响；显式写出来而不是靠默认值。
    overrideAccess: true,
    // 传 req 让这次查询留在同一个事务里，读得到本事务内的未提交写入。
    req,
  })

  const conflict = conflicts.docs[0]
  if (!conflict) return data

  const conflictTitle =
    typeof conflict.title === 'string' && conflict.title.trim() !== ''
      ? conflict.title.trim()
      : `#${conflict.id}`
  const message = conflict.deletedAt
    // 不要在这里写 markdown：Payload 把校验消息当纯文本渲染，`**x**` 会原样显示成星号。
    ? `房间号「${roomNumber}」已被同楼盘一条已删除的房源占用（${conflictTitle}）。请先到回收站恢复或彻底删除该房源，再使用这个房间号。`
    : `房间号「${roomNumber}」在同一楼盘下已被「${conflictTitle}」占用，请换一个。`

  throw new ValidationError({
    collection: 'listings',
    errors: [{ path: 'roomNumber', message }],
    req,
  })
}
