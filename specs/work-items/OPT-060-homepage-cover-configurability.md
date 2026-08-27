# Task Packet：OPT-060 首页配图可配——类型卡封面 + 商圈上榜权

> 状态：**设计已定，未实施**
> 创建日期：2026-08-27
> 来源：用户提出「想对『按类型浏览』和『热门商圈』的图自由配置，以便控制图片质量、吸引用户关注」
> 编号说明：OPT-059 是图片渲染管线，故取 060
> **前置依赖**：`OPT-059` 必须先上线。理由见该文档 §8.1——否则运营配的图要传两遍。

---

## 1. 一句话

首页两个图卡区块，运营对「出现哪张图」**几乎没有抓手**：类型卡的封面是系统从
房源里随手挑的；商圈卡虽然能配封面，但**配了不一定上得了榜**。

## 2. 证据：两个区块，两种不同的缺位

### 2.1 「按类型浏览」：封面完全不可配

`facade.ts:962-971` 聚合 `typeSummaries` 时，封面取的是该类型**第一条房源**的封面：

```ts
cover: prev?.cover ?? card.coverImage ?? null
```

`HomeTypeCards.tsx:55` 直接消费 `summary?.cover`。后果是**房源一变、排序一动，
首页的图就跟着换**，运营没有任何抓手。

而 `SiteSettings.ts:182` 的 `typeCards` 已经有 `slot / label / sublabel / visible`
——文案和显隐早就可配（`OPT-053` 做的），**唯独封面没接**。

### 2.2 「热门商圈」：能配封面，但配了不一定生效

封面本身是可配的：`Locations.ts:346-355` 的 `coverImage`（`business_area` /
`district` 可见），`facade.ts:938` 优先取它、缺省回退到「该商圈下第一个有封面的楼盘」。

**真正不可控的是哪些商圈能上榜、排第几。** 而且这里有一个隐蔽缺陷：

- `facade.ts:930` 在组装时就 `if (districtCards.length >= districtCardsLimit) break`，
  `DEFAULT_DISTRICT_CARDS_LIMIT = 5`（`facade.ts:332`）——**卡片在 facade 里已被截断到 5 张**；
- 而「精选区域」的重排 `orderByFeaturedRegions` 是在 `CityHomeView.tsx:56`
  **之后**才跑的；
- bento 恰好也是 5 个坑位。

合起来：**「精选区域」目前只能调这 5 张的内部顺序（决定谁上大卡、谁上小卡），
却拉不进第 6 名的商圈。** 运营把陆家嘴设为精选、认真配了封面，如果陆家嘴的楼盘
`recommendedOrder` 排在第 6，首页依然看不到它——而后台不会有任何提示。

上榜排序来自 `Buildings.recommendedOrder` 的聚合（商圈按其下楼盘间接排序），
这正是 `featured-regions.ts` 开头那段注释说的「间接排序」问题；`OPT-053` 接上了
`featuredRegions` 这根线，但**没发现它被截断顺序架空了**。

## 3. 目标与非目标

**目标**：运营能决定首页两个区块「出现哪张图」——类型卡直接指定封面，
商圈能决定是哪 5 个上榜。

**非目标**：
- 不开放跳转目标配置（§5.1）；
- 不放宽「有在营楼盘」的质量门槛（§4）；
- 不给 bento 加「第 6 张候补」之类的展示逻辑——池子变大只服务于选择权，
  前台永远只渲染 5 张，降级规则（5 / 3~4 / 1~2 / 0 张）原样不动。

## 4. 关键裁定：质量门槛保留

`facade.ts:934` 的质量门槛——**没有在营楼盘的商圈不进卡片区**（库中商圈有 205 个
而多数暂无楼盘，否则首页会出现只有名字的空卡）——**予以保留**，运营配了图也不能绕过。

理由：卡片点进去是 `/listings?district=xxx`，空商圈 = 用户点进一个空结果页，
比首页少一张卡伤害大得多。这与本仓库在 `ExcludedUnitsBar` 上坚持的诚实口径一致。

「想推一个没货的商圈」是供给问题，不该用首页配图来兜。

## 5. 方案

### 5.1 配置模型

**类型卡封面（新增）**：

| 位置 | 字段 | 作用 |
|---|---|---|
| `SiteSettings.typeCards[]` | `coverImage`（upload → media，选填） | 七城默认图 |
| `CitySiteProfiles` | `typeCardOverrides[]`（slot + coverImage，选填） | 单城覆盖 |

**只覆盖图，不覆盖文案。** `label` / `sublabel` 分城维护的价值远低于维护成本，
分叉后很容易出现「上海说独立空间、深圳说灵活面积」这种无意义差异。

取数优先级：

```
城市覆盖 → 全局默认 → 该类型首条房源封面（现状）→ 无图
```

**后两级必须保留**——保证配置为空时行为与今天完全一致，上线当天不会有任何城市首页变样。

**跳转目标依然不可配。** `HomeTypeCards.tsx:14-25` 的注释已把理由写透：开放 `href`
等于开放死链（它绑定 `Listings.listingType` 枚举，填错不会 404 而是返回空结果页，
比 404 更难发现），且槽位必须**逐行持久化、不能靠数组下标绑定**（一拖拽调序，
「联合办公」就会链到传统办公，标题副标题都对、只有链接错，页面上完全看不出来）。
新增的 `coverImage` 与 `label` 一样挂在 slot 行上，**沿用同一套约束**。

**商圈侧不加新字段**——`Locations.coverImage` 已经够了，只修生效时机（§5.2）。

### 5.2 取数与生效路径：为什么改动落在视图层

`getHomepage` 的结果整个包在 `unstable_cache` 里，失效标签**全是供给侧的**
（`cached-queries.ts:132-139`，listings/buildings 变更才失效）。

**若把「精选区域重排」下沉进 facade，运营改了配置、供给没变，首页会一直吐旧缓存**
——运营改完看不到效果，还以为功能坏了。现在重排放在 `CityHomeView`（缓存外）
恰好是对的，**只是执行时机太晚**。

所以方案是「facade 放宽截断，视图层重排后再截」：

1. **商圈截断修复**：`getHomepage` 把 `districtCardsLimit` 从 5 提到候选池上限
   （建议 20），**继续执行质量门槛**（§4）。`CityHomeView.tsx:56` 拿到池子后
   先 `orderByFeaturedRegions` **再 `slice(0, 5)`** 交给 bento。
   效果：运营配的精选商圈只要有货就一定能进 5 张卡，且供给缓存完全不用感知配置。
   `orderByFeaturedRegions`（`featured-regions.ts:35`）本身**零改动**。
2. **类型卡封面合并**：同样在视图层。`CityHomeView` 已经同时拿着 `siteSettings`
   （全局）和 `city.profile`（城市覆盖），新增纯函数
   `resolveTypeCardCovers(typeCards, typeCardOverrides, typeSummaries)`
   按 §5.1 的四级优先级吐出每张卡的最终封面；`HomeTypeCards` 只管渲染收到的图，
   **不再自己从 `typeSummaries` 挑**。
3. **配置的生效时延**：`SiteSettings` / `CitySiteProfiles` 走它们现有的缓存与
   失效路径，不新增机制。商圈封面（`Locations.coverImage`）在供给查询里，
   跟着供给缓存走，现状已如此。

两个纯函数（重排已有、封面合并新增）都是无 IO 的，直接进单测，**不用碰
supply adapter 的 mock**。

### 5.3 客户端边界

`SiteSettingsView`（`site-settings-view.ts:28`）被 `'use client'` 组件消费，
且有传递闭包守卫（`client-components-no-server-imports.test.ts:98`）。
类型卡封面**必须在服务端 `mapTypeCards`（`site-settings.ts:70-81`）里映射成纯 DTO**
（复用 `mapMedia` 的 URL 白名单），不能让客户端组件 import `site-settings.ts`
——否则守卫红且 `next build` 失败。

`SITE_SETTINGS_FALLBACK`（`site-settings-view.ts:59`）须同步补上新字段。

## 6. 顺带修正

- **`facade.ts` 的过期注释**：`districtCardsLimit` 那段写着「商圈卡默认 9 张：
  栅格 4 列、大卡占 2x2，1 大 + 8 小恰好填满 3 行」，而常量早已是 5
  （bento 改版后没跟着改）。**改注释时连同新的候选池语义一起写清楚。**
- **`opt035-homepage-stats.test.ts:53` 的测试标题在撒谎**：标题写「并取首个封面」，
  但断言本体只查 `count`（`:62-63`），对 cover 值零直接断言。
  本次改为配置优先**不会红任何现有断言**——正因如此更要顺手把标题改真、补上 cover 断言，
  否则它会被后来者误当作已有覆盖。

## 7. 前台零变化（刻意设计）

上线瞬间：`typeCards[].coverImage` 全空 → 落回「首条房源封面」；
`featuredRegions` 目前七城 profile 全空 → `orderByFeaturedRegions` 原样返回
（`featured-regions.ts` 开头注释明确要求空配置必须不改变现状）；
候选池变大但仍只渲染前 5 张，且质量门槛不变 → 取到的还是同样那 5 张。

**首页要等运营真的去配了才会变**，不会出现「某天早上首页自己变了样」。

## 8. 验收

常规（typecheck / 单测 / 迁移）之外，以下**必须在浏览器里实际做**：

1. **后台实配一遍**：用 `scripts/seed.ts` 的 E2E 夹具账号登录，实际配一张全局
   类型卡封面、一张城市覆盖、把一个商圈设为精选——确认存盘后前台如实反映，
   且**城市覆盖真的只作用于那个城市**。
2. **验证截断修复真的生效**：找一个「有在营楼盘但 `recommendedOrder` 排在第 6 名之后」
   的商圈，设为精选，确认它**确实出现在首页 bento 里**。这是本工作项的核心断言，
   不能只靠单测。
3. **验证质量门槛仍在**：把一个**无在营楼盘**的商圈设为精选，确认它**不出现**
   （§4 的裁定）。
4. **两个断点各验**：`home.css:210` 在 ≤767px 把类型卡图片 `display: none`、
   bento 三档高度统一成 232px。桌面绿不等于移动绿。

**本地验之前先 `pnpm exec payload migrate`**——本地库落后会看到「缺列 500 →
页面降级」的假象。

做对照实验时**先确认对照组真的是未修复状态**（根 `CLAUDE.md` 有过一次
「拿已含修复的工作树当对照」的真实教训）。

证据存 `artifacts/verification/OPT-060/`。

## 9. 测试影响面（已核实）

| 文件 | 影响 |
|---|---|
| `tests/preflight-migrations.test.ts:44` | 迁移计数是**精确相等断言**。**基数取决于落地顺序**：本工作项排在 `OPT-059` 之后，届时该值已被 059 从 `67` bump 到 `68`，本次再 bump 到 `69`——**以当时仓库实际值为准，不要照抄本文档的数字**。同时续写 30-42 行的清单注释 |
| `tests/public-catalog-facade.test.ts:611-620` | 「无楼盘的商圈不进卡片区」`toHaveLength(0)`——**质量门槛保留，故此断言应存活**。若它红了，说明实现误放宽了门槛，是真 bug 而非要改的测试 |
| `tests/public-catalog-facade.test.ts:625-630` | `unlimited.districtCards.length <= 5` 硬编码上界 → 候选池放宽后**必须改**（连同 `:624-626` 解释「1 大 + 4 小」的注释） |
| `tests/public-catalog-facade.test.ts:600-604` | 首卡 `buildings.length > 0` → 门槛保留则存活 |
| `tests/opt035-homepage-stats.test.ts:53-64` | 见 §6，改标题 + 补 cover 断言 |
| `tests/listings-query-prefetch-performance.test.ts:107-109` | **读源码字面量的契约测试**（断言 `href={...} prefetch={false}` 那几行）。改封面取值不动 Link 行则不破坏；一旦重排那几行（哪怕只是换行或属性顺序）就必须同步改断言 |
| `tests/city-home-view.test.ts` | `:67` 传 `typeSummaries: {}`、`:12` 引 `SITE_SETTINGS_FALLBACK`、`:107` 九 section 顺序锚点含「按类型浏览」。`CityHomeView` props 形状若变，需改 84-181 行全部 `createElement` 调用点 |
| `tests/city-route-pages.test.ts:148` | homepage mock 只有五键（无 `typeSummaries` / `stats` / `nearbyListings`），靠松散类型混过。**首页路由若新读字段而不做可选链，失败会以运行时 `undefined` 出现，排查成本高** |

`mapTypeCards`（`site-settings.ts:70-81`）与 `typeSummaries.cover` 目前是
**零覆盖区**——「配置优先」落在没有安全网的代码上，属新增测试而非更新测试。
