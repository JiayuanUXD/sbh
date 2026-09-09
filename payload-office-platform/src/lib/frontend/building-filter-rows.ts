import { BUILDING_GRADE_LABELS, type BuildingGrade } from '@/components/frontend/building-grade'
import type { FilterRow } from '@/components/frontend/listing/FilterFormC'
import {
  BUILDING_DIMENSION_PARAM_KEYS,
  type BuildingSearchDimension,
  type BuildingSearchInput,
} from '@/domain/public-catalog'
import { enumLabel, vocabularyName } from './filter-dimension'

/**
 * 楼盘列表页筛选行（形态 C）的构造。
 *
 * 设计依据：docs/SBH设计任务讨论/楼盘列表.dc.html specRows「筛选维度」——
 * 区域 · 等级 · 地铁 · 在租面积 · 竣工年代 · 仅看有在租（6）。前五个是文本条件行，
 * 第六个是开关 pill（本批次唯一允许用 accent 底的筛选项），由编排层单独构造，
 * 见 `FilterFormC.switchRow`。
 *
 * ## 与 comp 的两处差异（显式取舍，不是遗漏）
 *
 *   - **在租面积 / 竣工年代是「下限」单选而不是 comp 的区间桶**：`FilterRow` 一行
 *     只写一个 URL 参数（`buildOptionHref` 的契约），区间要同时写两个键。与房源页
 *     的价格行同一处置（见 listing-filter-rows.ts 顶部注释），选项文案照实写
 *     「500 ㎡以上」「2010 年后」，不写含糊的「500–2000㎡」再偷偷只按下限查。
 *   - **没有「价格」行**：comp 左列的形态 C 演示里有一行价格，但楼盘本身没有报价
 *     （`BuildingSearchInput` 也没有这个维度，楼盘的价格属于楼内各房源）。造一个
 *     写进 URL 却不参与查询的筛选行，就是「点了没反应的死控件」；specRows 的
 *     「筛选维度」权威列举的六项里也没有价格。因此少一行，而不是渲染一个假行。
 *
 * ## 计数一律来自剥离后的 facets
 *
 * `facets` 必须来自 `searchBuildingsFiltered`——它对每个维度都先剥掉该维度再统计。
 * 用完整筛选后的分布会让选中静安以后其余区计数全为 0（自我擦除），用完全不筛选的
 * 分布则会在叠加了别的条件时报出点进去拿不到的数字。
 */

/** 一行筛选（或开关）对应的搜索维度：空态②按维度构造退路时要用同一份对应关系。 */
export type BuildingFilterDimensionSpec = Readonly<{
  dimension: BuildingSearchDimension
  /** 维度中文名，用于空态②的退路文案。 */
  label: string
  /** 该维度占用的 URL 参数键（构造「去掉这一个条件」的 href 时全部删掉）。 */
  paramKeys: readonly string[]
  /**
   * 这个维度此刻是否在收窄结果集。判据与 `activeText != null` 刻意分开，
   * 理由见 `listing-filter-rows.ts` 同名字段的注释（词表里查不到名称的取值
   * 仍然可能是一个生效条件，不能因为叫不出名字就从 UI 上整个消失）。
   */
  active: boolean
  /**
   * 当前生效值的可读文案；未生效、或生效但词表里查不到名称时为 null。
   *
   * **绝不回落成 URL 上的原始取值**，理由见 `filter-dimension.ts` 顶部注释。
   */
  activeText: string | null
  /**
   * 一个维度占多个 URL 键时，各键各自的可读文案（如
   * `{ leasableAreaMin: '500 ㎡以上', leasableAreaMax: '2,000 ㎡以下' }`）。
   *
   * 用途是「只有一半条件被筛选行显示出来」时补 chip：在租面积行只建模下限，
   * 上限没有任何控件能显示。有了逐键文案，补出来的 chip 才能**只说也只清那一半**
   * ——否则只能拿整个维度的 activeText 去补，屏幕上会并排出现
   * 「在租面积：500 ㎡以上」与「在租面积：500 ㎡以上 · 2,000 ㎡以下」两个 chip，
   * 后者是前者的超集，用户无从判断该点哪个。单键维度不需要这个字段。
   */
  paramTexts?: Readonly<Record<string, string>>
}>

/** 在租面积下限门槛（㎡）：产品档位，不是从数据算出来的分位数，跨城市跨时间可比。 */
const AREA_MIN_BUCKETS: readonly number[] = [500, 1000, 2000, 5000]

/**
 * 竣工年代下限门槛。
 *
 * comp 的四档是区间（2020 后 / 2010–2019 / 2000–2009 / 2000 前），这里按下限重述为
 * 单调档位：越靠前越新。「2000 年前」在下限模型里等价于「不限」，因此不出现——
 * 一个点了等于什么都没筛的选项就是死控件。
 */
const COMPLETED_AFTER_BUCKETS: readonly number[] = [2020, 2010, 2000]

/** 数字读法：与 listing-filter-rows.ts 的 compactNumber 同一惯例。 */
function compactNumber(value: number): string {
  if (value >= 10000 && value % 1000 === 0) {
    const wan = value / 10000
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)} 万`
  }
  return value.toLocaleString('en-US')
}

function firstOrUndefined(values: readonly string[] | undefined): string | undefined {
  // 单选行：URL 上出现多值（老链接或手改）时只认第一个，其余交给
  // FilterFormC.findActiveOption 防御性丢弃，不在这里报错。
  return values && values.length > 0 ? values[0] : undefined
}

export type BuildingFacets = Readonly<{
  districts: ReadonlyArray<{ slug: string; name: string; count: number }>
  grades: ReadonlyArray<{ value: string; count: number }>
  metros: ReadonlyArray<{ slug: string; name: string; count: number }>
}>

export type BuildingFilterRowsResult = Readonly<{
  rows: readonly FilterRow[]
  /** 六个维度（含开关），顺序即空态②退路的展示顺序。 */
  dimensions: readonly BuildingFilterDimensionSpec[]
}>

/** 计数 >0 或正是当前选中项才渲染；0 计数的候选点进去必然空手而归（批次统一的「不显示 0」）。 */
function keepOption(count: number, isActive: boolean): boolean {
  return isActive || count > 0
}

export function buildBuildingFilterRows(params: Readonly<{
  input: BuildingSearchInput
  facets: BuildingFacets
}>): BuildingFilterRowsResult {
  const { input, facets } = params

  const activeDistrict = firstOrUndefined(input.district)
  const activeGrade = firstOrUndefined(input.grade)
  const activeMetro = firstOrUndefined(input.metro)
  const activeAreaMin = input.leasableAreaMin != null ? String(input.leasableAreaMin) : undefined
  const activeCompletedAfter = input.completedAfter != null ? String(input.completedAfter) : undefined

  const districtOptions = facets.districts
    .filter((d) => keepOption(d.count, d.slug === activeDistrict))
    .map((d) => ({ value: d.slug, label: d.name, ...(d.count > 0 ? { count: d.count } : {}) }))

  const gradeOptions = (Object.keys(BUILDING_GRADE_LABELS) as BuildingGrade[])
    .map((value) => ({ value, count: facets.grades.find((g) => g.value === value)?.count ?? 0 }))
    .filter((g) => keepOption(g.count, g.value === activeGrade))
    .map((g) => ({ value: g.value, label: BUILDING_GRADE_LABELS[g.value], ...(g.count > 0 ? { count: g.count } : {}) }))

  const metroOptions = facets.metros
    .filter((m) => keepOption(m.count, m.slug === activeMetro))
    .map((m) => ({ value: m.slug, label: m.name, ...(m.count > 0 ? { count: m.count } : {}) }))

  const areaOptions = AREA_MIN_BUCKETS.map((threshold) => ({
    value: String(threshold),
    label: `${compactNumber(threshold)} ㎡以上`,
  }))

  const completionOptions = COMPLETED_AFTER_BUCKETS.map((year) => ({
    value: String(year),
    label: `${year} 年后`,
  }))

  const rows: FilterRow[] = [
    { key: 'district', label: '位置', options: districtOptions, ...(activeDistrict ? { activeValue: activeDistrict } : {}) },
    { key: 'grade', label: '等级', options: gradeOptions, ...(activeGrade ? { activeValue: activeGrade } : {}) },
    { key: 'metro', label: '地铁', options: metroOptions, ...(activeMetro ? { activeValue: activeMetro } : {}) },
    { key: 'leasableAreaMin', label: '在租面积', options: areaOptions, ...(activeAreaMin ? { activeValue: activeAreaMin } : {}) },
    { key: 'completedAfter', label: '竣工年代', options: completionOptions, ...(activeCompletedAfter ? { activeValue: activeCompletedAfter } : {}) },
  ]

  // 区域 / 地铁的名称只能来自 facets。facets 的候选清单取自这次扫描的全集
  // （`searchBuildingsFiltered` 里 `overlay(allFacets.x, ...)`，计数才取自剥离后的
  // 子集），因此正常情况下查得到名字；查不到时**只表示这一页叫不出它的名字**，
  // 不表示它不存在——那次扫描有 200 条上限，超过上限的城市里真实存在的区/站
  // 同样会缺席。存在性判定不在这里做（区域在路由层按地点表判，见
  // `(frontend)/_lib/search-input.ts`；地铁没有词表可判，一律保留过滤）。
  const districtName = vocabularyName(activeDistrict, facets.districts)
  const metroName = vocabularyName(activeMetro, facets.metros)

  const dimensions: BuildingFilterDimensionSpec[] = [
    {
      dimension: 'district',
      label: '位置',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.district,
      active: activeDistrict != null,
      activeText: districtName,
    },
    {
      dimension: 'grade',
      label: '等级',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.grade,
      active: activeGrade != null,
      // 解析层 `BUILDING_GRADE_VALUES` 白名单已挡住非法值，null 分支正常链路不可达；
      // 照样不写 `?? activeGrade`，理由同 `listing-filter-rows.ts` 的 listingType。
      activeText: enumLabel(activeGrade, BUILDING_GRADE_LABELS),
    },
    {
      dimension: 'metro',
      label: '地铁',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.metro,
      active: activeMetro != null,
      activeText: metroName,
    },
    {
      dimension: 'leasableArea',
      label: '在租面积',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.leasableArea,
      active: input.leasableAreaMin != null || input.leasableAreaMax != null,
      activeText:
        input.leasableAreaMin != null || input.leasableAreaMax != null
          ? [
              input.leasableAreaMin != null ? `${compactNumber(input.leasableAreaMin)} ㎡以上` : null,
              input.leasableAreaMax != null ? `${compactNumber(input.leasableAreaMax)} ㎡以下` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : null,
      paramTexts: {
        ...(input.leasableAreaMin != null
          ? { leasableAreaMin: `${compactNumber(input.leasableAreaMin)} ㎡以上` }
          : {}),
        ...(input.leasableAreaMax != null
          ? { leasableAreaMax: `${compactNumber(input.leasableAreaMax)} ㎡以下` }
          : {}),
      },
    },
    {
      dimension: 'completedAfter',
      label: '竣工年代',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.completedAfter,
      active: input.completedAfter != null,
      activeText: input.completedAfter != null ? `${input.completedAfter} 年后` : null,
    },
    {
      dimension: 'onlyWithStock',
      label: '在租状态',
      paramKeys: BUILDING_DIMENSION_PARAM_KEYS.onlyWithStock,
      active: input.onlyWithStock === true,
      activeText: input.onlyWithStock ? '仅看有在租' : null,
    },
  ]

  return { rows, dimensions }
}
