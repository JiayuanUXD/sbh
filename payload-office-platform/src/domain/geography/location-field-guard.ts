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

import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'

import { InvalidOperationError } from '@/domain/shared/errors'
import { LOCATION_TYPE_LABELS, type LocationType } from './location-hierarchy'

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

type LoadedNode = {
  id: number | string
  name?: unknown
  type?: unknown
  parent?: unknown
  status?: unknown
}

const nameOf = (node: LoadedNode | undefined, fallback: number | string): string =>
  typeof node?.name === 'string' && node.name !== '' ? node.name : `#${fallback}`

const labelOf = (type: unknown): string =>
  LOCATION_TYPE_LABELS[type as LocationType] ?? '未知类型'

/**
 * 批量加载节点。合并成一次 find —— 楼盘表单一次可能要校验 3 个字段外加它们的父级。
 *
 * 用 find 而不是 findByID：查不到只是 docs 里缺项，不会走 Payload 的 NotFound 路径，
 * 因此不需要 findByIdSafe 那层防护（后者是为了避免 killTransaction 回滚调用方事务）。
 * overrideAccess 显式为 true：这是服务端不变量校验，必须看得见全部地理节点，
 * 不能因为当前用户的数据权限收窄而误判「父级不存在」。
 */
async function loadNodes(
  req: PayloadRequest,
  ids: Array<number | string>,
): Promise<Map<string, LoadedNode>> {
  if (ids.length === 0) return new Map()

  const { docs } = await req.payload.find({
    collection: 'locations' as never,
    where: { id: { in: ids } },
    depth: 0,
    limit: ids.length,
    pagination: false,
    overrideAccess: true,
    req,
  })

  return new Map((docs as LoadedNode[]).map((d) => [String(d.id), d]))
}

/**
 * 产出 beforeChange hook：校验「类型正确 + 已启用 + 父子一致」，
 * 但**只对本次真正改动的值**生效（理由见 pendingLocationChecks 的注释）。
 *
 * 错误一律抛 InvalidOperationError（422），文案说人话 —— 替代 Payload 原生的
 * 「该字段有以下无效的选择：11」，那句话运营看不懂。
 *
 * 不在这里 try/catch：hook 里吞异常会让 Payload 的 killTransaction 回滚整个
 * req 事务，写入会「成功返回但没落库」（见 domain/shared/transaction-safety.ts）。
 */
export function createLocationFieldGuard(
  specs: readonly LocationFieldSpec[],
): CollectionBeforeChangeHook {
  // 具名函数：hook 在各 collection 的 beforeChange 数组里可辨认（边界守卫测试
  // 按 name 断言身份而不只是数量），出错时堆栈也能直接指到这里。
  return async function locationFieldGuard({ data, originalDoc, req }) {
    const doc = (data ?? {}) as Record<string, unknown>
    const pending = pendingLocationChecks(specs, doc, originalDoc)
    if (pending.length === 0) return data

    /** 父字段的当前值：本次改了用新的，没改用 originalDoc 的 */
    const parentValueOf = (spec: LocationFieldSpec): Array<number | string> =>
      spec.parentField
        ? toLocationIds(
            spec.parentField in doc ? doc[spec.parentField] : originalDoc?.[spec.parentField],
          )
        : []

    // 待校验节点 + 它们各自父字段的当前值，合并成一次查询
    const seen = new Set<string>()
    const ids: Array<number | string> = []
    const push = (id: number | string) => {
      if (seen.has(key(id))) return
      seen.add(key(id))
      ids.push(id)
    }
    for (const { spec, id } of pending) {
      push(id)
      for (const pid of parentValueOf(spec)) push(pid)
    }

    const nodes = await loadNodes(req, ids)

    for (const { spec, id } of pending) {
      const node = nodes.get(key(id))
      const label = spec.label

      if (!node) {
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'LOCATION_NOT_FOUND',
          message: `${label}指向的地理节点不存在（#${id}）`,
          details: { field: spec.field, id },
        })
      }

      const allowed = Array.isArray(spec.type) ? spec.type : [spec.type as LocationType]
      if (!allowed.includes(node.type as LocationType)) {
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'LOCATION_TYPE_MISMATCH',
          message: `${label}只能选择${allowed.map(labelOf).join(' / ')}，「${nameOf(node, id)}」是${labelOf(node.type)}`,
          details: { field: spec.field, id, expected: allowed, actual: node.type },
        })
      }

      if (node.status !== 'active') {
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'LOCATION_DISABLED',
          message: `${label}「${nameOf(node, id)}」已停用，不能选用`,
          details: { field: spec.field, id },
        })
      }

      const parentIds = parentValueOf(spec)
      if (parentIds.length === 0) continue

      const nodeParent = toLocationIds(node.parent)[0]
      if (nodeParent === undefined || !parentIds.some((p) => key(p) === key(nodeParent))) {
        const parentNode = nodes.get(key(parentIds[0]))
        // 用父节点自身的 type 取标签：spec.type 可能是数组，索引不进 LABELS
        const parentTypeLabel = parentNode ? labelOf(parentNode.type) : '上级'
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'LOCATION_PARENT_MISMATCH',
          message: `${label}「${nameOf(node, id)}」不属于所选${parentTypeLabel}「${nameOf(parentNode, parentIds[0])}」`,
          details: { field: spec.field, id, parentField: spec.parentField, parentIds },
        })
      }
    }

    return data
  }
}
