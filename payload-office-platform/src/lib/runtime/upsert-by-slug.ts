/**
 * seed 脚本共用的「按 slug 幂等 upsert」。
 *
 * ## 为什么必须带 `trash: true`（这是本文件存在的唯一理由）
 *
 * Articles / Buildings / Listings / Pages 都开了 collection 级 `trash: true`。软删的行
 * **不会出现在默认查询里**，但 `slug` 的 unique 约束是数据库级的、对软删行照样生效。
 * 于是漏掉 `trash: true` 会走成：
 *
 *   回收站里有同 slug 的行 → find 查不到 → 判定「不存在」→ payload.create
 *   → 撞 slug unique 约束 → 整个 seed 以
 *     `ValidationError: 下面的字段是无效的： slug`
 *   失败，而报错里既没有 collection 名也没有 slug，完全看不出根因。
 *
 * 2026-08-31 实测复现：把任意一条 seed 覆盖的房源软删
 * （`PATCH /api/listings/<id>` 带 `{ deletedAt: <iso> }`），`pnpm seed` 必然在
 * "Upserting listings..." 之后失败；恢复该行后立刻成功。
 * 见 `artifacts/verification/OPT-063/本地验收.md` §八。
 *
 * 命中软删行时先把 `deletedAt` 置空（恢复）再更新，否则 seed 「成功」了，
 * 东西却还躺在回收站里——C 端与后台默认列表都看不到，等同于夹具缺失。
 *
 * `trash` 对**没开 trash 的集合**（如 locations）是 no-op，不会报错：
 * Payload 3.86 的 `appendNonTrashedFilter` 首行就是
 * `if (!enableTrash || trash) return where`。
 */

/** seed 脚本只用到 payload 的这三个方法；收窄成结构类型便于单测注入假实现。 */
export type SeedPayloadLike = {
  find(args: {
    collection: string
    limit?: number
    trash?: boolean
    where?: Record<string, unknown>
  }): Promise<{ docs: Array<{ id: number | string; deletedAt?: string | null }> }>
  update(args: {
    collection: string
    id: number | string
    data: Record<string, unknown>
    trash?: boolean
  }): Promise<unknown>
  create(args: { collection: string; data: Record<string, unknown> }): Promise<unknown>
}

/** 带软删标记的行；没开 trash 的集合上 deletedAt 恒为 undefined。 */
export type TrashableDoc = { id: number | string; deletedAt?: string | null }

/**
 * 要写进 update 的数据：命中回收站里的行时顺带把 `deletedAt` 置空（恢复）。
 *
 * 未软删的行不要平白写一个 `deletedAt: null`——在没开 trash 的集合（如 locations）上
 * 那是个不存在的字段。配合调用方给 `payload.update` 传 `trash: true` 使用，否则
 * updateByID 自己那层 appendNonTrashedFilter 同样定位不到软删的行。
 */
export function withRestore(
  data: Record<string, unknown>,
  doc: TrashableDoc,
): Record<string, unknown> {
  return doc.deletedAt ? { ...data, deletedAt: null } : data
}

export type UpsertBySlugResult<T> = {
  /** true = 走了 create；false = 命中已有行（含从回收站恢复的行）走了 update。 */
  created: boolean
  doc: T
}

export async function upsertBySlug<T>(
  payload: SeedPayloadLike,
  collection: string,
  slug: string,
  data: Record<string, unknown>,
): Promise<UpsertBySlugResult<T>> {
  const existing = await payload.find({
    collection,
    limit: 1,
    trash: true,
    where: {
      slug: {
        equals: slug,
      },
    },
  })

  const found = existing.docs[0]
  if (found) {
    // immutableCode 由 protectLocation hook 保证不可变，update 时带上它会被直接拒绝
    // （IMMUTABLE_CODE）。存量库里上海的码是历史遗留的 'SH'，若把它塞进 update，
    // seed 会在所有已有开发库上失败。更新只写可变字段，建码只在 create 时生效。
    const { immutableCode: _immutableCode, ...mutableData } = data
    const doc = await payload.update({
      collection,
      id: found.id,
      data: withRestore(mutableData, found),
      trash: true,
    })
    return { created: false, doc: doc as T }
  }

  const doc = await payload.create({
    collection,
    data: {
      ...data,
      slug,
    },
  })
  return { created: true, doc: doc as T }
}
