/**
 * 地理字段一致性守护（OPT-074）
 *
 * ## 为什么这件事不能交给 filterOptions
 *
 * `payload/dist/fields/validations.js` 的 `validateFilterOptions` 在保存时会把
 * `filterOptions` 返回的 where 拿去查库比对当前值——`relationship` 与 `upload`
 * 的 validate 都会调它（仅 `event === 'onChange'` 时跳过）。它拿不到 `originalDoc`，
 * 因此分不清「用户这次选的新值」和「文档里躺着的旧值」。
 *
 * 2026-09-06 实测后果（详见 specs/work-items/OPT-074-location-cascade-selector.md §2.2）：
 * 把某楼盘正在引用的商圈改成 disabled 后，只改该楼盘的摘要也会被拦下，
 * 报错是运营看不懂的「该字段有以下无效的选择：11」。必填与选填字段一样中招。
 * `Buildings.ts` 里「历史已存值不受影响」那句注释是错的。
 *
 * ## 所以校验下沉到 beforeChange
 *
 * 那里能拿到 `originalDoc`，于是可以只校验本次真正改动的值：
 *   - 旧值不动 → 放行（哪怕它现在已经停用了）
 *   - 改成新值 → 严格校验类型、启用、父子一致
 *   - API 直传非法值 → 同样拦下
 *
 * `filterOptions` 相应降级为只收窄 `type`——type 是不变量，历史值不可能违反它。
 */

import type { LocationType } from './location-hierarchy'

export type LocationFieldSpec = {
  /** 文档上的字段名 */
  field: string
  /** 该字段允许指向的地理节点类型；数组表示多选一 */
  type: LocationType | readonly LocationType[]
  /** 父级字段名。给定时校验「本字段所指节点的 parent === 父字段的值」 */
  parentField?: string
  /** 是否 hasMany */
  many?: boolean
  /** 中文字段名，用于错误信息 */
  label: string
}

/**
 * relationship 值 → id 数组。
 * 裸 id、已 populate 的对象、以及它们的数组都吃；形状不认识的元素直接丢弃，不抛错。
 */
export function toLocationIds(value: unknown): Array<number | string> {
  if (value === null || value === undefined) return []

  const one = (v: unknown): number | string | null => {
    if (typeof v === 'number' || typeof v === 'string') return v
    if (typeof v === 'object' && v !== null && 'id' in v) {
      const id = (v as { id: unknown }).id
      return typeof id === 'number' || typeof id === 'string' ? id : null
    }
    return null
  }

  const list = Array.isArray(value) ? value : [value]
  return list.map(one).filter((v): v is number | string => v !== null)
}

/** id 归一化比较键：Payload 的关系值时而是 number 时而是 string */
const key = (id: number | string): string => String(id)

/**
 * 找出本次真正需要校验的 (字段, 节点 id) 对。
 *
 * 跳过的情形：
 *   - 字段本次未提交（`data` 里是 undefined）——patch 式更新不该误伤没碰过的字段
 *   - 值与 `originalDoc` 相同——历史值一律放行，这是本函数存在的全部理由
 *   - 值被清空——是否允许为空由 `required` 管，不归这里
 *   - hasMany 只删不增——删除不会引入新的非法值
 */
export function pendingLocationChecks(
  specs: readonly LocationFieldSpec[],
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown> | null | undefined,
): Array<{ spec: LocationFieldSpec; id: number | string }> {
  const out: Array<{ spec: LocationFieldSpec; id: number | string }> = []

  for (const spec of specs) {
    if (!(spec.field in data) || data[spec.field] === undefined) continue

    const next = toLocationIds(data[spec.field])
    if (next.length === 0) continue

    const previous = new Set(toLocationIds(originalDoc?.[spec.field]).map(key))
    for (const id of next) {
      if (previous.has(key(id))) continue
      out.push({ spec, id })
    }
  }

  return out
}
