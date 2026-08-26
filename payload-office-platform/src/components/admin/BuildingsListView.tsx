import type { ListViewServerProps, Where } from 'payload'

import { shouldDeferToDefaultListView } from './list-view-context'
import { renderDefaultListView } from './payload-default-list-fallback'

import {
  BUILDING_OPERATIONAL_STATUSES,
  BUILDING_OPERATIONAL_STATUS_LABELS,
  BUILDING_TYPE_LABELS,
} from '@/domain/supply/building'
import type { Building, Location } from '@/payload-types'
import BuildingsListViewClient, { type BuildingRow } from './BuildingsListViewClient'

/**
 * 楼盘库 - 服务端入口（OPT-056 后台列表 Arco 化）
 *
 * 整页替换 buildings 默认列表视图：服务端分页 + 名称搜索 + 状态/城市筛选，
 * 客户端用 Arco Table 呈现。注册：Buildings.admin.components.views.list.Component。
 *
 * 仅接管「整页列表」；回收站与关系抽屉让位给 Payload 原生视图，
 * 判定与理由见 `list-view-context.ts`。
 */

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

const BUILDING_STATUSES = ['draft', 'published', 'archived'] as const
const BUILDING_STATUS_LABELS: Record<(typeof BUILDING_STATUSES)[number], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '下架',
}

const BUILDING_GRADES = ['grade-a', 'super-grade-a', 'creative-park', 'serviced-office'] as const
const BUILDING_GRADE_LABELS: Record<(typeof BUILDING_GRADES)[number], string> = {
  'grade-a': '甲级',
  'super-grade-a': '超甲级',
  'creative-park': '创意园区',
  'serviced-office': '服务式办公',
}

/** searchParams 值归一（string | string[] → string | null）。 */
function firstParam(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0]
  }
  return null
}

function inOptions(value: string | null, options: readonly string[]): string | null {
  return value && options.includes(value) ? value : null
}

function locationName(value: Building['city'] | Building['district']): string | null {
  return value && typeof value === 'object' ? ((value as Location).name ?? null) : null
}

export default async function BuildingsListView(props: ListViewServerProps) {
  if (shouldDeferToDefaultListView(props)) {
    return renderDefaultListView(props)
  }

  const { payload, user, searchParams } = props
  if (!user) {
    return <div style={{ padding: 24 }}>请先登录后台。</div>
  }

  const params = searchParams ?? {}
  const q = firstParam(params.q)
  const status = inOptions(firstParam(params.status), BUILDING_STATUSES)
  const operationalStatus = inOptions(
    firstParam(params.operationalStatus),
    BUILDING_OPERATIONAL_STATUSES,
  )
  const grade = inOptions(firstParam(params.grade), BUILDING_GRADES)
  const cityRaw = Number.parseInt(firstParam(params.city) ?? '', 10)
  const city = Number.isInteger(cityRaw) && cityRaw > 0 ? cityRaw : null
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1)
  const limitRaw = Number.parseInt(firstParam(params.limit) ?? '', 10)
  const limit = PAGE_SIZE_OPTIONS.includes(limitRaw) ? limitRaw : PAGE_SIZE_DEFAULT

  const conditions: Where[] = []
  if (q) conditions.push({ name: { like: q } })
  if (status) conditions.push({ status: { equals: status } })
  if (operationalStatus) conditions.push({ operationalStatus: { equals: operationalStatus } })
  if (grade) conditions.push({ grade: { equals: grade } })
  if (city !== null) conditions.push({ city: { equals: city } })

  const [result, cities] = await Promise.all([
    payload.find({
      collection: 'buildings',
      where: conditions.length > 0 ? { and: conditions } : undefined,
      depth: 1,
      limit,
      page,
      sort: '-updatedAt',
    }),
    payload.find({
      collection: 'locations',
      where: { type: { equals: 'city' } },
      depth: 0,
      limit: 100,
      sort: 'name',
    }),
  ])

  const rows: BuildingRow[] = (result.docs as Building[]).map((doc) => ({
    id: doc.id,
    name: doc.name,
    slug: doc.slug ?? null,
    cityName: locationName(doc.city),
    districtName: locationName(doc.district),
    grade: doc.grade ?? null,
    buildingType: doc.buildingType ?? null,
    status: doc.status ?? null,
    operationalStatus: doc.operationalStatus ?? null,
    updatedAt: doc.updatedAt,
  }))

  return (
    <BuildingsListViewClient
      rows={rows}
      page={result.page ?? 1}
      pageSize={limit}
      totalDocs={result.totalDocs ?? 0}
      activeQ={q}
      activeStatus={status}
      activeOperationalStatus={operationalStatus}
      activeGrade={grade}
      activeCity={city}
      statusOptions={BUILDING_STATUSES.map((value) => ({
        value,
        label: BUILDING_STATUS_LABELS[value],
      }))}
      operationalStatusOptions={BUILDING_OPERATIONAL_STATUSES.map((value) => ({
        value,
        label: BUILDING_OPERATIONAL_STATUS_LABELS[value],
      }))}
      gradeOptions={BUILDING_GRADES.map((value) => ({
        value,
        label: BUILDING_GRADE_LABELS[value],
      }))}
      buildingTypeLabels={BUILDING_TYPE_LABELS}
      cityOptions={(cities.docs as Location[]).map((c) => ({
        value: String(c.id),
        label: c.name,
      }))}
    />
  )
}
