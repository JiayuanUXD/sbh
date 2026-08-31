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

/**
 * 房源列表 - 客户端（OPT-056 后台列表 Arco 化）
 *
 * - 列表：服务端分页（默认 25 条）+ 标题搜索 + 状态筛选，URL searchParams 驱动
 * - 状态列：审核/发布/待复核 用 Arco Tag 分色呈现
 * - 快捷编辑：首页推荐 Switch 行内切换，REST PATCH 携带版本号走乐观锁，
 *   冲突（409/版本不符）与无权限均以服务端结论为准，前端只做提示与刷新
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
  version: number | null
  updatedAt: string
}

interface Option {
  value: string
  label: string
}

interface Props {
  rows: ListingRow[]
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

const PUBLICATION_STATUS_COLORS: Record<string, string> = {
  draft: 'gray',
  published: 'green',
  unpublished: 'orange',
  leased: 'arcoblue',
  sold: 'purple',
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
            <Tag size="small" color={PUBLICATION_STATUS_COLORS[v ?? ''] ?? 'gray'}>
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
        width: 132,
        render: (_: unknown, row: ListingRow) => (
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
          </Space>
        ),
      },
    ],
    [labelMaps, toggleFeatured, togglingId],
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
            placeholder="搜索房源标题"
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
        noDataElement="暂无房源"
      />
    </div>
  )
}
