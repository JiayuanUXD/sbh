# Task Packet：OPT-093 首页热门商圈候选池换源、去上限

> 状态：**已实施，待合并**
> 创建日期：2026-09-12
> 来源：用户想在线上首页热门商圈配「陆家嘴 / 张江 / 漕河泾 / 虹桥 / 静安寺」，
> 查线上库发现只配「精选区域」会漏掉漕河泾与虹桥

---

## 1. 一句话

首页商圈卡候选池不再从「精选楼盘前 30 栋」反推，改为按该城**全部在营楼盘**聚合、
不设张数上限；运营只需在「城市站点配置 → 首页内容 → 精选区域」里选商圈、拖顺序，
不必再去楼盘上改「推荐排序」。

## 2. 根因

`facade.ts#getHomepage` 的商圈卡聚合 `byArea` 取自 `findFeaturedBuildings(ctx, 30)`——
这个 30 是为「精选楼盘」栏过取的（展示 8 张，过取 30 供封面挑选），商圈卡顺手借用了。
商圈能否进池于是取决于其楼盘在 `recommendedOrder ↑, updatedAt ↓` 里是否排进前 30。
线上上海所有楼盘 `recommendedOrder` 皆为 0，实际按更新时间倒序：漕河泾（华鑫慧享城，
第 76 名）、长宁虹桥（第 75 名）、闵行虹桥（第 36 名）全部出局。

此外 `DEFAULT_DISTRICT_CARD_POOL_LIMIT = 20` 在视图层重排**之前**截断，任何上限都可能把
精选商圈挤出去——与 OPT-060 修的缺陷同类，只是阈值从 5 变成 20。

`CitySiteProfiles.featuredRegions` 只负责**重排**（`orderByFeaturedRegions`），不负责拉入。
运营看不到「进池门槛」这层逻辑，只会觉得「配了没反应」。

## 3. 做法

| 层 | 改动 |
|---|---|
| `src/domain/public-catalog/facade.ts` | 商圈卡聚合源改为 `allEffectiveBuildings`（`findEffectiveBuildings`，≤200，同一批 `Promise.all` 已在查、`depth: 2` 已填充 `businessDistrict`，零新增查询）。内存里按 `recommendedOrder ↑, updatedAt ↓` 排一次再聚合，代表楼盘 / 封面仍取「最推荐的那栋」 |
| 同上 | 删除 `DEFAULT_DISTRICT_CARD_POOL_LIMIT` 与 `districtCardPoolLimit` 选项：候选池 = 所有「有在营楼盘」的商圈。质量门槛（无在营楼盘不进池）不变，天然把张数锁在楼盘数以内 |
| `src/components/frontend/city/CityHomeView.tsx` | 只改注释：候选池不再有上限，重排 + 截张数的顺序不变 |
| `tests/public-catalog-facade.test.ts` | 替换两条 `districtCardPoolLimit` 用例（见 §4） |

**不改**：精选区域配置继续留在 `unstable_cache` 之外（改配置立即生效、不打供给侧标签）；
`findFeaturedBuildings` 与首页「精选楼盘」栏不动；后台字段不动、无迁移。

DTO 代价：上海当前 32 个有在营楼盘的商圈 × 约 600B ≈ 20KB，全在服务端缓存，不过网络。

## 4. 验收

- [x] 单测：精选楼盘前 30 名之外的商圈，只要有在营楼盘就进候选池（`poolFixture(35)` 全进）
- [x] 单测：无在营楼盘的商圈仍不进候选池（既有用例）
- [x] 单测：每张卡的代表楼盘按 `recommendedOrder ↑, updatedAt ↓` 取，不受 `findEffectiveBuildings` 返回顺序影响
- [x] 单测：候选池张数 = 有在营楼盘的商圈数，不再被 20 截断
- [x] 本地浏览器：克隆 31 栋楼盘把外滩压到第 36 名后仍出卡；精选区域改顺序立即生效；代表楼盘随 `recommendedOrder` 变
- [x] `typecheck` 干净 / `lint` 0 error / `test` 5019 passed

证据：`artifacts/verification/OPT-093/`。

## 5. 上线后运营侧要做的

后台「站点与内容 → 城市站点配置 → 上海 → 首页内容 → 精选区域」依次选
陆家嘴 → 张江 → 漕河泾 → 虹桥 → 静安寺，保存即生效。

线上有两个同名商圈「虹桥」（长宁区 `hongqiao` = 虹桥开发区；闵行区 `minhang-hongqiao` =
虹桥商务区），建议在「城市与区域」里把名字改成「虹桥开发区」「虹桥商务区」消歧（只改名，不动 slug）。

## 6. 不在本项内

- 后台「该商圈暂无在营楼盘，首页不会展示」提示：需给级联组件新开一个查询接口，另立工作项。
