'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Message,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

import {
  availablePublicationActions,
  type PublicationActionSpec,
} from '@/domain/listing/publication-actions'
import { isPublicationStatus } from '@/domain/review/publication-status'
import ListingPublicationActionModal from './ListingPublicationActionModal'
import { PUBLICATION_STATUS_TAG_COLORS } from './publication-status-colors'

/**
 * 房源列表 - 客户端（OPT-056 后台列表 Arco 化）
 *
 * - 列表：服务端分页（默认 25 条）+ 标题/房间号搜索 + 状态筛选，URL searchParams 驱动
 * - 状态列：审核/发布/待复核 用 Arco Tag 分色呈现
 * - 快捷编辑：首页推荐 Switch 行内切换，REST PATCH 携带版本号走乐观锁，
 *   冲突（409/版本不符）与无权限均以服务端结论为准，前端只做提示与刷新
 * - 操作列「下架」（OPT-086）：与编辑页动作条共用同一个纯函数与确认弹层，
 *   列表侧不复制任何状态机 / 文案规则，见下方操作列注释
 * - 「创建新条目」为右上角主按钮；不渲染 Payload 原生「所有 房源列表」抬头
 */

export interface ListingRow {
  id: number
  title: string
  slug: string | null
  buildingName: string | null
  merchantName: string | null
  listingType: string
  businessType: string | null
  publicationStatus: string | null
  reviewStatus: string | null
  supplyVisibilityHold: string | null
  isFeatured: boolean
  area: number | null
  /** OPT-063 房间号。仅后台可见，前台不展示。 */
  roomNumber: string | null
  version: number | null
  updatedAt: string
}

interface Option {
  value: string
  label: string
}

interface Props {
  rows: ListingRow[]
  /** listing:unpublish 权限（服务端算好传下来）；只决定「下架」按钮显隐，端点才是强制点 */
  canUnpublish: boolean
  page: number
  pageSize: number
  totalDocs: number
  activeQ: string | null
  activePublicationStatus: string | null
  activeReviewStatus: string | null
  activeListingType: string | null
  activeBusinessType: string | null
  activeBuilding: number | null
  activeBuildingName: string | null
  activeMissingCover: boolean
  activePendingRecheck: boolean
  publicationStatusOptions: Option[]
  reviewStatusOptions: Option[]
  listingTypeOptions: Option[]
  businessTypeOptions: Option[]
}

const REVIEW_STATUS_COLORS: Record<string, string> = {
  not_submitted: 'gray',
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
}

/**
 * 发布态 → Tag 颜色。表本身在 `publication-status-colors.ts`（与编辑页动作条共用）；
 * 这里只补一层收窄：列表行的 publicationStatus 是 `string | null`（来自 payload-types 的
 * 宽类型），未知值一律回落 'gray'，与收敛前的 `COLORS[v ?? ''] ?? 'gray'` 同结果。
 */
function publicationStatusColor(value: string | null): string {
  return isPublicationStatus(value) ? PUBLICATION_STATUS_TAG_COLORS[value] : 'gray'
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

/** 从 Payload REST 错误响应中提取可展示的中文信息。 */
async function extractErrorMessage(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'errors' in body) {
      const errors = (body as { errors?: Array<{ message?: string }> }).errors
      const msg = errors?.[0]?.message
      if (typeof msg === 'string' && msg.length > 0) return msg
    }
  } catch {
    // 响应体不是 JSON 时静默回退
  }
  return null
}

export default function ListingsListViewClient({
  rows,
  canUnpublish,
  page,
  pageSize,
  totalDocs,
  activeQ,
  activePublicationStatus,
  activeReviewStatus,
  activeListingType,
  activeBusinessType,
  activeBuilding,
  activeBuildingName,
  activeMissingCover,
  activePendingRecheck,
  publicationStatusOptions,
  reviewStatusOptions,
  listingTypeOptions,
  businessTypeOptions,
}: Props) {
  const router = useRouter()
  const [togglingId, setTogglingId] = useState<number | null>(null)
  // 下架确认弹层的目标行。整表只挂一个弹层实例（而不是每行一个）：Modal 会往
  // document.body 挂 portal，一页 100 行就是 100 个常驻空节点。
  // 连 spec 一起存，避免弹层打开后表格刷新导致行数据与文案对不上。
  const [unpublishTarget, setUnpublishTarget] = useState<{
    row: ListingRow
    spec: PublicationActionSpec
  } | null>(null)

  const labelMaps = useMemo(
    () => ({
      publication: new Map(publicationStatusOptions.map((o) => [o.value, o.label])),
      review: new Map(reviewStatusOptions.map((o) => [o.value, o.label])),
      listingType: new Map(listingTypeOptions.map((o) => [o.value, o.label])),
      businessType: new Map(businessTypeOptions.map((o) => [o.value, o.label])),
    }),
    [publicationStatusOptions, reviewStatusOptions, listingTypeOptions, businessTypeOptions],
  )

  const navigate = useCallback(
    (next: {
      building?: number | null
      businessType?: string | null
      limit?: number
      listingType?: string | null
      missingCover?: boolean
      page?: number
      pendingRecheck?: boolean
      publicationStatus?: string | null
      q?: string | null
      reviewStatus?: string | null
    }) => {
      const merged = {
        building: next.building !== undefined ? next.building : activeBuilding,
        businessType: next.businessType !== undefined ? next.businessType : activeBusinessType,
        limit: next.limit ?? pageSize,
        listingType: next.listingType !== undefined ? next.listingType : activeListingType,
        missingCover: next.missingCover !== undefined ? next.missingCover : activeMissingCover,
        page: next.page ?? 1,
        pendingRecheck:
          next.pendingRecheck !== undefined ? next.pendingRecheck : activePendingRecheck,
        publicationStatus:
          next.publicationStatus !== undefined ? next.publicationStatus : activePublicationStatus,
        q: next.q !== undefined ? next.q : activeQ,
        reviewStatus: next.reviewStatus !== undefined ? next.reviewStatus : activeReviewStatus,
      }
      const qs = new URLSearchParams()
      if (merged.page > 1) qs.set('page', String(merged.page))
      if (merged.limit !== 25) qs.set('limit', String(merged.limit))
      if (merged.q) qs.set('q', merged.q)
      if (merged.publicationStatus) qs.set('publicationStatus', merged.publicationStatus)
      if (merged.reviewStatus) qs.set('reviewStatus', merged.reviewStatus)
      if (merged.listingType) qs.set('listingType', merged.listingType)
      if (merged.businessType) qs.set('businessType', merged.businessType)
      if (merged.building !== null) qs.set('building', String(merged.building))
      if (merged.missingCover) qs.set('missingCover', '1')
      if (merged.pendingRecheck) qs.set('pendingRecheck', '1')
      const query = qs.toString()
      router.push(
        query ? `/admin/collections/listings?${query}` : '/admin/collections/listings',
      )
    },
    [
      activeBuilding,
      activeBusinessType,
      activeListingType,
      activeMissingCover,
      activePendingRecheck,
      activePublicationStatus,
      activeQ,
      activeReviewStatus,
      pageSize,
      router,
    ],
  )

  const toggleFeatured = useCallback(
    async (row: ListingRow, checked: boolean) => {
      setTogglingId(row.id)
      try {
        const res = await fetch(`/api/listings/${row.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isFeatured: checked,
            // 携带读取时的版本号走服务端乐观锁：他人已改则报冲突，避免静默覆盖
            ...(row.version !== null ? { version: row.version } : {}),
          }),
        })
        if (res.ok) {
          Message.success(checked ? '已设为首页推荐' : '已取消首页推荐')
          router.refresh()
          return
        }
        const serverMsg = await extractErrorMessage(res)
        if (res.status === 403 || res.status === 401) {
          Message.error('没有修改权限')
        } else if (serverMsg) {
          Message.error(serverMsg)
        } else {
          Message.error(`保存失败（HTTP ${res.status}），请刷新后重试`)
        }
        router.refresh()
      } catch {
        Message.error('网络异常，保存失败')
      } finally {
        setTogglingId(null)
      }
    },
    [router],
  )

  const columns = useMemo<ColumnProps<ListingRow>[]>(
    () => [
      {
        title: '房源标题',
        dataIndex: 'title',
        ellipsis: true,
        render: (_: unknown, row: ListingRow) => (
          <a
            href={`/admin/collections/listings/${row.id}`}
            style={{ textDecoration: 'none' }}
          >
            <Typography.Text style={{ fontSize: 13 }}>{row.title}</Typography.Text>
            {row.buildingName ? (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {row.buildingName}
              </Typography.Text>
            ) : null}
          </a>
        ),
      },
      {
        title: '类型',
        dataIndex: 'listingType',
        width: 110,
        render: (v: string, row: ListingRow) => (
          <Space size={4} wrap>
            <Tag size="small" bordered>
              {labelMaps.listingType.get(v) ?? v}
            </Tag>
            {row.businessType === 'sale' ? (
              <Tag size="small" color="gold">
                {labelMaps.businessType.get('sale') ?? '出售'}
              </Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: '审核状态',
        dataIndex: 'reviewStatus',
        width: 96,
        render: (v: string | null) => (
          <Tag size="small" color={REVIEW_STATUS_COLORS[v ?? ''] ?? 'gray'}>
            {labelMaps.review.get(v ?? '') ?? v ?? '—'}
          </Tag>
        ),
      },
      {
        title: '发布状态',
        dataIndex: 'publicationStatus',
        width: 130,
        render: (v: string | null, row: ListingRow) => (
          <Space size={4} wrap>
            <Tag size="small" color={publicationStatusColor(v)}>
              {labelMaps.publication.get(v ?? '') ?? v ?? '—'}
            </Tag>
            {row.supplyVisibilityHold === 'pending_recheck' ? (
              <Tag size="small" color="red">
                待复核
              </Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: '面积',
        dataIndex: 'area',
        width: 90,
        render: (v: number | null) => (v !== null ? `${v}㎡` : '—'),
      },
      {
        // OPT-063：紧挨面积——「面积 + 房间号」是区分同层多套房源时一起看的一组信息。
        title: '房间号',
        dataIndex: 'roomNumber',
        width: 96,
        render: (v: string | null) => v ?? '—',
      },
      {
        title: '首页推荐',
        dataIndex: 'isFeatured',
        width: 90,
        render: (_: unknown, row: ListingRow) => (
          <Switch
            size="small"
            checked={row.isFeatured}
            loading={togglingId === row.id}
            onChange={(checked) => void toggleFeatured(row, checked)}
          />
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
        width: 180,
        render: (_: unknown, row: ListingRow) => {
          // 「下架」用与编辑页动作条同一个纯函数取 spec，文案 / 是否必填原因 / 按钮语义
          // 因此完全同源：列表侧不写一句「已发布才能下架」之类的规则副本。
          // canPublish 固定 false——列表只给下架这一个动作；上架 / 标记成交都要先看清
          // 房源详情（有效供给条件、租售类型），不适合在列表里一键完成。
          const spec =
            canUnpublish && isPublicationStatus(row.publicationStatus)
              ? (availablePublicationActions({
                  publicationStatus: row.publicationStatus,
                  businessType: row.businessType,
                  canPublish: false,
                  canUnpublish: true,
                }).find((s) => s.action === 'unpublish') ?? null)
              : null
          return (
            <Space size={4}>
              <Button size="mini" href={`/admin/collections/listings/${row.id}`}>
                编辑
              </Button>
              {row.slug && row.publicationStatus === 'published' ? (
                <Button
                  size="mini"
                  type="text"
                  href={`/listings/${row.slug}`}
                  target="_blank"
                >
                  前台
                </Button>
              ) : null}
              {spec ? (
                <Button
                  size="mini"
                  type="text"
                  status="warning"
                  onClick={() => setUnpublishTarget({ row, spec })}
                >
                  {spec.label}
                </Button>
              ) : null}
            </Space>
          )
        },
      },
    ],
    [canUnpublish, labelMaps, toggleFeatured, togglingId],
  )

  return (
    <div className="listings-list" style={{ padding: 24 }}>
      {/*
        保留 h1 标题：用户要去掉的是原生的「所有 房源列表 / 垃圾箱」标签条，
        不是页面标题本身。标题同时是可访问性地标，也是后台角色矩阵 E2E
        判断「是否真的进到了目标页」的依据。
      */}
      <div className="listings-list__header">
        <h1 className="list-header__title">房源列表</h1>
        <Space size="small">
          <Button
            href="/admin/collections/listings/trash"
            icon={<IconDelete />}
            type="text"
          >
            回收站
          </Button>
          <Button
            href="/admin/collections/listings/create"
            icon={<IconPlus />}
            type="primary"
          >
            创建房源
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
            placeholder="搜索标题 / 房间号"
            searchButton
            style={{ width: 240 }}
            onSearch={(value) => navigate({ page: 1, q: value || null })}
            onClear={() => navigate({ page: 1, q: null })}
          />
          <Select
            allowClear
            options={reviewStatusOptions}
            placeholder="审核状态"
            style={{ width: 130 }}
            value={activeReviewStatus ?? undefined}
            onChange={(v) => navigate({ page: 1, reviewStatus: (v as string | undefined) ?? null })}
          />
          <Select
            allowClear
            options={publicationStatusOptions}
            placeholder="发布状态"
            style={{ width: 130 }}
            value={activePublicationStatus ?? undefined}
            onChange={(v) =>
              navigate({ page: 1, publicationStatus: (v as string | undefined) ?? null })
            }
          />
          <Select
            allowClear
            options={listingTypeOptions}
            placeholder="房源类型"
            style={{ width: 140 }}
            value={activeListingType ?? undefined}
            onChange={(v) => navigate({ page: 1, listingType: (v as string | undefined) ?? null })}
          />
          <Select
            allowClear
            options={businessTypeOptions}
            placeholder="租售"
            style={{ width: 100 }}
            value={activeBusinessType ?? undefined}
            onChange={(v) => navigate({ page: 1, businessType: (v as string | undefined) ?? null })}
          />
        </Space>
      </div>

      {(activeBuilding !== null || activeMissingCover || activePendingRecheck) && (
        <Space size={8} style={{ marginBottom: 12 }} wrap>
          {activeBuilding !== null ? (
            <Tag
              closable
              color="arcoblue"
              onClose={() => navigate({ building: null, page: 1 })}
            >
              楼盘：{activeBuildingName ?? `#${activeBuilding}`}
            </Tag>
          ) : null}
          {activeMissingCover ? (
            <Tag closable color="orange" onClose={() => navigate({ missingCover: false, page: 1 })}>
              仅看缺少封面
            </Tag>
          ) : null}
          {activePendingRecheck ? (
            <Tag
              closable
              color="red"
              onClose={() => navigate({ page: 1, pendingRecheck: false })}
            >
              仅看待复核供给
            </Tag>
          ) : null}
        </Space>
      )}

      <Table<ListingRow>
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
        // OPT-063：固定宽列合计 932px（110+96+130+90+96+90+140+180），只有「房源标题」
        // 是弹性列。1280 视口下侧边栏吃掉约 250px，标题列会被压到几十像素——中文一行一字，
        // 完全没法读。给一个横向滚动下限：宽度不够时整表横向滚动，而不是牺牲标题列。
        // 1232 = 932 固定列 + 约 300 的标题列下限。
        // OPT-086：操作列 132 → 180 容纳第三个按钮「下架」，两个数字随之各 +48。
        scroll={{ x: 1232 }}
        noDataElement="暂无房源"
      />

      {/*
        下架确认弹层：整表一个实例，spec 为 null 时组件直接返回 null（不渲染 portal）。
        成功后只 router.refresh()——重取服务端组件即可拿到新的发布态与 version，
        不在客户端本地改行数据（那会与筛选条件、分页脱节，且不知道钩子的副作用）。
      */}
      <ListingPublicationActionModal
        listingId={unpublishTarget ? String(unpublishTarget.row.id) : ''}
        listingTitle={unpublishTarget?.row.title ?? ''}
        spec={unpublishTarget?.spec ?? null}
        version={unpublishTarget?.row.version ?? null}
        onClose={() => setUnpublishTarget(null)}
        onDone={() => router.refresh()}
      />
    </div>
  )
}
