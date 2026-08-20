# Task Packet：OPT-035 首页 Apple 中性极简改版（打样批次）

> 状态：**打样完成，待验收决策后推其余 5 个页面族**（实施结果见文末 §8）
> 创建日期：2026-08-20　实施完成：2026-08-20
> 分支：`feat/frontend-apple-redesign-c4e5`
> 设计依据：`docs/SBH设计任务讨论/首页.dc.html`（含桌面 1440 / 移动 375 / 落地数值表）
> 全量改版共 6 个页面族；本工作项只覆盖 token 层 + 首页打样，其余 5 页视打样结论另开工作项。

## 0. 决策记录（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 本轮范围 | 先打样首页（token 层 + `/` + `/[city]`），验证后再批量推其余 5 页 |
| token 文档与 `.dc.html` 冲突 | **以 `.dc.html` 为准**（后出且标注「已锁定」），实现后回写 `sbh-design-tokens.css`、`sbh-design-system.md`、`.agent/frontend.md` |
| 数据带 | 做，数字算真的；第四格「平均响应」为 `CitySiteProfiles` 可配字段，留空不渲染 |
| 数据口径 | 城市页算本城，根页 `/` 算全平台汇总 |
| 附近房源 section | 做，但不做定位授权：以城市中心（`Locations.centerLatitude/Longitude`）为锚点，改名「核心商圈房源」 |
| 中间态 | 方案 A：全局换 token + 导航页脚，内页版式不动、经别名继承新色板 |

## 1. 范围

**改**：
- `styles.css` §1 token 层整块重写 + 兼容别名
- `SiteHeader` / `SiteFooter`（44px 浅色玻璃导航）
- `CityHomeView` 及其子组件（`/` 与 `/[city]` 共用，一次改完）
- `getHomepage` facade 扩展（stats + 核心商圈房源）
- `CitySiteProfiles` 加 `avgResponseHours` 字段 + 迁移

**不改**：`/listings`、`/buildings`、`/entrust`、`/publish`、`/news`、`/sale`、`/pages/*` 的版式（经 token 别名继承新色板，版式后续批次处理）。

section 顺序（按 `.dc.html` 已锁定版）：

```
Hero（视频背景）→ 按类型浏览 → 热门商圈 → 热门楼盘 → 数据带
→ 精选房源 → 为什么选择我们 → 核心商圈房源 → 资讯 → 页脚
```

## 2. Token 层

`styles.css` §1 重写为设计稿取值（注意：**不是** `sbh-design-tokens.css` 的初稿值）：

```css
--bg:#f5f5f7;  --bg-subtle:#ffffff;   /* 全局浅灰，白色是「白底带」与卡片 */
--ink:#1d1d1f; --ink-2:#6e6e73; --ink-3:#86868b;
--accent:#0071e3; --accent-hover:#0077ed; --accent-link:#0066cc;
--line:rgba(0,0,0,.08); --line-strong:rgba(0,0,0,.16);
--shadow:0 4px 20px rgba(0,0,0,.06); --shadow-hover:0 14px 36px rgba(0,0,0,.12);
--ease:cubic-bezier(.4,0,.2,1); --ease-apple:cubic-bezier(.28,.11,.32,1);
--focus-ring:0 0 0 4px rgba(0,113,227,.18);
--pad:72px; --gap:144px; --w:1180px; --measure:702px;
--r-card:18px; --r-ctrl:12px; --r-input:8px; --r-pill:980px;
--header-height:44px; --header-bg:rgba(255,255,255,.8);
--header-blur:saturate(1.8) blur(20px);
--font-cn:"PingFang SC","Source Han Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
--font:"Geist","SF Pro Text",-apple-system,"Helvetica Neue",var(--font-cn);
```

与初稿 token 文档的关键差异（`.dc.html` 胜出）：section 间距 144（非 236）、容器 1180（非 1024）、底色反转（灰底白卡）、卡片**有**阴影 + hover 上浮（非零阴影）、Hero 用视频背景（非纯白）。

**兼容别名**（让内页 245 处旧引用零改动继承新色板）：

```css
--color-copper: var(--accent);      --color-copper-hover: var(--accent-hover);
--color-paper: var(--bg);           --color-canvas: var(--bg);
--color-surface: var(--bg-subtle);  --color-ink: var(--ink);
--color-ink-2: var(--ink-2);        --color-muted: var(--ink-3);
--color-line: var(--line);          --color-line-strong: var(--line-strong);
--color-forest: var(--ink);         /* 新体系无第二彩色，降级为墨色 */
--font-display: var(--font);        /* 宋体退场 */
```

已知坑（实现时逐条核）：
- `--color-on-copper:#fff8ef` 在 `#0071e3` 上对比度 4.4:1 不到 AA，改纯白 `#ffffff`
- `--color-copper-soft` / `--color-forest-soft` 这类软底色在内页作背景使用，映射到 `--bg-subtle`，逐个落点核对可读性
- `--color-danger` / `--color-warn` 保留（真实错误/警告语义），色值换成 `#bf4800` / `#b25000`
- `layout.tsx` 的 `viewport.themeColor` 从 `#fcfbf8` 改 `#f5f5f7`

CJK 铁律：中文 `letter-spacing:normal`；唯一例外 21px 引导副标 `+0.011em`。

## 3. 组件架构

新建 `src/components/frontend/home/`，`CityHomeView` 退化为纯编排层。样式落在新文件 `src/app/(frontend)/styles/home.css`，在 `layout.tsx` 中于 `./styles.css` 之后引入；同时删除 `styles.css` §11 / §16.5 / §22 三段旧首页样式（约 1500 行）。

| 组件 | 替代 | 关键规格（出自 `.dc.html` 落地数值表） |
|---|---|---|
| `HomeHero` | 现 hero section | 复用 `HomeHeroMedia`（视频懒加载/降级已就绪）；min-height 760；遮罩 `linear-gradient(rgba(0,0,0,.44), rgba(0,0,0,.24) 55%, rgba(0,0,0,.5))`；标题 56/600/1.07 白字居中；副标 21/400/1.38/+0.011em；下挂 4 个热门筛选 pill |
| `HomeSearchPill` | `HeroSearch` | 560×52 pill、radius 980、内 padding 4/4/4/18；「筛选」按钮收纳下拉；44×44 蓝底提交钮；client 组件 |
| `HomeTypeCards` | `CategoryTiles` | 方案 B 五等分图卡：1fr×300、图高 168、文字 19/600 + 13/400 + 13/ink-3、gap 12、编号 01–05 |
| `HomeDistrictBento` | `DistrictCards` | 方案 1 大卡主导：2fr×480（1180 时大卡 776）、小卡 332×232 / 504×280、gap 16、圆角 18；图上白字必带底部 45% 渐变压暗 |
| `HomeBuildingsRail` | `FeaturedBuildings` | 卡 400×(300+信息)、通栏横滑；标签「甲级 + 在租 N 套」 |
| `HomeStatsBand` | 新增 | 白底满宽带 padding 56；4 等分（第四格空缺时 3 等分）；数字 48/600/1.08 tabular-nums；进视口 30% 触发 1100ms easeOutCubic 滚动 |
| `HomeListingsRail` | 精选房源 section | 方案 B 通栏横滑：卡 400 宽、图 4:3、padding 20/24/24、价格 24/600 tabular-nums + 单位 14/400；首卡对齐栏线 |
| `HomeValueProps` | `ValueProps` | 01–03 编号；`rise` 800ms 入场（`animation-timeline: view()` entry 0%→cover 30%） |
| `HomeNearbyRail` | 新增 | 与精选房源同一张卡；图上左标签为直线距离 |
| `HomeNewsList` | `NewsSection` | 5 条标题 + 日期、行高 76、无图 |
| `HorizontalRail` | 新增基元 | scroll-snap x mandatory + `scroll-padding-inline-start:calc((100% - var(--w))/2)`；44×44 悬浮白箭头（82% + blur）；端点隐藏对应箭头；被楼盘/房源/核心商圈三处复用 |

横滑与数字滚动是 client 逻辑，其余保持 Server Component。动效尊重 `prefers-reduced-motion`（禁用时数字直接显示终值、横滑仍可拖动但无 smooth）。

移动稿 375：单列、section padding 72、左右 16、Hero 标题 40/600/1.07、横滑改单列堆叠取前 3。

## 4. 数据层

### 数据带 stats

`getHomepage` 扩展返回 `stats`：

| 数字 | 来源 | 口径 |
|---|---|---|
| 在租房源 | 有效供给总数 | 城市页按城市，根页跨城汇总 |
| 收录楼盘 | 楼盘总数（active） | 同上 |
| 覆盖商圈 | `businessAreas.length`（`getHomepage` 已取） | 同上 |
| 平均响应 | `CitySiteProfiles.avgResponseHours` | 手填运营承诺；根页取默认城市值；空则整格不渲染 |

「不展示空货架」：任何一格为 0 或缺失时该格不渲染，整带少于 2 格时整段不渲染。

### 核心商圈房源

- 锚点：城市 `Locations.centerLatitude/centerLongitude`；缺失时整段不渲染
- 距离：复用 `supply-adapter.ts` 中 `rankRelatedBuildingsByProximity` 的距离计算（抽出公用，不重写 haversine）
- 取最近 5 套有效供给，**排除已出现在精选房源里的 slug**（去重）
- 标题「核心商圈房源」，副标「以{城市}市中心起算 · 最近 N 套在租」；无「重新定位」链接
- 卡片上左标签显示直线距离（如「1.2 km」）

### 缓存

全部并入现有 `getCachedHomepage` 的 `unstable_cache`（同 tags + 300s revalidate），不新增缓存入口。

## 5. 迁移

`CitySiteProfiles` 新增字段：

```ts
{ name: 'avgResponseHours', label: '平均响应时长（小时）', type: 'number', min: 0, max: 72,
  admin: { description: '数据带「平均响应」展示值，运营承诺口径；留空则首页不展示该格' } }
```

- 生成迁移（`push:false`，显式迁移；pre-commit 会拦「改 collection 不带迁移」）
- 重新生成 `payload-types.ts`
- 纯加列、可空、无默认值回填，非破坏性

## 6. 验收

- `pnpm typecheck` + `pnpm test`（pre-push 强制）
- 浏览器实测 375 / 768 / 1440 / 1920 四断点
- 状态走查：正常 / 空（无精选、无商圈卡、无资讯、无 stats）/ 图片失败 / 长楼盘名 / `prefers-reduced-motion`
- 对比度逐条核（≥ 4.5:1）：蓝底按钮白字、图上渐变压暗白字、`--ink-3` 占位符、内页换色后的软底色落点
- 内页抽查 `/listings`、`/entrust`、`/news`：换色后无不可读组合、无版式破裂
- 证据存 `artifacts/verification/OPT-035/`

## 7. 文档回写（实现完成后）

- `docs/SBH设计任务讨论/uploads/sbh-design-tokens.css`：改成与实现一致（144 间距、1180 容器、底色反转、阴影）
- `docs/SBH设计任务讨论/uploads/sbh-design-system.md`：§4 R2（零阴影→有阴影）、§7 布局数值、Hero 一节
- `payload-office-platform/.agent/frontend.md` §视觉：换成新色板与新字体栈

---

## 8. 实施结果（2026-08-20）

分支 `feat/frontend-apple-redesign-c4e5`，13 个任务串行落地。

### 已交付

- **token 层**：`styles.css` §1.1 整块换成锁定稿取值，§1.1b 为内页留兼容别名（`--color-*` → 新 token）。
- **导航页脚**：44px 浅色玻璃 `SiteHeader` / `SiteFooter`；首页首屏未滚动时头部透明压视频。
- **首页九个 section**：`components/frontend/home/` 新建全套组件，`CityHomeView` 退化为编排层，`/` 与 `/[city]` 共用；样式在 `styles/home.css`（`.hm-*`）；旧首页样式三段已删。
- **数据层**：`getHomepage` 扩展 stats 与核心商圈房源；根页取全平台汇总（facade 已锁 `lease` 渠道 + slug 去重）。
- **迁移**：`CitySiteProfiles.avgResponseHours` 纯加列。
- **文档回写**：`.agent/frontend.md` §视觉、`sbh-design-tokens.css`、`sbh-design-system.md`（后两者在未跟踪目录 `docs/SBH设计任务讨论/`）。

### 与本文档原计划的偏差（实施中确认，以代码为准）

| 项 | 计划 | 实际 | 理由 |
|---|---|---|---|
| 字体栈 | 含 `"Geist"` | 去掉 | Geist 需 webfont，本系统不引 webfont |
| 数据带 | 进视口 1100ms 数字滚动 | 服务端真值直出，无滚动 | 任何「从 0 滚到真值」的写法在 SSR 首帧/禁用 JS/整页截图/观察器不触发下都会把真实库存渲染成 0，与「不显示 0」硬约束不可调和 |
| Hero 文案 | `profile.hero` 优先 | 实现层固定设计稿文案 | `profile` 存的是旧营销文案，回退分支永远走不到；首屏是全站品牌陈述而非单城口径。`profile.hero` 仍驱动 `ComingSoonCityView` 与背景媒体 |
| 资讯日期 | 设计稿 `2026-08-14` | `2026.08.14` | 站内 `/news` 与详情已有唯一权威格式，同字段不引第二种分隔符；零引用的 `formatNewsListDate` 已删 |
| 类型卡计数 / 价值点序号 | `--ink-3` | `--ink-2` | ink-3 在白底 3.62:1 不达 AA，且两者都是真实内容 |
| bento 小卡尺寸 | 332×232 / 504×280 | 388×232 / 582×280 | 计划数值按 1024 容器算，容器定为 1180 后按设计稿 markup 的 `flex: 2/1` 得出 |
| 楼盘卡价格行 | 「N 元/㎡/天起」 | 无价格行 | `BuildingSummaryViewModel` 无起价数据，省略优于编造 |

### 验证证据

`artifacts/verification/OPT-035/`（四断点截图、禁用 JS、reduced-motion、图片全失败、内页抽查、两份探针 JSON）。
还原度攻坚详细报告：`.superpowers/sdd/2026-08-20-homepage-apple-redesign/fidelity-report.md`。

要点：四断点无横向溢出；实底文本 20 条对比度最低 4.66；`prefers-reduced-motion` 下动画停用且内容可见；五条路由 200 且零 pageerror。质量闸门 `typecheck` 绿 / `test` 3300 全过 / `lint` 0 error。

### 带出本批次的未决项（下一批次先看这里）

**需产品/运营裁决**

1. **类型卡第 5 张「创意园区」与数据模型错配**：没有对应 `listingType`，因此无封面无计数，在一排照片里是一块纯灰。要么新增 `listingType`，要么改成楼盘 `grade` 入口，要么运营为该类型配封面。
2. **768 断点价值点偏挤**：仍是 3 列、每列正文约 230px。设计稿没有 768 稿，未擅自加断点；若处理，建议 768–1023 改 2 列。

**代码清理（留给页面改版批次顺手做）**

3. `.text-copper` 工具类（`styles.css:3056`）已零 tsx 引用，未删。
4. `--color-canvas-subtle`（`styles.css:1975`）/ `--color-copper-border`（`:6186`）是孤儿变量，靠内联旧色兜底；改版对应内页时一并处理。
5. `LISTING_TYPE_LABEL` 与 `ListingCard` 等 5 处以上同型重复，存量模式，改版时收敛。
6. 内页断点仍是历史散落值（767/1280/640/1024/1199/1023 等，含 `767`/`768`、`1023`/`1024` 并存的漏判），新体系统一用 767/1023，改版某页时整页收敛。

**测试覆盖缺口**

7. `typeSummaries` 的 cover 选取无直接断言。
8. nearby 的 tie-break（`stableSortKey`）分支无用例。

**性能小项**

9. 根页 `getCachedHomepage` 与平台 stats 串行取（皆缓存读，`Promise.all` 可省一跳）。
