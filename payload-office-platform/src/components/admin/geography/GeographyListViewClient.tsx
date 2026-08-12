'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Message,
  Pagination,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

import type {
  GeographyColumn,
  GeographyFilter,
  GeographyModuleConfig,
} from './geography-modules'

/** 服务端已归一的行数据（计数已合并进 counts）。 */
export type GeographyRow = {
  id: number
  name: string
  immutableCode: string
  status: 'active' | 'disabled'
  frontendVisible: boolean
  sortOrder: number
  centerLatitude: number | null
  centerLongitude: number | null
  version: number
  parentName: string | null
  cityName: string | null
  /** 边界列用：该商圈是否有非空 boundary（缺边界=无扩展或 boundary 空） */
  hasBoundary: boolean
  /** 封面列用：该商圈是否配置了 coverImage */
  hasCover: boolean
  counts: Record<string, number>
}

/** 传给客户端的模块配置必须是可序列化数据（不含 counter 函数）。 */
type ClientModule = {
  type: GeographyModuleConfig['type']
  route: GeographyModuleConfig['route']
  title: string
  columns: GeographyColumn[]
  filters: GeographyFilter[]
  chips: { key: string; label: string }[]
  emptyHint: string
  create?: { parentFilter: 'city' | 'district' }
}

type Props = {
  module: ClientModule
  rows: GeographyRow[]
  total: number
  page: number
  totalPages: number
  city?: string
  parent?: string
  status?: string
  q?: string
  chips?: string[]
  cityOptions: { id: number; name: string }[]
  districtOptions: { id: number; name: string }[]
}

const STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
]

/** 计算列渲染：纯数字；flag 列渲染 ✓/⚠。 */
function renderCell(col: GeographyColumn, row: GeographyRow) {
  if (col.kind === 'count') {
    return <span>{row.counts[col.source] ?? 0}</span>
  }
  if (col.kind === 'flag') {
    const v = (row as unknown as Record<string, boolean>)[col.source]
    return v ? <Tag color="green">✓</Tag> : <Tag color="orange">⚠</Tag>
  }
  if (col.source === 'status') {
    return row.status === 'active' ? <Tag color="green">启用</Tag> : <Tag color="gray">停用</Tag>
  }
  if (col.source === 'frontendVisible') {
    return row.frontendVisible ? <Tag color="blue">是</Tag> : <Tag color="gray">否</Tag>
  }
  const v = (row as unknown as Record<string, unknown>)[col.source]
  return <span>{v === null || v === undefined ? '—' : String(v)}</span>
}

export default function GeographyListViewClient({
  module,
  rows,
  total,
  page,
  totalPages,
  city,
  parent,
  status,
  q,
  chips = [],
  cityOptions,
  districtOptions,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [keyword, setKeyword] = useState(q ?? '')
  const [detail, setDetail] = useState<GeographyRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /** 更新单个筛选参数并回到第一页（筛选变化不应停留在旧页码）。 */
  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value === undefined || value === '') next.delete(key)
      else next.set(key, value)
      next.delete('page')
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [searchParams, pathname, router],
  )

  /** 纯分页跳转，保留全部筛选。 */
  const setPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set('page', String(p))
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [searchParams, pathname, router],
  )

  const handleCityChange = (value: string | undefined) => {
    // 城市变化后，原来的行政区（parent）筛选大概率失效，一并重置。
    // 必须在同一次 URL 更新内完成：若拆成两次 setFilter，第二次会复用旧的
    // searchParams 闭包（此刻尚未包含刚写入的 city），其 router.push(pathname)
    // 会把 URL 重置回无参状态，导致 city 筛选丢失（Task 17 E2E flow3 暴露）。
    const next = new URLSearchParams(searchParams.toString())
    if (value === undefined || value === '') next.delete('city')
    else next.set('city', value)
    next.delete('parent')
    next.delete('page')
    const qs = next.toString()
    if (qs) router.push(`${pathname}?${qs}`)
    else router.push(pathname)
  }

  const handleSearch = () => {
    setFilter('q', keyword.trim() || undefined)
  }

  /** 切换快捷 chip：多选以逗号写回 URL `chip=a,b`，全关时删参。切 chip 会回到第一页。 */
  const toggleChip = useCallback(
    (key: string) => {
      const next = new Set(chips)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setFilter('chip', next.size ? [...next].join(',') : undefined)
    },
    [chips, setFilter],
  )

  const columns = useMemo<ColumnProps<GeographyRow>[]>(() => {
    const cols: ColumnProps<GeographyRow>[] = module.columns.map((c) => ({
      title: c.label,
      dataIndex: c.key,
      width: c.width,
      render: (_: unknown, row: GeographyRow) => renderCell(c, row),
    }))
    cols.push({
      title: '操作',
      dataIndex: '_op',
      width: 72,
      render: (_: unknown, row: GeographyRow) => (
        <Button size="mini" onClick={() => setDetail(row)}>
          编辑
        </Button>
      ),
    })
    return cols
  }, [module.columns])

  const openDrawer = (row: GeographyRow) => {
    setSaveError(null)
    setDetail(row)
  }

  const save = async () => {
    if (!detail) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/locations/${detail.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: detail.name,
          status: detail.status,
          frontendVisible: detail.frontendVisible,
          sortOrder: detail.sortOrder,
          centerLatitude: detail.centerLatitude,
          centerLongitude: detail.centerLongitude,
          version: detail.version,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        doc?: GeographyRow
        errors?: Array<{ message?: string }>
      }
      if (!res.ok || !data.doc) {
        // Payload REST 集合更新错误形状：{ errors: [{ message }] }（含 VersionConflictError 文案）
        setSaveError(data.errors?.[0]?.message || `保存失败（HTTP ${res.status}）`)
        return
      }
      Message.success('已保存')
      setDetail(null)
      // 列表原地刷新，URL（含筛选）不变 → 筛选不丢
      router.refresh()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '网络异常，保存失败')
    } finally {
      setSaving(false)
    }
  }

  const hasCityFilter = module.filters.includes('city')
  const hasDistrictFilter = module.filters.includes('district')
  const hasStatusFilter = module.filters.includes('status')
  const hasKeywordFilter = module.filters.includes('keyword')

  /** 跳本模块「新建」视图，携带当前筛选作为预填上下文（parentFilter 决定带 city 还是 parent）。 */
  const goCreate = () => {
    const sp = new URLSearchParams()
    if (module.create?.parentFilter === 'city' && city) sp.set('city', city)
    if (module.create?.parentFilter === 'district' && parent) sp.set('parent', parent)
    const qs = sp.toString()
    window.location.href = `/admin${module.route}/new${qs ? `?${qs}` : ''}`
  }

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Typography.Title heading={5} style={{ margin: 0 }}>
          {module.title}
        </Typography.Title>
        {module.create ? (
          <Button type="primary" onClick={goCreate}>
            新建
          </Button>
        ) : null}
      </div>

      {/* 筛选栏：所有筛选写入 URL search params（可分享、后退可用） */}
      <Space wrap style={{ marginBottom: 16 }}>
        {hasCityFilter && (
          <Select
            placeholder="全部城市"
            allowClear
            showSearch
            style={{ width: 180 }}
            value={city}
            onChange={(v) => handleCityChange(v as string | undefined)}
            options={cityOptions.map((c) => ({ label: c.name, value: String(c.id) }))}
            filterOption={false}
          />
        )}
        {hasDistrictFilter && (
          <Select
            placeholder="全部行政区"
            allowClear
            showSearch
            style={{ width: 180 }}
            value={parent}
            onChange={(v) => setFilter('parent', v as string | undefined)}
            options={districtOptions.map((d) => ({ label: d.name, value: String(d.id) }))}
            filterOption={false}
          />
        )}
        {hasStatusFilter && (
          <Select
            placeholder="全部状态"
            allowClear
            style={{ width: 140 }}
            value={status}
            onChange={(v) => setFilter('status', v as string | undefined)}
            options={STATUS_OPTIONS}
          />
        )}
        {hasKeywordFilter && (
          <Space>
            <Input
              style={{ width: 200 }}
              placeholder="搜索名称 / 区域代码"
              value={keyword}
              onChange={setKeyword}
              onPressEnter={handleSearch}
            />
            <Button type="primary" onClick={handleSearch}>
              搜索
            </Button>
          </Space>
        )}
        {module.chips.length > 0 && (
          <Space wrap>
            {module.chips.map((c) => (
              <Button
                key={c.key}
                size="small"
                type={chips.includes(c.key) ? 'primary' : 'outline'}
                onClick={() => toggleChip(c.key)}
              >
                {c.label}
              </Button>
            ))}
          </Space>
        )}
      </Space>

      <Table<GeographyRow>
        rowKey="id"
        columns={columns}
        data={rows}
        pagination={false}
        scroll={{ x: 900 }}
        onRow={(row) => ({ onClick: () => openDrawer(row), style: { cursor: 'pointer' } })}
        noDataElement={module.emptyHint}
      />
      {totalPages > 1 && (
        <Pagination
          current={page}
          total={total}
          pageSize={20}
          showTotal
          onChange={(p) => setPage(p)}
          style={{ marginTop: 16, justifyContent: 'flex-end' }}
        />
      )}

      {/* 轻量编辑抽屉：名称 / 状态 / 前台可见 / 排序 / 坐标，带 version 乐观锁 */}
      <Drawer
        width={440}
        title={detail ? `编辑 ${detail.name}` : '编辑'}
        visible={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail ? (
            <Space>
              <Button
                onClick={() => {
                  window.location.href = `/admin/collections/locations/${detail.id}`
                }}
              >
                完整编辑
              </Button>
              <Button type="primary" loading={saving} onClick={save}>
                保存
              </Button>
            </Space>
          ) : null
        }
      >
        {detail && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label="名称">
              <Input
                value={detail.name}
                onChange={(v) => setDetail({ ...detail, name: v })}
              />
            </Form.Item>
            <Form.Item label="状态">
              <Select
                value={detail.status}
                onChange={(v) => setDetail({ ...detail, status: v as 'active' | 'disabled' })}
                options={STATUS_OPTIONS}
              />
            </Form.Item>
            <Form.Item label="前台可见">
              <Switch
                checked={detail.frontendVisible}
                onChange={(v) => setDetail({ ...detail, frontendVisible: v })}
              />
            </Form.Item>
            <Form.Item label="排序">
              <InputNumber
                value={detail.sortOrder}
                min={0}
                onChange={(v) => setDetail({ ...detail, sortOrder: typeof v === 'number' ? v : 0 })}
              />
            </Form.Item>
            <Form.Item label="中心纬度">
              <InputNumber
                value={detail.centerLatitude ?? undefined}
                min={-90}
                max={90}
                style={{ width: '100%' }}
                onChange={(v) =>
                  setDetail({ ...detail, centerLatitude: typeof v === 'number' ? v : null })
                }
              />
            </Form.Item>
            <Form.Item label="中心经度">
              <InputNumber
                value={detail.centerLongitude ?? undefined}
                min={-180}
                max={180}
                style={{ width: '100%' }}
                onChange={(v) =>
                  setDetail({ ...detail, centerLongitude: typeof v === 'number' ? v : null })
                }
              />
            </Form.Item>
            {saveError ? (
              <Typography.Text type="error" style={{ display: 'block', marginTop: 8 }}>
                {saveError}
              </Typography.Text>
            ) : null}
          </Form>
        )}
      </Drawer>
    </div>
  )
}