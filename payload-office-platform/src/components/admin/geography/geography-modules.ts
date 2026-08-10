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
  /** field: 取自 row 字段；count: 取自 row.counts 聚合键 */
  kind: 'field' | 'count'
  /** kind=field 时是 row 上的字段名；kind=count 时是 counts 对象的键 */
  source: string
  width?: number
}

export type GeographyFilter = 'city' | 'district' | 'status' | 'keyword'

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
  columns: GeographyColumn[]
  filters: GeographyFilter[]
  emptyHint: string
  counter: ModuleCounter
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
    columns: CITY_COLUMNS,
    filters: ['status', 'keyword'],
    emptyHint: '暂无城市',
    counter: countForCities,
  },
  district: {
    type: 'district',
    route: '/geography/districts',
    title: '行政区管理',
    columns: DISTRICT_COLUMNS,
    filters: ['city', 'status', 'keyword'],
    emptyHint: '暂无行政区',
    counter: countForDistricts,
  },
  business_area: {
    type: 'business_area',
    route: '/geography/business-areas',
    title: '商圈管理',
    columns: BUSINESS_AREA_COLUMNS,
    filters: ['city', 'district', 'status', 'keyword'],
    emptyHint: '暂无商圈',
    counter: countForBusinessAreas,
  },
  metro_line: {
    type: 'metro_line',
    route: '/geography/metro-lines',
    title: '地铁管理',
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