/**
 * 地理四模块共享列表配置（Task 6）
 *
 * 城市 / 行政区 / 商圈 / 地铁线路 四个自定义 admin 视图共用同一套列表组件，
 * 差异全部收敛到本文件的模块配置：列定义、筛选项、聚合计数服务、空态文案。
 *
 * 列分两类：
 *  - field：直接取自 location 文档字段（含服务端已 populate 的 parentName / cityName）
 *  - count：来自 Task 5 聚合计数服务（location-counts.ts）的计数键
 *
 * 「计算列」= count 类列，来自聚合 SQL，**不可排序**（A2 决策）。当前所有列都不带
 * 排序控件（Task 6 只保证计算列明确无排序；字段列排序留到后续 Task 按需加）。
 */

import type { Payload } from 'payload'

import type { LocationType } from '@/domain/geography/location-hierarchy'
import {
  countForBusinessAreas,
  countForCities,
  countForDistricts,
  countForMetroLines,
} from '@/domain/geography/location-counts'

export type GeographyColumn = {
  key: string
  label: string
  /** field: 取自 row 字段；count: 取自 row.counts 聚合键；flag: 取自 row 布尔字段，渲染 ✓/⚠ */
  kind: 'field' | 'count' | 'flag'
  /** kind=field 时是 row 上的字段名；kind=count 时是 counts 对象的键；kind=flag 时是 row 布尔字段名 */
  source: string
  width?: number
}

export type GeographyFilter = 'city' | 'district' | 'status' | 'keyword'

/** 模块「新建」配置：跳轻量自定义新建视图（GeographyCreateView），预填类型 + 父级。 */
export type GeographyCreateConfig = {
  /** 新建时固定的 location.type（创建后不可改） */
  type: LocationType
  /** 用哪个筛选参数作为 parent 预填：city→城市筛选值，district→行政区筛选值 */
  parentFilter: 'city' | 'district'
  /** parent 下拉候选的节点类型 */
  parentTargetType: LocationType
  /** 新建按钮文案 */
  label: string
}

/** Task 5 聚合计数服务签名（四模块统一：传本页 location id 数组 → Map<id, counts>） */
export type ModuleCounter = (
  payload: Payload,
  ids: readonly (number | string)[],
) => Promise<ReadonlyMap<number, Record<string, number>>>

export type GeographyModuleConfig = {
  type: LocationType
  /** 与 payload.config.ts admin.components.views 注册的 path 一致，用于按 pathname 解析模块 */
  route: string
  title: string
  /**
   * 访问该模块所需的菜单权限码（任一命中即放行），与 navigation-config.ts 的同名叶子一致。
   * 自定义 admin 路由不经 Payload 的 collection access，导航隐藏也只是隐藏入口——
   * 直接敲 URL 仍可达，故必须在视图服务端用它做真正的准入判定（require-geography-access.ts）。
   */
  menuCodes: readonly string[]
  columns: GeographyColumn[]
  filters: GeographyFilter[]
  /** 快捷筛选 chip（如商圈的「仅看缺边界」/「仅看缺封面」），以 URL `chip=a,b` 表达、可多选 */
  chips?: { key: string; label: string }[]
  emptyHint: string
  counter: ModuleCounter
  /** 有值则列表页头部出现「新建」按钮，跳 /admin<route>/new 轻量新建视图 */
  create?: GeographyCreateConfig
  /**
   * 该模块的编辑抽屉是否提供「封面图」（OPT-062）。
   *
   * 抽屉被四个模块共用，而 `Locations.coverImage` 的 admin.condition 只认
   * business_area / district。给城市或地铁渲染封面框，结果是**存了没反应**
   * ——不报错、页面上看不出来，正是本仓库反复吃亏的静默失效。
   *
   * 放在模块配置里而不是组件里 `if (type === ...)`：`columns` / `filters` /
   * `chips` 都是按模块配的，这条跟着同一套模式走，「哪些模块有封面」才只有一处。
   */
  supportsCover?: boolean
}

const CITY_COLUMNS: GeographyColumn[] = [
  { key: 'name', label: '城市名', kind: 'field', source: 'name' },
  { key: 'immutableCode', label: '区域代码', kind: 'field', source: 'immutableCode' },
  { key: 'districts', label: '行政区数', kind: 'count', source: 'districts' },
  { key: 'businessAreas', label: '商圈数', kind: 'count', source: 'businessAreas' },
  { key: 'missingBoundary', label: '缺边界商圈', kind: 'count', source: 'businessAreasMissingBoundary' },
  { key: 'metroLines', label: '地铁线路数', kind: 'count', source: 'metroLines' },
  { key: 'metroStations', label: '站点数', kind: 'count', source: 'metroStations' },
  { key: 'buildings', label: '楼盘数', kind: 'count', source: 'buildings' },
  { key: 'status', label: '状态', kind: 'field', source: 'status' },
  { key: 'frontendVisible', label: '前台可见', kind: 'field', source: 'frontendVisible' },
]

const DISTRICT_COLUMNS: GeographyColumn[] = [
  { key: 'name', label: '名称', kind: 'field', source: 'name' },
  { key: 'immutableCode', label: '区域代码', kind: 'field', source: 'immutableCode' },
  { key: 'cityName', label: '所属城市', kind: 'field', source: 'cityName' },
  { key: 'businessAreas', label: '商圈数', kind: 'count', source: 'businessAreas' },
  { key: 'buildings', label: '楼盘数', kind: 'count', source: 'buildings' },
  { key: 'status', label: '状态', kind: 'field', source: 'status' },
  { key: 'frontendVisible', label: '前台可见', kind: 'field', source: 'frontendVisible' },
  { key: 'sortOrder', label: '排序', kind: 'field', source: 'sortOrder' },
]

const BUSINESS_AREA_COLUMNS: GeographyColumn[] = [
  { key: 'name', label: '名称', kind: 'field', source: 'name' },
  { key: 'immutableCode', label: '区域代码', kind: 'field', source: 'immutableCode' },
  { key: 'parentName', label: '所属行政区', kind: 'field', source: 'parentName' },
  { key: 'cityName', label: '所属城市', kind: 'field', source: 'cityName' },
  { key: 'buildings', label: '楼盘数', kind: 'count', source: 'buildings' },
  { key: 'stations', label: '关联站点数', kind: 'count', source: 'stations' },
  { key: 'metroLines', label: '关联线路数', kind: 'count', source: 'metroLines' },
  { key: 'hasBoundary', label: '边界', kind: 'flag', source: 'hasBoundary' },
  { key: 'hasCover', label: '封面', kind: 'flag', source: 'hasCover' },
  { key: 'status', label: '状态', kind: 'field', source: 'status' },
  { key: 'frontendVisible', label: '前台可见', kind: 'field', source: 'frontendVisible' },
]

const METRO_LINE_COLUMNS: GeographyColumn[] = [
  { key: 'name', label: '线路名', kind: 'field', source: 'name' },
  { key: 'immutableCode', label: '区域代码', kind: 'field', source: 'immutableCode' },
  { key: 'cityName', label: '所属城市', kind: 'field', source: 'cityName' },
  { key: 'stations', label: '站点数', kind: 'count', source: 'stations' },
  { key: 'status', label: '状态', kind: 'field', source: 'status' },
  { key: 'sortOrder', label: '排序', kind: 'field', source: 'sortOrder' },
]

export const GEOGRAPHY_MODULES: Record<LocationType, GeographyModuleConfig | undefined> = {
  city: {
    type: 'city',
    route: '/geography/cities',
    title: '城市管理',
    menuCodes: ['locations'],
    columns: CITY_COLUMNS,
    filters: ['status', 'keyword'],
    emptyHint: '暂无城市',
    counter: countForCities,
  },
  district: {
    type: 'district',
    route: '/geography/districts',
    title: '行政区管理',
    menuCodes: ['locations'],
    columns: DISTRICT_COLUMNS,
    filters: ['city', 'status', 'keyword'],
    emptyHint: '暂无行政区',
    counter: countForDistricts,
    supportsCover: true,
    create: {
      type: 'district',
      parentFilter: 'city',
      parentTargetType: 'city',
      label: '新建行政区',
    },
  },
  business_area: {
    type: 'business_area',
    route: '/geography/business-areas',
    title: '商圈管理',
    menuCodes: ['business-areas'],
    columns: BUSINESS_AREA_COLUMNS,
    filters: ['city', 'district', 'status', 'keyword'],
    chips: [
      { key: 'missingBoundary', label: '仅看缺边界' },
      { key: 'missingCover', label: '仅看缺封面' },
    ],
    emptyHint: '暂无商圈',
    counter: countForBusinessAreas,
    supportsCover: true,
  },
  metro_line: {
    type: 'metro_line',
    route: '/geography/metro-lines',
    title: '地铁管理',
    menuCodes: ['locations'],
    columns: METRO_LINE_COLUMNS,
    filters: ['city', 'status', 'keyword'],
    emptyHint: '暂无地铁线路',
    counter: countForMetroLines,
  },
  metro_station: undefined,
}

/** 按 admin 路径名解析当前模块（/admin/geography/cities → city 模块） */
export function getGeographyModuleByPath(pathname: string): GeographyModuleConfig | null {
  for (const m of Object.values(GEOGRAPHY_MODULES)) {
    if (m && pathname.endsWith(m.route)) return m
  }
  return null
}

/** 按「新建」路径解析模块（/admin/geography/districts/new → district 模块），仅解析有 create 配置的模块 */
export function getGeographyModuleByCreatePath(pathname: string): GeographyModuleConfig | null {
  for (const m of Object.values(GEOGRAPHY_MODULES)) {
    if (m?.create && pathname.endsWith(`${m.route}/new`)) return m
  }
  return null
}