'use client'

import { useMemo, useState } from 'react'
import { Button, Empty, Input, Modal, Space, Spin, Tag, Tree, Typography } from '@arco-design/web-react'
import { IconPlus, IconSearch } from '@arco-design/web-react/icon'

import { LOCATION_TYPE_LABELS, type LocationType } from '@/domain/geography/location-hierarchy'
import {
  buildLocationForest,
  type FlatLocationNode,
  type LocationTreeItem,
} from '@/domain/geography/location-tree'

/** 服务端摊平后的可序列化节点（单一真源在 domain 层） */
export type TreeNode = FlatLocationNode

type ReferenceSource = { collection: string; label: string; count: number }
type ReferenceReport = {
  locationId: number | string
  sources: ReferenceSource[]
  total: number
  referenced: boolean
}

const { Title, Text } = Typography

/** 类型对应徽标色，与固定层级视觉区分 */
const TYPE_COLOR: Record<LocationType, string> = {
  city: 'arcoblue',
  district: 'cyan',
  business_area: 'green',
  metro_line: 'purple',
  metro_station: 'orangered',
}

const EDIT_URL = (id: number | string) => `/admin/collections/locations/${id}`
const CREATE_URL = '/admin/collections/locations/create'

/**
 * 城市区域树形管理视图 - 客户端（tasks.md M2.2 / PRD 03_城市区域）
 *
 * 能力：
 *   - 树形浏览：按固定层级组装（城市>行政区>商圈；城市>地铁线路>地铁站）
 *   - 名称/代码搜索过滤（命中节点及其祖先链保留）
 *   - 节点动作：编辑、新增下级、查看引用数量（懒加载）
 *
 * 边界：
 *   - 新增/移动/排序/启停均跳转 Payload 标准编辑页完成，写侧保护由 protectLocation hook 统一把关
 *   - 本组件不做任何权限判定；引用统计随服务端数据权限脱敏
 */
export default function LocationTreeViewClient({ nodes }: { nodes: TreeNode[] }) {
  const [keyword, setKeyword] = useState('')
  const [refModal, setRefModal] = useState<{
    open: boolean
    loading: boolean
    node?: TreeNode
    report?: ReferenceReport
    error?: string
  }>({ open: false, loading: false })

  const byId = useMemo(() => {
    const m = new Map<number | string, TreeNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  // 树组装 + 搜索命中链过滤在 domain 纯函数层（location-tree.ts，已单测）
  const { forest, expandedIds } = useMemo(
    () => buildLocationForest(nodes, keyword),
    [nodes, keyword],
  )

  const treeData = useMemo(() => {
    const toTreeData = (items: LocationTreeItem[]): TreeDataItem[] =>
      items.map((item) => {
        const node = byId.get(item.id)!
        return {
          key: String(item.id),
          title: renderTitle(node, () => openReferences(node)),
          children: toTreeData(item.children),
        }
      })
    return toTreeData(forest)
  }, [forest, byId])

  const expandedKeys = useMemo(() => expandedIds.map(String), [expandedIds])

  async function openReferences(node: TreeNode) {
    setRefModal({ open: true, loading: true, node })
    try {
      const resp = await fetch(`/api/locations/${node.id}/references`, {
        credentials: 'include',
      })
      const data = (await resp.json()) as { ok?: boolean; error?: string; report?: ReferenceReport }
      if (!resp.ok || !data.ok || !data.report) {
        setRefModal({ open: true, loading: false, node, error: data.error ?? `HTTP ${resp.status}` })
        return
      }
      setRefModal({ open: true, loading: false, node, report: data.report })
    } catch (err) {
      setRefModal({
        open: true,
        loading: false,
        node,
        error: err instanceof Error ? err.message : '网络错误',
      })
    }
  }

  const cityCount = nodes.filter((n) => n.type === 'city').length

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <Title heading={4} style={{ margin: 0 }}>
            城市区域
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            固定层级：城市 &gt; 行政区 &gt; 商圈；城市 &gt; 地铁线路 &gt; 地铁站。共 {cityCount} 个城市、
            {nodes.length} 个节点。停用节点不进新增业务候选，历史引用仍展示。
          </Text>
        </div>
        <Space>
          <Input
            allowClear
            prefix={<IconSearch />}
            placeholder="搜索名称或代码"
            style={{ width: 220 }}
            value={keyword}
            onChange={setKeyword}
          />
          <Button type="primary" icon={<IconPlus />} href={CREATE_URL}>
            新增节点
          </Button>
        </Space>
      </div>

      {treeData.length === 0 ? (
        <Empty description={keyword ? '无匹配节点' : '暂无区域节点'} />
      ) : (
        <Tree
          key={keyword ? `kw:${keyword}` : 'all'}
          treeData={treeData}
          blockNode
          defaultExpandedKeys={expandedKeys}
        />
      )}

      <Modal
        title={refModal.node ? `引用数量 · ${refModal.node.name}` : '引用数量'}
        visible={refModal.open}
        footer={
          <Button type="primary" onClick={() => setRefModal({ open: false, loading: false })}>
            关闭
          </Button>
        }
        onCancel={() => setRefModal({ open: false, loading: false })}
      >
        {refModal.loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : refModal.error ? (
          <Text type="error">{refModal.error}</Text>
        ) : refModal.report ? (
          <ReferenceBody report={refModal.report} />
        ) : null}
      </Modal>
    </div>
  )
}

function ReferenceBody({ report }: { report: ReferenceReport }) {
  if (report.total === 0) {
    return <Text type="secondary">该节点当前未被任何对象引用，可安全停用。</Text>
  }
  return (
    <div>
      <Text style={{ display: 'block', marginBottom: 12 }}>
        合计 <Text bold>{report.total}</Text> 处引用（分对象聚合，按当前数据权限脱敏）：
      </Text>
      <Space direction="vertical" style={{ width: '100%' }}>
        {report.sources.map((s) => (
          <div
            key={s.label}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text>{s.label}</Text>
            <Tag color="arcoblue">{s.count}</Tag>
          </div>
        ))}
      </Space>
      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        被引用的节点不允许物理删除；如需下线请改用「停用」。
      </Text>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// 树节点标题渲染
// ────────────────────────────────────────────────────────────

type TreeDataItem = {
  key: string
  title: React.ReactNode
  children: TreeDataItem[]
}

function renderTitle(node: TreeNode, onViewReferences: () => void): React.ReactNode {
  const disabled = node.status === 'disabled'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span
        style={{
          fontWeight: 500,
          color: disabled ? 'var(--color-text-3)' : undefined,
          textDecoration: disabled ? 'line-through' : undefined,
        }}
      >
        {node.name}
      </span>
      <Tag size="small" color={TYPE_COLOR[node.type]}>
        {LOCATION_TYPE_LABELS[node.type]}
      </Tag>
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
      {node.frontendVisible && (
        <Tag size="small" color="gold">
          前台可见
        </Tag>
      )}
      <Space size={4} style={{ marginLeft: 8 }}>
        <Button size="mini" type="text" href={EDIT_URL(node.id)}>
          编辑
        </Button>
        <Button
          size="mini"
          type="text"
          onClick={(e) => {
            e.stopPropagation()
            onViewReferences()
          }}
        >
          查看引用
        </Button>
      </Space>
    </span>
  )
}
