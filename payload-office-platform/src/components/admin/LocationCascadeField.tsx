'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Cascader, Spin, Typography } from '@arco-design/web-react'
import { useField, useFormFields } from '@payloadcms/ui'

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
    path,
  } = props

  const fieldPath = path ?? ''
  const { value, setValue } = useField<unknown>({ path: fieldPath })

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
    const keys = toKeys(value)
    if (keys.length === 0) return undefined
    const paths = keys.map((k) => pathOf(byId, k)).filter((p) => p.length > 0)
    return many ? paths : paths[0]
  }, [value, byId, nodes, many])

  const handleChange = useCallback(
    (next: unknown) => {
      if (next === undefined || next === null) {
        setValue(many ? [] : null)
        return
      }
      const paths = (many ? next : [next]) as string[][]
      const leaves = paths
        .map((p) => (Array.isArray(p) ? p[p.length - 1] : undefined))
        .filter((v): v is string => typeof v === 'string')
      // 回写数字 id：Payload 的 relationship 在 PG 下是整数主键
      const ids = leaves.map((k) => {
        const n = byId.get(k)
        return typeof n?.id === 'number' ? n.id : Number(k)
      })
      setValue(many ? ids : (ids[0] ?? null))
    },
    [setValue, many, byId],
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
