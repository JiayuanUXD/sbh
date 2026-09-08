import { parseListingSearchInput, type ListingSearchInput } from '@/domain/public-catalog'
import { getCachedListingDistrictOptions } from '@/lib/frontend/cached-queries'
import { keepKnownValues } from '@/lib/frontend/filter-dimension'

/**
 * 解析房源列表 / 出售频道的搜索参数，并丢掉本城不存在的区域取值。
 *
 * ## 为什么区域的白名单在这里，而不在解析层
 *
 * `parseListingSearchInput` 对每一个**静态**词表都做了白名单（`type` / `sort` /
 * `priceUnit`，非法值静默丢弃、由 canonical 对外规范化，见该文件顶部注释）。区域
 * 是唯一一个**按城市变化**的词表，纯函数解析层拿不到，于是 `?district=<任意字符串>`
 * 一路穿到底：结果集被筛成 0，筛选 chip 上却印着「位置：<任意字符串>」——把一段
 * URL 输入当成行政区名展示给用户（旧实现 `districts.find(...)?.name ?? 原始取值`）。
 *
 * 这里是**能拿到城市区域表的最早一层**，也是必须收口的那一层：区域表要先于列表
 * 查询取到，`input` 才能同时决定「查什么」和「页面上说什么」。放到视图层就晚了
 * ——那时结果集已经按未知取值筛过一遍，视图再把 chip 藏起来只会造出一个看不见的
 * 生效条件（`.agent/frontend.md` 反复点名的那一类）。
 *
 * ## 代价：只有真的带了 `?district=` 的请求才多一次串行
 *
 * 没有区域筛选时直接返回，路由仍然按原样把「列表查询」和「区域表」并发发出。
 * 带了区域筛选时才需要先拿到区域表，而这一次取数本来就在这一页的关键路径上
 * （`districts` 是 `CityListingsView` 的 prop），且走 `unstable_cache`（300s）+
 * 按城市 memo，串行代价是一次缓存读，不是一次新的库查询。
 *
 * @param citySlug 城市 slug；`getCachedListingDistrictOptions` 内部会做 canonical 化。
 */
export async function resolveListingSearchInput(
  citySlug: string,
  sp: URLSearchParams,
): Promise<ListingSearchInput> {
  const parsed = parseListingSearchInput(sp)
  if (!parsed.district || parsed.district.length === 0) return parsed

  const districts = await getCachedListingDistrictOptions(citySlug)
  const district = keepKnownValues(parsed.district, new Set(districts.map((d) => d.slug)))
  if (district) return { ...parsed, district }

  // 一个都没留下 → 这个维度整个没生效。必须**删键**而不是写 undefined：
  // `buildCanonicalSearchParams` 等下游一律以「缺省 = 未生效」判空。
  const next: { -readonly [K in keyof ListingSearchInput]: ListingSearchInput[K] } = { ...parsed }
  delete next.district
  return next
}
