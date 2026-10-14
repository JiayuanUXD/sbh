'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Divider,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

import { partitionForBatch, type BatchItem } from '@/domain/shared/batch-request'
import {
  BUILDING_OPERATIONAL_STATUS_LABELS,
  isBuildingOperationalStatus,
  type BuildingOperationalStatus,
} from '@/domain/supply/building'
import {
  BUILDING_PUBLISH_ACTION_LABELS,
  BUILDING_STATUS_LABELS,
  isBuildingStatus,
  nextBuildingStatus,
  type BuildingPublishAction,
} from '@/domain/supply/building-publication'
import BatchActionBar from './BatchActionBar'
import BatchActionModal, { type BatchActionRequest } from './BatchActionModal'
import { useBuildingOperationalAction } from './useBuildingOperationalAction'

/**
 * 楼盘库 - 客户端（OPT-056 后台列表 Arco 化）
 *
 * - 列表：服务端分页（默认 25 条）+ 名称搜索 + 状态/等级/城市筛选，URL 驱动
 * - 状态列：发布/启停 用 Arco Tag 分色；「创建新条目」为右上角主按钮
 * - 批量上架 / 下架（OPT-113，需 building:update）：勾选只在当前页内有效，翻页 / 改筛选 /
 *   动作完成后清空；不适用的行（已发布再上架等）按领域状态机预筛，确认弹层里明示跳过
 * - 行内停用 / 启用（OPT-113，需 building:freeze）：与编辑页共用同一套确认流程
 *   （停用前预检受影响房源数），带目标状态提交，列表数据过期也不会把「停用」做成「启用」
 * - 批量停用 / 启用（OPT-113，需 building:freeze）：与批量上下架共用勾选与弹层；
 *   批量停用打开即一次性预检所选楼盘的受影响房源数，已是目标状态的行明示跳过
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
  version: number | null
  updatedAt: string
}

interface Option {
  value: string
  label: string
}

interface Props {
  rows: BuildingRow[]
  /** building:update（服务端算好传下来）；决定勾选列与批量上下架按钮显隐，端点才是强制点 */
  canBatchPublish: boolean
  /** building:freeze；决定行内停用 / 启用按钮显隐 */
  canFreeze: boolean
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

/** 某行对批量动作「不适用」的原因；适用返回 null。规则只来自 nextBuildingStatus。 */
function buildingSkipReason(row: BuildingRow, action: BuildingPublishAction): string | null {
  if (nextBuildingStatus(row.status, action) !== null) return null
  const label = isBuildingStatus(row.status) ? BUILDING_STATUS_LABELS[row.status] : '未知状态'
  return `${label}，不能${BUILDING_PUBLISH_ACTION_LABELS[action]}`
}

/** 某行对批量停用 / 启用「不适用」的原因：已是目标状态，或状态值非法。 */
function operationalSkipReason(
  row: BuildingRow,
  target: BuildingOperationalStatus,
): string | null {
  if (!isBuildingOperationalStatus(row.operationalStatus)) return '启停状态未知'
  return row.operationalStatus === target
    ? `已是「${BUILDING_OPERATIONAL_STATUS_LABELS[target]}」`
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 批量停用预检：一次请求汇总所选楼盘下当前对外可见的房源数，resolve 成弹层里的一句话。
 * 失败就 reject，弹层显示「统计失败，仍可继续」——与单条停用一样，预检不挡决策。
 */
async function loadBatchDeactivationImpact(items: readonly BatchItem[]): Promise<string> {
  const res = await fetch('/api/buildings/batch-deactivation-impact', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const data: unknown = await res.json().catch(() => null)
  const report = isRecord(data) && data.ok === true && isRecord(data.report) ? data.report : null
  if (!res.ok || !report || typeof report.total !== 'number') {
    throw new Error('batch_deactivation_impact_failed')
  }
  if (report.total === 0) return '当前无对外可见房源受影响。'
  // 候选触顶时计数只是下限，如实说「至少」。
  const atLeast = report.capped === true ? '至少 ' : ''
  return `将影响 ${atLeast}${report.total} 套对外可见房源，停用后随楼盘从前台消失。`
}

const OPERATIONAL_BATCH_COPY: Record<
  BuildingOperationalStatus,
  { verb: string; tone: BatchActionRequest['tone']; body: (n: number) => string[] }
> = {
  disabled: {
    verb: '停用',
    tone: 'warning',
    body: (n) => [
      `将停用 ${n} 个楼盘。停用后楼盘及其下房源在 C 端不再展示。`,
      '房源的审核 / 发布状态保持不变，重新启用后按有效供给口径恢复展示。',
    ],
  },
  active: {
    verb: '启用',
    tone: 'primary',
    body: (n) => [
      `将启用 ${n} 个楼盘。启用后楼盘及其符合有效供给口径的房源将重新在 C 端展示。`,
      '发布状态为「草稿」或「下架」的楼盘启用后仍不在前台展示，需另行上架。',
    ],
  },
}

const BATCH_COPY: Record<
  BuildingPublishAction,
  { tone: BatchActionRequest['tone']; body: (n: number) => string[] }
> = {
  publish: {
    tone: 'primary',
    body: (n) => [
      `将上架 ${n} 个楼盘（发布状态改为「已发布」）。`,
      '已停用的楼盘上架后仍不在前台展示，需另行启用。',
    ],
  },
  unpublish: {
    tone: 'warning',
    body: (n) => [
      `将下架 ${n} 个楼盘。下架后楼盘详情及其下全部房源在前台立即不可见。`,
      '房源自身的审核 / 发布状态保持不变，重新上架楼盘后按有效供给口径恢复展示。',
    ],
  },
}

export default function BuildingsListViewClient({
  rows,
  canBatchPublish,
  canFreeze,
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
  const { open: openOperational, modal: operationalModal } = useBuildingOperationalAction(() =>
    router.refresh(),
  )

  // 勾选只在当前这页数据上有效：rows 一变（翻页、改筛选、动作后刷新换了行）就自动作废，
  // 不用 effect 去清——以「当前行 id 串」为键，键不对就当没勾。
  const rowsKey = useMemo(() => rows.map((r) => r.id).join(','), [rows])
  const [selection, setSelection] = useState<{ rowsKey: string; ids: number[] }>({
    rowsKey: '',
    ids: [],
  })
  const selectedIds = useMemo(() => {
    if (selection.rowsKey !== rowsKey) return []
    const present = new Set(rows.map((r) => r.id))
    return selection.ids.filter((id) => present.has(id))
  }, [rows, rowsKey, selection])
  const [batchRequest, setBatchRequest] = useState<BatchActionRequest | null>(null)
  // 勾选列与批量操作条：有上下架或启停任一权限就出现，各组按钮再按各自权限显隐。
  const canBatch = canBatchPublish || canFreeze

  const nameOf = useCallback(
    (id: number) => rows.find((r) => r.id === id)?.name ?? `#${id}`,
    [rows],
  )

  const openBatch = useCallback(
    (action: BuildingPublishAction) => {
      const chosen = rows.filter((r) => selectedIds.includes(r.id))
      const { items, skipped } = partitionForBatch(chosen, (row) => buildingSkipReason(row, action))
      const label = BUILDING_PUBLISH_ACTION_LABELS[action]
      setBatchRequest({
        key: `${action}:${Date.now()}`,
        endpoint: '/api/buildings/batch-publish',
        params: { action },
        title: `批量${label}楼盘`,
        verb: label,
        tone: BATCH_COPY[action].tone,
        body: BATCH_COPY[action].body(items.length),
        items,
        skipped: skipped.map((s) => ({ id: s.row.id, name: s.row.name, reason: s.reason })),
        reasonLabel: null,
      })
    },
    [rows, selectedIds],
  )

  const openOperationalBatch = useCallback(
    (target: BuildingOperationalStatus) => {
      const chosen = rows.filter((r) => selectedIds.includes(r.id))
      const { items, skipped } = partitionForBatch(chosen, (row) =>
        operationalSkipReason(row, target),
      )
      const copy = OPERATIONAL_BATCH_COPY[target]
      setBatchRequest({
        key: `${target}:${Date.now()}`,
        endpoint: '/api/buildings/batch-operational-status',
        params: { target },
        title: `批量${copy.verb}楼盘`,
        verb: copy.verb,
        tone: copy.tone,
        body: copy.body(items.length),
        items,
        skipped: skipped.map((s) => ({ id: s.row.id, name: s.row.name, reason: s.reason })),
        reasonLabel: null,
        // 在点击处理里就发出预检（不在弹层 effect 里发）：弹层挂上时请求已在路上。
        ...(target === 'disabled' && items.length > 0
          ? { preflight: loadBatchDeactivationImpact(items) }
          : {}),
      })
    },
    [rows, selectedIds],
  )

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
      // 翻页 / 改筛选 / 改每页条数都走这里：离开当前结果集时显式清空勾选。
      // 实测（OPT-113 评审）目前导航会让本组件整体重新挂载，勾选本就会丢；这里不依赖这一实现
      // 细节——将来若改成不重挂，只靠 rowsKey 隐藏会让翻回原页时旧勾选重新冒出来。
      setSelection({ rowsKey: '', ids: [] })
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
        // OPT-113：132 → 180 容纳第三个按钮「停用 / 启用」（同房源列表加「下架」时的做法）。
        width: 180,
        render: (_: unknown, row: BuildingRow) => {
          const operational = isBuildingOperationalStatus(row.operationalStatus)
            ? row.operationalStatus
            : null
          return (
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
              {canFreeze && operational ? (
                <Button
                  size="mini"
                  type="text"
                  status={operational === 'active' ? 'warning' : 'default'}
                  onClick={() =>
                    openOperational({ id: String(row.id), name: row.name, status: operational })
                  }
                >
                  {operational === 'active' ? '停用' : '启用'}
                </Button>
              ) : null}
            </Space>
          )
        },
      },
    ],
    [buildingTypeLabels, canFreeze, labelMaps, openOperational],
  )

  return (
    <div className="buildings-list" style={{ padding: 24 }}>
      {/* 保留 h1 标题，理由同房源列表（去掉的是「所有 楼盘库 / 垃圾箱」标签条）。 */}
      <div className="buildings-list__header">
        <h1 className="list-header__title">楼盘库</h1>
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
      </div>

      {canBatch ? (
        <BatchActionBar selectedCount={selectedIds.length}>
          {canBatchPublish ? (
            <>
              <Button
                disabled={selectedIds.length === 0}
                onClick={() => openBatch('publish')}
              >
                批量上架
              </Button>
              <Button
                disabled={selectedIds.length === 0}
                status="warning"
                onClick={() => openBatch('unpublish')}
              >
                批量下架
              </Button>
            </>
          ) : null}
          {canBatchPublish && canFreeze ? <Divider type="vertical" style={{ margin: '0 4px' }} /> : null}
          {canFreeze ? (
            <>
              <Button
                disabled={selectedIds.length === 0}
                onClick={() => openOperationalBatch('active')}
              >
                批量启用
              </Button>
              <Button
                disabled={selectedIds.length === 0}
                status="warning"
                onClick={() => openOperationalBatch('disabled')}
              >
                批量停用
              </Button>
            </>
          ) : null}
        </BatchActionBar>
      ) : null}

      <Table<BuildingRow>
        rowKey="id"
        columns={columns}
        data={rows}
        rowSelection={
          canBatch
            ? {
                type: 'checkbox',
                checkAll: true,
                selectedRowKeys: selectedIds,
                onChange: (keys) =>
                  setSelection({
                    rowsKey,
                    ids: keys
                      .map((k) => (typeof k === 'number' ? k : Number.parseInt(k, 10)))
                      .filter((k) => Number.isInteger(k)),
                  }),
              }
            : undefined
        }
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
        // OPT-113：固定宽列合计 832px（150+170+96+96+140+180），加勾选列约 40px，
        // 只有「楼盘名称」是弹性列。给横向滚动下限，窄视口时整表横滑而不是把名称列压成一字一行
        //（同房源列表 OPT-063 的做法）。1080 ≈ 872 + 约 200 的名称列下限；
        // 1440 视口下表格可用宽约 1116px，不触发横滑（1120 时实测多出 4px 滚动阴影）。
        scroll={{ x: 1080 }}
        noDataElement="暂无楼盘"
      />

      {/* 批量确认 / 结果弹层：整表一个实例。完成后刷新服务端组件并清空勾选。 */}
      <BatchActionModal
        request={batchRequest}
        nameOf={nameOf}
        onClose={() => setBatchRequest(null)}
        onDone={() => {
          setSelection({ rowsKey: '', ids: [] })
          router.refresh()
        }}
      />
      {operationalModal}
    </div>
  )
}
