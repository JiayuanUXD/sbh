'use client'

import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

/**
 * 楼盘库 - 客户端（OPT-056 后台列表 Arco 化）
 *
 * - 列表：服务端分页（默认 25 条）+ 名称搜索 + 状态/等级/城市筛选，URL 驱动
 * - 状态列：发布/启停 用 Arco Tag 分色；「创建新条目」为右上角主按钮
 * - 启停操作有独立的影响预检流程，保留在编辑页，不在列表行内快捷切换
 */

export interface BuildingRow {
  id: number
  name: string
  slug: string | null
  cityName: string | null
  districtName: string | null
  grade: string | null
  buildingType: string | null
  status: string | null
  operationalStatus: string | null
  updatedAt: string
}

interface Option {
  value: string
  label: string
}

interface Props {
  rows: BuildingRow[]
  page: number
  pageSize: number
  totalDocs: number
  activeQ: string | null
  activeStatus: string | null
  activeOperationalStatus: string | null
  activeGrade: string | null
  activeCity: number | null
  statusOptions: Option[]
  operationalStatusOptions: Option[]
  gradeOptions: Option[]
  buildingTypeLabels: Record<string, string>
  cityOptions: Option[]
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'gray',
  published: 'green',
  archived: 'orange',
}

const OPERATIONAL_STATUS_COLORS: Record<string, string> = {
  active: 'green',
  disabled: 'red',
}

/** 时间戳格式化为北京时间可读串。 */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BuildingsListViewClient({
  rows,
  page,
  pageSize,
  totalDocs,
  activeQ,
  activeStatus,
  activeOperationalStatus,
  activeGrade,
  activeCity,
  statusOptions,
  operationalStatusOptions,
  gradeOptions,
  buildingTypeLabels,
  cityOptions,
}: Props) {
  const router = useRouter()

  const labelMaps = useMemo(
    () => ({
      status: new Map(statusOptions.map((o) => [o.value, o.label])),
      operational: new Map(operationalStatusOptions.map((o) => [o.value, o.label])),
      grade: new Map(gradeOptions.map((o) => [o.value, o.label])),
    }),
    [statusOptions, operationalStatusOptions, gradeOptions],
  )

  const navigate = useCallback(
    (next: {
      city?: number | null
      grade?: string | null
      limit?: number
      operationalStatus?: string | null
      page?: number
      q?: string | null
      status?: string | null
    }) => {
      const merged = {
        city: next.city !== undefined ? next.city : activeCity,
        grade: next.grade !== undefined ? next.grade : activeGrade,
        limit: next.limit ?? pageSize,
        operationalStatus:
          next.operationalStatus !== undefined
            ? next.operationalStatus
            : activeOperationalStatus,
        page: next.page ?? 1,
        q: next.q !== undefined ? next.q : activeQ,
        status: next.status !== undefined ? next.status : activeStatus,
      }
      const qs = new URLSearchParams()
      if (merged.page > 1) qs.set('page', String(merged.page))
      if (merged.limit !== 25) qs.set('limit', String(merged.limit))
      if (merged.q) qs.set('q', merged.q)
      if (merged.status) qs.set('status', merged.status)
      if (merged.operationalStatus) qs.set('operationalStatus', merged.operationalStatus)
      if (merged.grade) qs.set('grade', merged.grade)
      if (merged.city !== null) qs.set('city', String(merged.city))
      const query = qs.toString()
      router.push(
        query ? `/admin/collections/buildings?${query}` : '/admin/collections/buildings',
      )
    },
    [
      activeCity,
      activeGrade,
      activeOperationalStatus,
      activeQ,
      activeStatus,
      pageSize,
      router,
    ],
  )

  const columns = useMemo<ColumnProps<BuildingRow>[]>(
    () => [
      {
        title: '楼盘名称',
        dataIndex: 'name',
        ellipsis: true,
        render: (_: unknown, row: BuildingRow) => (
          <a
            href={`/admin/collections/buildings/${row.id}`}
            style={{ textDecoration: 'none' }}
          >
            <Typography.Text style={{ fontSize: 13 }}>{row.name}</Typography.Text>
            {row.slug ? (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {row.slug}
              </Typography.Text>
            ) : null}
          </a>
        ),
      },
      {
        title: '城市 / 行政区',
        dataIndex: 'cityName',
        width: 150,
        render: (_: unknown, row: BuildingRow) => (
          <Typography.Text style={{ fontSize: 13 }}>
            {row.cityName ?? '—'}
            {row.districtName ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {' '}
                / {row.districtName}
              </Typography.Text>
            ) : null}
          </Typography.Text>
        ),
      },
      {
        title: '等级 / 类型',
        dataIndex: 'grade',
        width: 170,
        render: (_: unknown, row: BuildingRow) => (
          <Space size={4} wrap>
            {row.grade ? (
              <Tag size="small" color="arcoblue">
                {labelMaps.grade.get(row.grade) ?? row.grade}
              </Tag>
            ) : null}
            {row.buildingType ? (
              <Tag size="small" bordered>
                {buildingTypeLabels[row.buildingType] ?? row.buildingType}
              </Tag>
            ) : null}
            {!row.grade && !row.buildingType ? '—' : null}
          </Space>
        ),
      },
      {
        title: '发布状态',
        dataIndex: 'status',
        width: 96,
        render: (v: string | null) => (
          <Tag size="small" color={STATUS_COLORS[v ?? ''] ?? 'gray'}>
            {labelMaps.status.get(v ?? '') ?? v ?? '—'}
          </Tag>
        ),
      },
      {
        title: '启停状态',
        dataIndex: 'operationalStatus',
        width: 96,
        render: (v: string | null) => (
          <Tag size="small" color={OPERATIONAL_STATUS_COLORS[v ?? ''] ?? 'gray'}>
            {labelMaps.operational.get(v ?? '') ?? v ?? '—'}
          </Tag>
        ),
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        width: 140,
        render: (v: string) => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatTime(v)}
          </Typography.Text>
        ),
      },
      {
        title: '操作',
        dataIndex: 'op',
        width: 132,
        render: (_: unknown, row: BuildingRow) => (
          <Space size={4}>
            <Button size="mini" href={`/admin/collections/buildings/${row.id}`}>
              编辑
            </Button>
            {row.slug && row.status === 'published' ? (
              <Button
                size="mini"
                type="text"
                href={`/buildings/${row.slug}`}
                target="_blank"
              >
                前台
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [buildingTypeLabels, labelMaps],
  )

  return (
    <div className="buildings-list" style={{ padding: 24 }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Space size="medium" wrap>
          <Input.Search
            allowClear
            defaultValue={activeQ ?? undefined}
            placeholder="搜索楼盘名称"
            searchButton
            style={{ width: 220 }}
            onSearch={(value) => navigate({ page: 1, q: value || null })}
            onClear={() => navigate({ page: 1, q: null })}
          />
          <Select
            allowClear
            options={cityOptions}
            placeholder="城市"
            showSearch
            style={{ width: 120 }}
            value={activeCity !== null ? String(activeCity) : undefined}
            onChange={(v) => {
              const parsed = Number.parseInt((v as string | undefined) ?? '', 10)
              navigate({ city: Number.isInteger(parsed) ? parsed : null, page: 1 })
            }}
          />
          <Select
            allowClear
            options={statusOptions}
            placeholder="发布状态"
            style={{ width: 120 }}
            value={activeStatus ?? undefined}
            onChange={(v) => navigate({ page: 1, status: (v as string | undefined) ?? null })}
          />
          <Select
            allowClear
            options={operationalStatusOptions}
            placeholder="启停状态"
            style={{ width: 120 }}
            value={activeOperationalStatus ?? undefined}
            onChange={(v) =>
              navigate({ operationalStatus: (v as string | undefined) ?? null, page: 1 })
            }
          />
          <Select
            allowClear
            options={gradeOptions}
            placeholder="楼宇等级"
            style={{ width: 130 }}
            value={activeGrade ?? undefined}
            onChange={(v) => navigate({ grade: (v as string | undefined) ?? null, page: 1 })}
          />
        </Space>
        <Space size="small">
          <Button
            href="/admin/collections/buildings/trash"
            icon={<IconDelete />}
            type="text"
          >
            回收站
          </Button>
          <Button
            href="/admin/collections/buildings/create"
            icon={<IconPlus />}
            type="primary"
          >
            创建楼盘
          </Button>
        </Space>
      </div>

      <Table<BuildingRow>
        rowKey="id"
        columns={columns}
        data={rows}
        pagination={{
          current: page,
          pageSize,
          total: totalDocs,
          showTotal: true,
          sizeCanChange: true,
          sizeOptions: [10, 25, 50, 100],
          onChange: (nextPage, nextSize) =>
            navigate({ limit: nextSize, page: nextSize !== pageSize ? 1 : nextPage }),
        }}
        noDataElement="暂无楼盘"
      />
    </div>
  )
}
