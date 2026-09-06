'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Cascader, Spin, Typography } from '@arco-design/web-react'
import { useField, useForm, useFormFields } from '@payloadcms/ui'

import { buildChildrenIndex, type FlatLocationNode } from '@/domain/geography/location-tree'

const { Text } = Typography

/**
 * 地理级联选择字段（OPT-074）
 *
 * 替代后台 8 处平铺的行政区 / 商圈下拉：候选原先只按 type + status 过滤、
 * 完全不按父级收窄，选商圈要在全国 294 个里翻（上海一城就占 212 个）。
 *
 * ## 三条来自生产摸底的硬约束（2026-09-06 实测，勿凭直觉改）
 *
 * 1. **必须允许停在中间层**：74 个启用行政区里有 14 个没有任何启用商圈，
 *    强制选到叶子会让这些区的楼盘录不进去。
 * 2. **停用节点要显示、不要过滤**：值可能指向已停用节点（数据源刻意不过滤
 *    status），过滤掉的话旧记录打开就是空白，运营会以为数据丢了。
 *    这里置灰 + 打「已停用」标记，能看见但不能重选。
 * 3. **不按 frontendVisible 过滤**：生产商圈 279/294 都是 false，
 *    它是前台展示开关，不是后台可用性开关。
 *
 * 「不能选停用节点」的硬约束由 location-field-guard 在 beforeChange 兜底，
 * 本组件只负责别让运营手滑。
 */

type AdministrativeType = 'city' | 'district' | 'business_area'

export type LocationCascadeClientProps = {
  /** 允许被选中的层级；省略时三层都可选 */
  selectableTypes?: AdministrativeType[]
  /** 多选 */
  many?: boolean
  /** 候选限定在该字段（单值城市关系）所选城市之内 */
  scopeCityField?: string
  /** 候选限定在该字段（多值城市关系）所选城市之内 */
  scopeCitiesField?: string
  placeholder?: string
  /**
   * 多字段控制器模式：一次级联选择写回多个真实字段（楼盘的 city / district /
   * businessDistrict 是三个独立的 relationship 列）。
   *
   * 给定时组件不再读写自身 path，改为通过 useForm().dispatchFields 直接操作
   * 这些字段；被接管的字段在 collection 里设 admin.hidden。
   * 落库形态因此完全不变 —— C 端查询、public-catalog 的 facade / adapter /
   * mappers、既有迁移统统不用动。
   */
  writeBackFields?: Array<{ type: AdministrativeType; field: string }>
  /** Payload 注入 */
  path?: string
}

type CascaderOption = {
  label: React.ReactNode
  value: string
  children?: CascaderOption[]
  disabled?: boolean
}

const ALL_TYPES: AdministrativeType[] = ['city', 'district', 'business_area']

// —————————————————————————————————————————————
// 数据源：整棵行政树一次拉全，模块级缓存，同页多实例只请求一次
// —————————————————————————————————————————————

let treeCache: Promise<FlatLocationNode[]> | null = null

function loadTree(): Promise<FlatLocationNode[]> {
  if (!treeCache) {
    treeCache = fetch('/api/locations/tree', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { ok?: boolean; nodes?: FlatLocationNode[] }) =>
        body?.ok && Array.isArray(body.nodes) ? body.nodes : [],
      )
      .catch(() => {
        // 失败不缓存，下次挂载可重试
        treeCache = null
        return []
      })
  }
  return treeCache
}

// —————————————————————————————————————————————
// 值 ↔ 路径
// —————————————————————————————————————————————

const idKey = (v: unknown): string | null => {
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  if (typeof v === 'object' && v !== null && 'id' in v) {
    const id = (v as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null
  }
  return null
}

const toKeys = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map(idKey).filter((v): v is string => v !== null)
}

/** 从节点沿 parentId 上溯成 Cascader 需要的路径；断链时返回已知的部分 */
function pathOf(byId: Map<string, FlatLocationNode>, leaf: string): string[] {
  const path: string[] = []
  let cursor: string | null = leaf
  // 行政链最深 3 层，8 为防御上限（覆盖成环等病态数据，保证有限步终止）
  for (let depth = 0; depth < 8 && cursor !== null; depth++) {
    const node = byId.get(cursor)
    if (!node) break
    path.unshift(cursor)
    cursor = node.parentId === null ? null : String(node.parentId)
  }
  return path
}

export default function LocationCascadeField(props: LocationCascadeClientProps) {
  const {
    selectableTypes = ALL_TYPES,
    many = false,
    scopeCityField,
    scopeCitiesField,
    placeholder = '选择城市 / 行政区 / 商圈',
    writeBackFields,
    path,
  } = props

  const fieldPath = path ?? ''
  const { value, setValue } = useField<unknown>({ path: fieldPath })
  const { dispatchFields, setModified } = useForm()

  /**
   * 多字段模式下当前值不在自身 path 上，而是散在 writeBackFields 里。
   * 订阅时压成一个字符串而不是数组 —— useFormFields 每次返回新数组引用会
   * 触发无谓的重渲染。
   */
  const writeBackKey = useFormFields(([fields]) =>
    (writeBackFields ?? [])
      .map((w) => {
        const v = fields?.[w.field]?.value
        return v === null || v === undefined ? '' : String(v)
      })
      .join('|'),
  )

  const [nodes, setNodes] = useState<FlatLocationNode[] | null>(null)
  useEffect(() => {
    let alive = true
    loadTree().then((n) => {
      if (alive) setNodes(n)
    })
    return () => {
      alive = false
    }
  }, [])

  // 同文档里的城市字段，用于把候选裁到该城之内
  const scopeField = scopeCityField ?? scopeCitiesField
  const scopeValue = useFormFields(([fields]) =>
    scopeField ? (fields?.[scopeField]?.value as unknown) : undefined,
  )
  const scopeCityKeys = useMemo(
    () => (scopeField ? new Set(toKeys(scopeValue)) : null),
    [scopeField, scopeValue],
  )

  const byId = useMemo(
    () => new Map((nodes ?? []).map((n) => [String(n.id), n])),
    [nodes],
  )

  const options = useMemo<CascaderOption[]>(() => {
    if (!nodes) return []
    // 复用地理域的分组排序（sortOrder 升序 → 名称 zh 次级稳定），避免两处排序规则漂移
    const index = buildChildrenIndex(nodes)

    const build = (parentId: number | string | null): CascaderOption[] =>
      (index.get(parentId) ?? []).map((n) => {
        const children = build(n.id)
        /**
         * disabled 只表达「该节点已停用」这一个含义。
         *
         * 别拿它表达「该层级不可选」——2026-09-06 浏览器实测：Arco Cascader 的
         * disabled 会向下继承，把城市/行政区标成 disabled 会让它们底下的商圈
         * 全部连带禁用，于是「只能选商圈」的配置反而一个商圈都选不了。
         * 层级策略改由 changeOnSelect 表达（见下）。
         *
         * status 维度上的这种继承恰好是对的：停用行政区底下的商圈本来也不该选。
         */
        const disabled = n.status === 'disabled'
        return {
          value: String(n.id),
          label:
            n.status === 'disabled' ? (
              <span>
                {n.name} <Text type="secondary">（已停用）</Text>
              </span>
            ) : (
              n.name
            ),
          children: children.length > 0 ? children : undefined,
          disabled,
        }
      })

    const roots = build(null)
    if (!scopeCityKeys || scopeCityKeys.size === 0) return roots
    return roots.filter((o) => scopeCityKeys.has(o.value))
  }, [nodes, selectableTypes, scopeCityKeys])

  /**
   * 层级策略全靠这一个开关（不能用 disabled，理由见 options 里的注释）：
   *
   *   - 允许选 city / district 这类非叶子 → changeOnSelect，点哪层就选哪层。
   *     那 14 个没有启用商圈的行政区必须靠它才选得中。
   *   - 只允许选 business_area（叶子）→ 关掉它，Arco 默认就只让选到叶子。
   *
   * 代价：changeOnSelect 打开时用户也能停在比预期更浅的层（例如只选到城市）。
   * 这由字段自身的 required 与 location-field-guard 兜底，不在组件里拦。
   */
  const changeOnSelect = selectableTypes.some((t) => t !== 'business_area')

  const cascaderValue = useMemo(() => {
    if (!nodes) return undefined
    // 多字段模式取被接管字段里最深的那一级作为叶子；单字段模式读自身 path
    const keys = writeBackFields
      ? (() => {
          const parts = writeBackKey.split('|')
          for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return [parts[i]]
          return []
        })()
      : toKeys(value)
    if (keys.length === 0) return undefined
    const paths = keys.map((k) => pathOf(byId, k)).filter((p) => p.length > 0)
    return many && !writeBackFields ? paths : paths[0]
  }, [value, byId, nodes, many, writeBackFields, writeBackKey])

  /** id 归一化：Payload 的 relationship 在 PG 下是整数主键 */
  const numericId = useCallback(
    (k: string): number => {
      const n = byId.get(k)
      return typeof n?.id === 'number' ? n.id : Number(k)
    },
    [byId],
  )

  const handleChange = useCallback(
    (next: unknown) => {
      // —— 多字段控制器：把路径上每一级分发到各自的字段 ——
      if (writeBackFields) {
        const path = (Array.isArray(next) ? next : []) as string[]
        const idByType = new Map<AdministrativeType, number>()
        for (const k of path) {
          const n = byId.get(k)
          if (n) idByType.set(n.type as AdministrativeType, numericId(k))
        }
        /**
         * 先按字段聚合再分发。同一个字段可以被多个类型映射——供给提报的
         * `district` 标签就是「区域/商圈」，行政区和商圈都往它里面存。
         * 这种情况下取路径上最细的那一级：直接按顺序 dispatch 会让排在后面的
         * business_area 用 null 把前面写进去的行政区覆盖掉。
         */
        const valueByField = new Map<string, number | null>()
        for (const w of writeBackFields) {
          const v = idByType.get(w.type) ?? null
          valueByField.set(w.field, v ?? valueByField.get(w.field) ?? null)
        }
        for (const [field, value] of valueByField) {
          // 路径变短时下级要显式写 null，否则会留下上一次选择的残值
          dispatchFields({ type: 'UPDATE', path: field, value })
        }
        /**
         * 必须显式置脏。2026-09-06 浏览器实测：dispatchFields 只改字段值，
         * 不动表单的 modified 状态 —— 于是级联框显示已经变了、form state 也变了，
         * 但右上角「保存」按钮始终是 disabled，改动根本提交不出去。
         * useField().setValue 会自己置脏，dispatchFields 不会。
         */
        setModified(true)
        return
      }

      // —— 单字段 ——
      if (next === undefined || next === null) {
        setValue(many ? [] : null)
        return
      }
      const paths = (many ? next : [next]) as string[][]
      const ids = paths
        .map((p) => (Array.isArray(p) ? p[p.length - 1] : undefined))
        .filter((v): v is string => typeof v === 'string')
        .map(numericId)
      setValue(many ? ids : (ids[0] ?? null))
    },
    [setValue, many, byId, writeBackFields, dispatchFields, setModified, numericId],
  )

  if (!nodes) {
    return (
      <div style={{ padding: '8px 0' }}>
        <Spin size={14} /> <Text type="secondary">正在加载地理数据…</Text>
      </div>
    )
  }

  return (
    <Cascader
      style={{ width: '100%' }}
      options={options}
      value={cascaderValue as never}
      onChange={handleChange as never}
      mode={many ? 'multiple' : undefined}
      changeOnSelect={changeOnSelect}
      expandTrigger="hover"
      allowClear
      showSearch
      placeholder={placeholder}
    />
  )
}
