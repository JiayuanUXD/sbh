'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Descriptions, Tag, Tree, Typography } from '@arco-design/web-react'

import { LOCATION_TYPE_LABELS, type LocationType } from '@/domain/geography/location-hierarchy'
import type { CityCounts } from '@/domain/geography/location-counts'
import {
  buildChildrenIndex,
  groupCityDirectChildren,
  type FlatLocationNode,
} from '@/domain/geography/location-tree'

const { Title, Text } = Typography

/** 节点类型 → 对应模块路由（站点无独立模块，回线路模块按代码定位）。 */
const TYPE_TO_ROUTE: Record<LocationType, string> = {
  city: '/geography/cities',
  district: '/geography/districts',
  business_area: '/geography/business-areas',
  metro_line: '/geography/metro-lines',
  metro_station: '/geography/metro-lines',
}

export type GeographyCityDetailClientProps = {
  cityId: number | null
  counts: CityCounts | null
  nodes: FlatLocationNode[]
}

type TreeDataItem = {
  key: string
  title: React.ReactNode
  children: TreeDataItem[]
  /** 虚拟分组节点（行政区/地铁线路）不可跳转 */
  isGroup?: boolean
}

/**
 * 地理·城市详情页 - 客户端（Task 7）
 *
 * 完备度卡片 + 只读层级树：
 *  - 树复用 location-tree 纯函数（buildChildrenIndex / groupCityDirectChildren）
 *  - 城市下一层按类型生成虚拟分组节点「行政区 (n)」「地铁线路 (n)」（纯渲染，不入库）
 *  - **默认只展开到城市下一层**（城市 + 分组节点），更深折叠
 *  - 只读：无编辑/新建入口（写侧职责在模块页与 Payload 编辑页）
 *  - 节点点击 → 跳对应模块并按区域代码定位
 */
export default function GeographyCityDetailClient({
  cityId,
  counts,
  nodes,
}: GeographyCityDetailClientProps) {
  const router = useRouter()

  const byId = useMemo(() => {
    const m = new Map<string, FlatLocationNode>()
    // Arco Tree 的 selectedKeys 是字符串 key（String(child.id)），故统一用字符串建索引。
    for (const n of nodes) m.set(String(n.id), n)
    return m
  }, [nodes])

  const city = cityId == null ? null : (byId.get(String(cityId)) ?? null)

  const childrenIndex = useMemo(() => buildChildrenIndex(nodes), [nodes])

  const treeData = useMemo<TreeDataItem[]>(() => {
    if (!city) return []
    const groups = groupCityDirectChildren(nodes, city.id)
    const subtree = (nodeId: number | string, depth: number): TreeDataItem[] => {
      // 分组虚拟节点只出现在城市下一层；再往下正常递归（不分组）
      return (childrenIndex.get(nodeId) ?? []).map((child) => ({
        key: String(child.id),
        title: renderNodeTitle(child),
        children: subtree(child.id, depth + 1),
      }))
    }
    return [
      {
        key: String(city.id),
        title: renderCityTitle(city),
        children: groups.map((g) => ({
          key: `group:${g.type}`,
          title: (
            <Text style={{ fontWeight: 600, color: 'var(--color-text-2)' }}>
              {LOCATION_TYPE_LABELS[g.type]} ({g.members.length})
            </Text>
          ),
          isGroup: true,
          children: g.members.map((m) => ({
            key: String(m.id),
            title: renderNodeTitle(m),
            children: subtree(m.id, 1),
          })),
        })),
      },
    ]
  }, [city, nodes, childrenIndex])

  // 默认只展开到城市下一层：城市 + 各类型分组节点
  const defaultExpandedKeys = useMemo(() => {
    if (!city) return []
    const groups = groupCityDirectChildren(nodes, city.id)
    return [String(city.id), ...groups.map((g) => `group:${g.type}`)]
  }, [city, nodes])

  if (!city) {
    return (
      <div style={{ padding: 24 }}>
        <Title heading={4}>城市详情</Title>
        <Text type="secondary">未找到该城市节点。</Text>
      </div>
    )
  }

  const missingBoundary = counts?.businessAreasMissingBoundary ?? 0

  return (
    <div style={{ padding: 24 }}>
      <Title heading={4} style={{ margin: 0 }}>
        {city.name}
      </Title>
      <Text type="secondary" style={{ fontSize: 13 }}>
        区域代码 {city.immutableCode} · 城市管理 · 只读视图
      </Text>

      {/* 完备度卡片 */}
      <Card title="城市完备度" style={{ marginTop: 16 }}>
        <Descriptions
          column={3}
          colon="："
          data={[
            { label: '行政区', value: counts?.districts ?? 0 },
            { label: '商圈', value: counts?.businessAreas ?? 0 },
            {
              label: '缺边界商圈',
              value: (
                <Text type={missingBoundary > 0 ? 'error' : 'secondary'}>
                  {missingBoundary}
                  {missingBoundary > 0 ? '（需补边界）' : ''}
                </Text>
              ),
            },
            { label: '地铁线路', value: counts?.metroLines ?? 0 },
            { label: '站点', value: counts?.metroStations ?? 0 },
            { label: '楼盘', value: counts?.buildings ?? 0 },
          ]}
        />
      </Card>

      {/* 只读层级树 */}
      <Card title="层级结构" style={{ marginTop: 16 }}>
        <Tree
          treeData={treeData}
          blockNode
          defaultExpandedKeys={defaultExpandedKeys}
          onSelect={(selectedKeys) => {
            const key = selectedKeys[0]
            if (typeof key !== 'string' || key.startsWith('group:')) return
            const node = byId.get(key)
            if (!node) return
            const route = TYPE_TO_ROUTE[node.type]
            router.push(`/admin${route}?q=${encodeURIComponent(node.immutableCode)}`)
          }}
        />
      </Card>
    </div>
  )
}

function renderCityTitle(city: FlatLocationNode): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 600 }}>{city.name}</span>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {city.immutableCode}
      </Text>
      <Tag size="small" color="arcoblue">
        城市
      </Tag>
    </span>
  )
}

function renderNodeTitle(node: FlatLocationNode): React.ReactNode {
  const disabled = node.status === 'disabled'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span
        style={{
          color: disabled ? 'var(--color-text-3)' : undefined,
          textDecoration: disabled ? 'line-through' : undefined,
        }}
      >
        {node.name}
      </span>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {node.immutableCode}
      </Text>
      {disabled ? (
        <Tag size="small" color="red">
          停用
        </Tag>
      ) : (
        <Tag size="small" color="green">
          启用
        </Tag>
      )}
    </span>
  )
}