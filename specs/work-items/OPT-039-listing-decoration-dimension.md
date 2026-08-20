# Task Packet：OPT-039 房源搜索补齐「装修」筛选维度

> 状态：**待排期**（从 OPT-036 Task 11 显式延期而来，不是遗漏）
> 创建日期：2026-08-21
> 来源：OPT-036 列表页改版 Task 11 接线 + 该任务的 code review
> 编号说明：OPT-037（详情页改版）与 OPT-038（城市招募页改版）已被本轮改版预留，故取 039

---

## 1. 一句话

房源搜索缺 `decorationStatus` 维度，导致房源列表页的筛选条比设计稿少一行；
数据字段已存在，缺的是**查询链路**（解析层白名单 → canonical → SupplyAdapter `where`）。

## 2. 现状与证据

设计稿 `docs/SBH设计任务讨论/房源列表.dc.html` 的 specRows「形态 C 条件行」写明
**5 行：位置 / 类型 / 价格 / 面积 / 装修**。OPT-036 Task 11 接线后实际只有 4 行——
装修行没有实现。

| 事实 | 位置 |
|---|---|
| 房源上**已有**装修字段，且已进公开 DTO | `ListingCardViewModel.decorationStatus`（`src/domain/public-catalog/contracts.ts`），列表页返回的每条数据里都带着它 |
| 但 `ListingSearchInput` 里**没有**这个维度 | `src/domain/public-catalog/types.ts` |
| 因此解析层不认这个参数、canonical 不输出它、adapter 也不会据此过滤 | `src/domain/public-catalog/search-params.ts`、`src/domain/public-catalog/supply-adapter.ts` |
| 同一个概念在**楼盘详情页的供给筛选**里已经实现过一遍 | `BuildingSupplyInput.decorationStatus` + `BUILDING_SUPPLY_DECORATION_STATUSES`（`search-params.ts`），取值域 `rough` / `simple` / `furnished` / `fully_fitted` |

## 3. 为什么当时没做（三条理由，review 已认可）

1. **造一个假行比少一行更糟**：`FilterRow` 的每一行都写一个 URL 参数。若渲染一个
   写进地址栏却不参与查询的「装修」行，用户点了看似生效、结果集纹丝不动——正是本批次
   反复否掉的「点了没反应的死控件」（见 `ResultToolbar.tsx` 顶部 Task 8 的决策注释）。
2. **补真维度是域层工作，不是接线工作**：要动解析层白名单、canonical 输出、
   SupplyAdapter 的 `where`、以及配套域层测试——那是 OPT-036 Task 1/2 那一类任务的形状，
   塞进一个「把十个组件接成一个页面」的任务里会让改动范围失控。
3. **少一行是可见的、可解释的**，不像静默降级那样会被当成已完成。

## 4. 需要改什么

- [ ] `src/domain/public-catalog/types.ts`：`ListingSearchInput` 增 `decorationStatus?: readonly string[]`
- [ ] `src/domain/public-catalog/search-params.ts`：
  - `parseListingSearchInput` 用 `parseWhitelistedArray` + **复用**既有的
    `BUILDING_SUPPLY_DECORATION_STATUSES` 白名单（**不要再写第二份取值域**，
    两份枚举必然漂移——本仓库已有同类教训，见根 `CLAUDE.md`「多 agent 入口」一节）
  - `buildCanonicalSearchParams` 输出该参数，字段顺序固定
- [ ] `src/domain/public-catalog/supply-adapter.ts`：`findEffectiveListings` 的 where
      增 `decorationStatus: { in: [...] }`（列名以 `Listings` collection 为准，
      注意 URL 参数名与 Payload 字段名不一定同名——`priceUnit` vs `rentUnit` 就是先例）
- [ ] `src/domain/public-catalog/facade.ts`：`ListingSearchDimension` 增 `'decorationStatus'`，
      `omitListingSearchDimensions` 补一条剥离分支（**漏补不会报错**，只会让空态②少一条退路）
- [ ] `src/lib/frontend/listing-filter-rows.ts`：加第 5 行 + 维度清单条目 + 中文标签映射；
      计数走 `getCachedSearchFacetsIgnoring(input, ['decorationStatus'])`
      （与位置/类型同一口径：算候选计数必须先剥掉该维度自身，否则选中一项后其余项计数恒为 0）
- [ ] 测试：解析层白名单/降级、canonical round-trip、adapter where、
      `getSearchFacetsIgnoring(['decorationStatus'])`；
      并在 `tests/opt036-listings-view-wiring.test.ts` 的维度断言里补上这一维

## 5. 验收

- `/shanghai/listings?decorationStatus=fully_fitted` 结果集确实收窄，且 canonical 含该参数
- 筛选条渲染 5 行，装修行候选带真实计数，选中项黑底白字（移动）/ accent-link（桌面形态 C）
- 空态②的退路清单里能出现「取消「装修：精装带家具」这一个条件 · N」
- 出售频道（`/[city]/sale`）同样生效——两个频道共用 `CityListingsView`

## 6. 相关

- 决策与实现背景：`src/lib/frontend/listing-filter-rows.ts` 顶部注释「与 comp 的两处差异」
- 批次账本：`.superpowers/sdd/2026-08-21-listing-pages-redesign/progress.md`（Task 11 条目）
- 上游工作项：`specs/work-items/OPT-036-listing-pages-redesign.md`
