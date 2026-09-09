import {
  parseBuildingSearchInput,
  parseListingSearchInput,
  type BuildingSearchInput,
  type ListingSearchInput,
} from '@/domain/public-catalog'
import { getCachedListingDistrictOptions } from '@/lib/frontend/cached-queries'
import { keepKnownValues } from '@/lib/frontend/filter-dimension'

/**
 * 列表页搜索参数的解析 + 未知区域取值的收口（房源 / 出售 / 楼盘三条路由共用）。
 *
 * ## 为什么区域的白名单在这里，而不在解析层
 *
 * `parseListingSearchInput` / `parseBuildingSearchInput` 对每一个**静态**词表都做了
 * 白名单（`type` / `sort` / `priceUnit` / `grade`，非法值静默丢弃、由 canonical 对外
 * 规范化，见 `search-params.ts` 顶部注释）。区域是**按城市变化**的词表，纯函数解析层
 * 拿不到，于是 `?district=<任意字符串>` 一路穿到底：结果集被筛成 0，筛选 chip 上却
 * 印着「位置：<任意字符串>」——把一段 URL 输入当成行政区名展示给用户
 * （旧实现 `districts.find(...)?.name ?? 原始取值`）。
 *
 * 这里是**能拿到城市区域表的最早一层**，也是必须收口的那一层：区域表要先于列表查询
 * 取到，`input` 才能同时决定「查什么」和「页面上说什么」。放到视图层就晚了——那时
 * 结果集已经按未知取值筛过一遍，视图再把 chip 藏起来只会造出一个看不见的生效条件
 * （`.agent/frontend.md` 反复点名的那一类）。
 *
 * ## 词表必须是**地点表**，不能是结果集里出现过的区域
 *
 * 楼盘页曾经想直接用查询层算出的全城 facet 当词表（`buildBuildingFacets(allDocs)`）。
 * 那是错的：`allDocs` 来自 `findEffectiveBuildings`，默认 `limit = 200` 且在库查之后
 * 还会再过一道 `isPublicBuilding` 过滤。一个公开楼盘超过 200 个的城市里，只出现在
 * 第 200 名之后的**真实**行政区会在 facet 里查不到，于是一个完全合法的筛选被当成
 * 「不存在的区」丢掉，页面转而渲染未筛选的前 200 个楼盘——比原缺陷更糟。
 * 结果集的分布回答不了「这个地方存不存在」，只有地点表能回答，因此两条路由都走
 * `getCachedListingDistrictOptions`（函数名带 listing 是历史原因，它取的是
 * `findEffectiveDistricts`——该城市 `frontendVisible` 的行政区全集，与页面无关）。
 *
 * 地铁 / 商圈没有对应的词表可用（本仓库没有「该城市可筛地铁站」这类查询），
 * 因此判定不了存在性，一律**不丢弃**：条件照旧生效、照旧可见可清除，只是 chip 与
 * 退路不印取值（见 `lib/frontend/filter-dimension.ts` 顶部的两条出路）。
 *
 * ## 代价：只有真的带了 `?district=` 的请求才多一次串行
 *
 * 没有区域筛选时直接返回，路由仍按原样并发取数。带了区域筛选时才需要先拿到区域表，
 * 而这一次取数走 `unstable_cache`（300s）+ 按城市 memo；房源页上它本来就在关键路径上
 * （`districts` 是 `CityListingsView` 的 prop）。
 */

/** 只保留该城市地点表里真实存在的区域取值；一个都不剩时返回 undefined（= 未生效）。 */
async function keepKnownDistricts(
  citySlug: string,
  values: readonly string[],
): Promise<readonly string[] | undefined> {
  const districts = await getCachedListingDistrictOptions(citySlug)
  return keepKnownValues(values, new Set(districts.map((district) => district.slug)))
}

/**
 * 房源列表 / 出售频道：解析 URL 并丢掉本城不存在的区域取值。
 *
 * @param citySlug 城市 slug；`getCachedListingDistrictOptions` 内部会做 canonical 化。
 */
export async function resolveListingSearchInput(
  citySlug: string,
  sp: URLSearchParams,
): Promise<ListingSearchInput> {
  const parsed = parseListingSearchInput(sp)
  if (!parsed.district || parsed.district.length === 0) return parsed

  const district = await keepKnownDistricts(citySlug, parsed.district)
  if (district) return { ...parsed, district }

  // 一个都没留下 → 这个维度整个没生效。必须**删键**而不是写 undefined：
  // `buildCanonicalSearchParams` 等下游一律以「缺省 = 未生效」判空。
  const next: { -readonly [K in keyof ListingSearchInput]: ListingSearchInput[K] } = { ...parsed }
  delete next.district
  return next
}

/** 楼盘列表：与 `resolveListingSearchInput` 同一口径、同一份区域词表。 */
export async function resolveBuildingSearchInput(
  citySlug: string,
  sp: URLSearchParams,
): Promise<BuildingSearchInput> {
  const parsed = parseBuildingSearchInput(sp)
  if (!parsed.district || parsed.district.length === 0) return parsed

  const district = await keepKnownDistricts(citySlug, parsed.district)
  if (district) return { ...parsed, district }

  const next: { -readonly [K in keyof BuildingSearchInput]: BuildingSearchInput[K] } = { ...parsed }
  delete next.district
  return next
}
