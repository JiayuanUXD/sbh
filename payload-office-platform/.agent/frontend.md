# C 端前台专项规则

适用于 `app/(frontend)`、`components/frontend`、`domain/public-catalog`、公开 SEO/sitemap、缓存与 `/api/inquiries`。配合 `core.md` 与 `testing.md` 读；涉及房源/楼盘/facet/推荐再读 `supply.md`，涉及咨询转 Lead 或脱敏再读 `permissions.md`。

## 架构

- `app/(frontend)` 负责路由、Metadata、页面编排和错误边界。
- `domain/public-catalog` 负责公开查询门面、DTO 和 mapper。
- `domain/supply` 是公开房源资格唯一来源：所有公开消费者（列表、详情、推荐、sitemap、咨询候选）复用同一有效供给服务，禁止用旧 `status=available` 或简化谓词降级。
- 页面和组件只消费 Public Catalog DTO，不接收原始 Payload 文档。
- `components/frontend` 只消费只读 DTO。
- `lib/frontend` 只保存纯解析、格式化和前台工具。
- 路由不拼 Payload `where`，组件不调用 Payload。

## React 与类型

- Server Components 默认；Client Component 只用于筛选抽屉、画廊、咨询弹层和必要交互。
- URL 是筛选、排序、分页与计价单位状态的**唯一**事实来源；不得出现只存在于内存的筛选态。改筛选或改排序的 href **必须 `delete('page')`**（结果集或顺序变了，旧页码要么空要么跳号）。
- 同一份判断逻辑不得存在第二处副本。本仓库已因此翻车四次（href 构造 / 「清除全部」作用域 / 类型标签映射 / 「某行是否显示已选 chip」的判据）。重复出现时先收敛成单一导出再用，别先复制后同步。
- 外部输入 `unknown` + schema/guard；DTO 默认 `Readonly`。
- effect 只用于外部同步，不派生普通渲染数据。
- 列表 key 使用不可变业务 ID。
- 价格必须携带币种、租售类型、周期和单位；不可跨单位聚合或排序。

## 视觉

体系为 OPT-035 锁定的 Apple 中性极简（依据 `docs/SBH设计任务讨论/首页.dc.html`）。事实源是 `(frontend)/styles.css` §1.1 的 token，不发明第二套配色、字体或布局系统。

- 两级底色：`--bg`（#f5f5f7，全局）/ `--bg-subtle`（#ffffff，白底带与卡片）；分区靠底色块交替，不靠分隔线。唯一彩色 `--accent`（#0071e3）只给可交互元素，正文内链接用更深的 `--accent-link`（#0066cc）；标签徽章零色相，靠底色深浅 + 字重分层。
- `--ink-3` 在白底仅 3.62:1，只能做占位符/禁用态；真实信息文本至少 `--ink-2`（5.07:1）。设计稿多处标 ink-3，此处对比度优先于照稿。
- 中文一律 `letter-spacing: normal`，**无例外**；不给汉字套西文负字距。（原先记的唯一例外 `.hm-lead` `+0.011em` 已随该类零使用一并删除，见 OPT-037 终审第 2 轮 D2。）
- 数字（租金/面积/统计/日期）一律 tabular-nums，实现走 `styles/surface.css` 的 `.sf-num` 基元（**不要在各页样式里再内联一遍 `font-variant-numeric`**——详情页曾内联复制 9 次，其中一处静默漏掉）；缺失显示 `—`、**不显示 0**，也不做「从 0 滚到真值」的入场动画——任一降级路径（SSR 首帧、禁用 JS、整页截图、观察器不触发）都会把真实库存渲染成 0。
- 字体只用系统栈 `--font`（SF Pro Text → -apple-system → `--font-cn` PingFang SC），不引 webfont，不用 Inter / system-ui 作主字体。
- 布局：容器 `--w` 1180px、正文栏宽 `--measure` 702px、section padding `--pad` 72px（相邻 section 总留白 `--gap` 144px）；底色带在所有断点满宽出血。
- 容器**不按断点换挡**，是一条流体规则 `width: min(var(--w), 100% - 32px)`——别再给容器加媒体查询。新体系只用两个宽度断点：`max-width: 1023px`（只管类型卡五等分→2 列）与 `max-width: 767px`（移动稿主断点）。重点验证 375、768、1440、1920。
- 未改版内页仍散落历史断点（767/1280/640/1024/1199/1023/480/600/768/900/959），其中 `767` 与 `768`、`1023` 与 `1024` 并存会在正好 768px / 1024px 处漏判；改版某页时把该页一并收敛到 767/1023，不要单点改。
- **卡片 / 图上渐变 / 图上标签 / 图容器一律用 `styles/surface.css` 的共享基元**（`.sf-card` `.sf-scrim` `.sf-phototag` `.sf-media--4x3|--16x10` `.sf-num`），禁止逐页再写一份。依据 `.superpowers/sdd/cross-batch-design-decisions.md`（用户要求全站一致），OPT-036 起生效。
  - `.sf-card`：`--r-card` 18px、零边框、静态 `--shadow` + hover `translateY(-2px)` 换 `--shadow-hover`、过渡 320ms。此条**取代**旧的「零阴影 / 不做 hover 态」，也取代 OPT-035 期间的「上浮 6px / 500ms」。列表页设计稿要求的「零阴影、hover 只变底色」**不采用**——密集网格抖动的顾虑靠把位移降到 2px 解决，不靠两套卡片系统。
  - `surface.css` 必须在 `home.css` / `list.css` **之前** import：后两者靠「同特异度、后来者胜」覆写基态（如 `.hm-type-card` 把 `display:block` 改回 flex），顺序反了静默失效。
  - 唯一豁免 `.sf-card` 的是首页 `.hm-bento-card`（满幅图瓷砖非内容卡：加阴影显脏、抬升破坏 bento 咬合），它仍复用 `.sf-scrim` / `.sf-phototag`。
- 图上有文字必带底部 45% 渐变压暗（`.sf-scrim`，`rgba(0,0,0,.42)` → 透明）——图上白字按此规则核对，不逐张测 4.5:1。
- 房源卡 4:3、楼盘卡 16:10（封面多为横向街景）、详情主图 16:10；图容器要 `display: block` + `aspect-ratio`（`span` 默认 inline 会让 aspect-ratio 失效、高度塌成 0），声明尺寸禁 CLS，有 alt 与失败占位。
- `backdrop-filter` 只写 unprefixed 一条：手写 `-webkit-` 兄弟声明会被 lightningcss 连同 unprefixed 一起丢弃，玻璃效果整体失效（前缀由构建按 browserslist 自动补）。
- 滚动进场用原生 `animation-timeline: view()`，必须 `@supports (animation-timeline: view())` 包裹且**不写 `fill-mode: both`**——时间线未激活时 both 会把元素锁死在 `opacity: .001`，整段内容隐形。
- 动效：常规交互用 token 三档 120/200/320ms（交互反馈 120、状态切换 200、卡片抬升 320），滚动进场 400–800ms；避免自动轮播、阻挡搜索的视频、大面积阴影；一律尊重 `prefers-reduced-motion`。
- 旧 `--color-*` 名（`--color-copper`、`--color-paper` 等）现在只是新 token 的**别名**，只为未改版内页过渡而存在。新代码一律用新名；改版某页时顺手把该页引用换成新名。
  - **例外：`--color-on-ink: #f5f5f7` 不是别名，是字面量。** `--color-canvas`/`--color-surface`/
    `--color-copper`/`--color-ink` 各自 `var()` 指向 1.1 体系的 token，换掉它们是纯粹解引用；
    但 1.1 体系里**根本没有「墨底上的字色」这个 token**（只有 `--on-accent`）。
    把 `--color-on-ink` 也「顺手换掉」只有两条路：写死 `#f5f5f7`（把一个已单点化的取值散回各调用点），
    或新造 `--on-ink`（设计系统层面的动作，不该塞进清理批次）。**保留，别随手换。**

## 列表页（筛选页）

房源列表 / 楼盘列表由 OPT-036 锁定，样式在 `styles/list.css`（`.ls-*` 房源与共用、`.bd-*` 楼盘）。列表页是**筛选页不是浏览页**，密度优先——以下是与首页刻意不同、且不能被「统一一下」改掉的地方：

- 容器 `--ls-w` **1280px**、section padding `--ls-sec` **32px**（首页/详情是 1180 / 72）。理由是布局刚需：结果网格要放 3–4 列，1180 下每列过窄。`.ls-page` 用负外边距抵消 `.site-main` 自带的 `padding`，纵向节奏与左右留白全由本页控制。
- 结果网格的列数断点是**内容驱动的三档** `1199 / 899 / 599`，是「只用 767 / 1023」这条全站规则的显式例外（列数由卡片最小可读宽度决定，不由设备类别决定）。除此之外列表页只用 767。
- **筛选激活态零色相**：实体 pill（`.ls-pill--active`，移动抽屉里的筛选项）用黑底白字 `#1d1d1f` / `#fff`；桌面分行文本条件区的行内选项（`.ls-filterc__opt--active`）用 `--accent-link` + 500 —— 两种语境两套规则，别互抄。**全站唯一允许用 `--accent` 底的筛选项**是楼盘页「仅看有在租」开关的 track（桌面 `.ls-filterc__switch--on`、抽屉 `.ls-msheet__switch--on`），它是「暂无在租降权分组」这条产品判断的正面出口；别照抄给第二个筛选项。
- 排序权重刻意低于筛选：13px 纯文本、无背景无边框、不独占一行高度。筛选改结果集，排序只改顺序。
- **价格定宽盒**：`.ls-price__value--day` 58px（元/㎡/天）、`--month` 88px（元/月 · 元/工位/月，六位数 `316,200` 需更宽），右对齐 + tabular-nums + 两位小数固定 → 同一单位下各卡小数点落在同一相对位置。这是北极星「能横向比价」的具体落点，不是排版洁癖；改宽度前先想清楚谁还在跟它对齐。楼盘卡在租套数用 `min-width: 36px`（不是 `width`：四位数会粘连）。
- **租金单位三种彼此不可换算**（元/月 · 元/㎡/天 · 元/工位/月），因此**单位即结果集**：`?priceUnit=` 切的是结果集不是排序。随之而来的诚实义务是 `ExcludedUnitsBar`——必须说出「另有 N 套按 X 报价，因单位不可换算未计入本结果集」，它不是装饰。
  - ★ 算这些计数时**必须先剥掉 `priceUnit` 维度**（`omitListingSearchDimensions` / `getSearchFacetsIgnoring` / `getCachedSearchFacetsIgnoring`），其余条件全部保留。直接用 `getSearchFacets` 会因为 facetInput 保留了 `priceUnit` 而让其余单位计数恒为 0 → 提示条 `return null` → 整个诚实机制**静默失效且不报错**。同型陷阱：facet 候选**清单**取自全集、**计数**取自剥离后的子集——只用子集当清单，会让用户选中的那一项连同整行从筛选条里消失（选中态只活在地址栏，看不见也单独清不掉）。
- `?view=grid|row` **不进 canonical**（只改渲染不改结果集，两个仅 `view` 不同的 URL 对搜索引擎是同一页），但地址栏保留，分享链接不丢版式。它由路由层单独解析成 prop，`buildCanonicalSearchParams` 完全不认识这个键。
- 视图切换 / 排序项这类控件**不得成为死控件**：无 `priceUnit` 时价格排序会被 `normalizeSort` 降级为 `recommended`，调用方必须把这两项从 `sorts` 里剔除；同理 `view=row` 必须有真实的行版式组件承载。
- 移动筛选是**独立抽屉**不是桌面横条的缩小版。抽屉的 open 状态必须处于稳定树位置（无 `key` 变化、不在会因 `searchParams` 重挂的 Suspense 边界内），否则每选一个条件抽屉就关一次——这条只能在真实路由上端到端验证，静态预览断不出来。列表路由目前**没有 `loading.tsx`**，这是该不变量的间接保障并已写成断言；将来要加 `loading.tsx`，必须重做端到端验证，不能删断言了事。
- 「清除全部 / 重置」的作用域由**编排层算一次、各处共用**（`clearAllHref` / `resetHref` 都是必填 prop）。组件自行按可见行推导必然与真实维度集合分叉（一个维度可能占多个 query 键，如面积的 min+max）。同源陷阱：生效却没有任何一行能显示的条件必须由编排层补 chip，且**补 chip 的覆盖判据要与筛选条本身的判据同源**（用导出的 `findActiveOption` / `rowShowsActivePick`），否则 `?leasableAreaMin=750` 这类偏离预设档位的值会「行内无 chip + 补充 chip 判为已覆盖 + 底栏称未选」三处齐声否认一个正在生效的筛选。
- `prefetch={false}` 的判据（不是无脑全加）：**高基数 + 内容驱动 + 常驻渲染**的链接要加（筛选选项 `FilterFormC` / `FilterPill`）；固定枚举（排序 4 项、视图 2 项、单位 3 项）、有硬上限的窗口（页码 ~7 个节点）、仅空态渲染的退路行不需要。桌面加了移动没加 = 同一缺陷漏了一半，不是「移动端风险较低」。
- 已知缺口（尚未修）：`.ls-filterc` 没有 `<768px` 隐藏规则，整块筛选条在 375 下照常渲染，其中 36 高开关 pill、28 高 chip、行内纯文本选项都低于 44px 触达下限。要修得先决定筛选条在窄屏下的归属，是跨两个列表页的一次性处置。

## 详情页

房源详情 / 楼盘详情由 OPT-037 锁定，样式在 `styles/detail.css`（`.dt-*` 两页共用），组件在
`components/frontend/detail/`（两页共用基元）与 `components/frontend/building-detail/`（楼盘页专属）。
两页共用同一套骨架类（`.dt-page` / `.dt-container` / `.dt-core` / `.dt-section` / `.dt-h2` / `.dt-titlebar`），
差异只在栏内内容。`detail.css` 在 `layout.tsx` 里排在 `styles.css` **之后** import，靠「同特异度、后来者胜」
覆写旧详情页取值（`.location-panel__*` / `.detail-gallery__*` / `.building-card-mini` 全是这个机制），顺序反了静默失效。

### 面板基元 `.dt-panel` 与卡片基元 `.sf-card` 是两回事，不要互相「统一」

- `.dt-panel`：底 `--bg-subtle`（#fff）、圆角 `--r-card`（18）、**零边框零阴影、无 hover**；
  `--full`（通栏面板）padding **40**、`--side`（决策卡 / 信息面板）padding **32**。由 `DetailPanel.tsx` 提供。
- `.sf-card`：静态阴影 + hover `translateY(-2px)` + 阴影加深、320ms。
- 差异是语义性的：`.sf-card` 整张卡是一个链接，hover 反馈是在说「这块能点」；详情页面板只是分组容器，
  套上抬升等于给用户一个假的可点提示。padding 也不同向——列表卡 **14/16**（`list.css`：
  `.ls-card__body` 14px 16px 16px、`.ls-rowcard` 16px；**首页卡才是 18–24**：
  `.hm-type-card__body` 18/20、`.hm-supply-card__body` 20/24）服务浏览密度，详情面板 40/32
  服务「已经决定看这一套、要从容读完」。**合并两头不讨好。**
  （2026-08-22 终审订正：原文写「列表卡 16–20」，把首页卡的数字安到了列表卡头上。
  结论不变——14–16 与 32–40 仍是两倍以上的差距——但引用时别再引那个数。）
- 图上渐变 / 图上标签 / 图容器仍走 `.sf-*` 共享基元。详情主图的压暗**没有**照稿子的 `.46 / 38%`，
  直接复用 `.sf-scrim`（`.42 / 45%`）——差异落在渐变最浅端不可辨，理由写在 `detail.css` 画廊小节。

### 核心区栏宽与容器

- `.dt-page` 上定义 `--dt-w: 1180px` / `--dt-main: 776px` / `--dt-side: 372px`；
  `.dt-core` 是 `grid-template-columns: var(--dt-main) var(--dt-side)`、`column-gap: 32px`、`row-gap: 0`、
  **`align-items: start`**。776 + 32 + 372 = 1180。
- `align-items: start` 不是视觉偏好，是决策卡 sticky 粘附区间的地基（见下）。删它会让两列拉伸到同一行高。
- `.location-panel__grid` 用同一组字面量 `776px 372px` / gap 32（组件写死 class，无法从外部传变量）。
- 纵向节奏：`.dt-page { --dt-sec: 56px }`，`.dt-section` **只给 `padding-top`**——段与段之间恒为一份 56，
  不会出现「上段 margin-bottom + 本段 margin-top」的双份。≤767 降到 40。
  这与首页「`--pad` 72、相邻 section 总留白 144」是两套节奏，不要对齐。
- 塌栅格断点统一 **1023**（`.dt-core` / `.dt-building-spec` / `.dt-related-grid` 同一个），
  几处不一致会出现「核心区已单列、别处还两列」的半塌状态。

### 页面根出血：`.dt-page` 用 `width:100vw; margin-inline: calc(50% - 50vw)`

- 这是**照抄首页 `.hm-home`（`home.css`）的既有做法，不是每页发明一份**；全站 `body { overflow-x: clip }`
  （`styles.css` body 规则内）就是为它配套用来裁掉 100vw 与滚动条宽度之差的。
- 为什么必须出血：吸附条（`.dt-bar`）是全幅块，毛玻璃与底线要横贯视口、与正上方 `.site-header` 对齐；
  而祖先 `.site-main` 带 `max-width: var(--container-max)`（1440）+ `padding: var(--sp-6) var(--container-pad-x)`
  （32 / 24）。不破这层，条被按在 `clientWidth - 48` 上，玻璃断在容器边界。
- 只破左右不够，纵向那份 `--sp-6` 由 `.dt-page { margin-top: calc(var(--sp-6) * -1) }` 抵消，
  否则标题栏自己的 32 会叠成 64。同一手法见列表页 `.ls-page`。

### sticky 交接：三个块，三种定位，各有理由，不要「统一」

| 块 | 定位 | 取值 | 为什么 |
|---|---|---|---|
| 决策卡 `.dt-decision` | `sticky` | `top: calc(var(--header-height) + var(--dt-sticky-bar-h) + 16px)` = 44+56+16 | 粘附区间 = `.dt-core` 第 1 行的 grid area（grid item 的包含块是它的 grid area，不是收缩后的盒子），画廊滚完即自然释放 |
| 吸附询价条 `.dt-sticky-bar`（房源页） | **`fixed`** + `top: var(--header-height)` | 高 `--dt-sticky-bar-h` | 由 `StickyInquiryBar.tsx` 的 IntersectionObserver **整体挂载/卸载**，不是 CSS 显隐。用 sticky 会在挂载瞬间在原位吃掉 56px 高把下方内容顶下去，靠 Chromium scroll anchoring 补偿——正确性不该建在浏览器行为上。它从不展示「未吸附」态，fixed 与 sticky 已吸附态视觉等价 |
| 锚点导航条 `.dt-anchor-bar`（楼盘页） | **字面 `sticky`** + `top: var(--header-height)` | 同上 | 常驻渲染、首帧就占位，没有上面那个问题；照抄 `fixed` 反而会把标题栏顶部遮掉 56px。sticky 还天然获得「滚过才吸附」 |

- `--dt-sticky-bar-h: 56px` 挂 **`:root`** 不挂 `.dt-page`：`.dt-bar` / `.dt-anchor-target` 的使用范围不限于
  `.dt-page` 子树，挂页面根会让子树外静默走字面兜底 = 两个事实源。所有 `, 56px` 兜底已一并删掉，缺失即暴露。
- 锚点落点 `.dt-anchor-target { scroll-margin-top: calc(var(--header-height) + var(--dt-sticky-bar-h) + 12px) }`
  （= 112）。那 12 不是凑数：只补到吸附总高时区块首行贴死在毛玻璃下沿。
  `LocationPanel` 的 `<section>` class 写死、外部加不上该类，所以在 CSS 里与它并列挂同一条规则——
  **不要**在 JS 里再写一份 `44 + 56 + 12`。
- `.dt-sticky-bar` 的隐藏断点是 **≤767** 而不是 ≤1023：`.dt-decision` 在 ≤1023 只是回普通文档流、没有常驻入口顶上，
  而 `.detail__mobile-bar` 自己只在 ≤767 出现，两条各按各的断点收会让 768–1023 出现「滚过决策卡后没有任何询价入口」的空档。
- `.dt-anchor-bar` 在 ≤767 **保留**（只藏楼盘名与 CTA）：移动底栏是询价 CTA 不是导航，回答不了「跳到楼盘参数」。

### `AnchorNavBar` 的两条接线契约（Task 10 唯一会踩的坑）

1. **`items` 由调用方按区块真实渲染与否装配，不得硬编码。** 硬约束是「**结构性空壳**整段不渲染」
   （无坐标不渲染地图区、同商圈无楼盘不渲染该区、参数与特色全空不渲染参数区），硬编码 4 项会在这些页面上
   产出指向不存在元素的死锚点。id 还必须互不相同（既是 React key 也是择一规则主键，开发环境会 `console.error`）。
   ⚠️ **「供给三组全空 → 不渲染供给区」是已撤回的裁定，别照着加守卫。** `#supply` 恒渲染，
   空态由 `BuildingSupplyBrowser` 的「当前暂无公开可选空间」承担，`tests/e2e/detail-pages.spec.ts` 已锁死——
   加守卫 e2e 直接红。**结构性空壳不渲染 ≠ 诚实空态不渲染**：前者是渲染出来一无所获的壳（无坐标的地图容器、
   全是「—」的参数货架），后者是「查过了，答案是没有」这件本身就是信息的事，必须渲染。
2. **sticky 的包含块必须覆盖全部被锚点指向的区块**，且必须是全幅块。包含块比区块集合短，条会在还有区块没读完时脱附。
- 择一规则读的是各区块自己的 `getComputedStyle(el).scrollMarginTop`，**JS 里一个落点字面量都不写**；
  规则只依赖几何不依赖数组顺序。已知残留缺口：到底兜底只救几何最靠下的**一个**区块，页尾连着两个短区块时
  倒数第二个永不高亮（注释里已承认，未修）。

### 规格表 / 概况面板的缺失口径

- `SpecTable`（`.dt-spec`）行 `min-height 44` / `padding 11px 0` / 键 `15/400/--ink-2` / 值 `15/500/--ink` 右对齐 +
  `tabular-nums`；行线 `1px solid --line`，`:last-child` 无线。行 `gap` 统一 **24**（两稿分叉 16/24，
  `space-between` 下不可见，见 `cross-batch-design-decisions.md`）。
- **`value: null` 渲染 `—` 且保留该行，不显示 0，不隐藏整行。** 「这个维度不在数据里」与「这套房源在该维度上没有值」
  是两件事；隐藏会让用户误以为「没提所以是有的」。整组缺失同样渲染全 `—` 行而不是隐藏整组——行级与组级用同一条判断，
  不搞两套规则。这与「空态整段不渲染」不冲突：后者针对**结构性空壳**（渲染出来一无所获，如无坐标的地图容器）。
- 已知边界：`SpecTable` 用 `row.value ?? '—'`，**空字符串会渲染成空白而不是 `—`**，由调用方控数据。
- 概况面板组间距 40、组标签 `.dt-group-title`（`13/600/--ink-3`）——该类由房源概况与楼盘参数两个面板共用。

### 「租金账」tab 已取消（2026-08-21 产品裁定），别当疏漏补回来

原稿在概况处给两个 tab（房源概况 / 租金账）。租金账整块移除，概况**不再套 tab 容器**——只剩一个选项的
tab 是点了没反应的死控件。若将来要恢复，先重新评估这条量纲问题：租金三种单位（元/月 · 元/㎡/天 · 元/工位/月）
与物业费（元/㎡/月）、停车费（元/月/位）量纲不同，**缺面积或车位数时无法通约，合计不可简单相加**。

### `prefetch={false}` 的判据锚点在 `ui/Breadcrumb.tsx`

三条件**并列**：①高基数 ②内容驱动 ③常驻渲染，缺一条就不关。①问的是**这一页渲染出几条互不相同的 URL**，
不是同一批 URL 出现几次——Next 按 URL 去重。精确表述与两个真实误判案例写在 `ui/Breadcrumb.tsx` 文件头，
**其余组件凡理由涉及「去重」的一律回指该处，不要各写一份措辞**（同义表述一多必然漂移）。

## 状态

每页验证正常、加载、空、错误、404/失效、长文本、极值、图片失败、小视口和减少动效。失败不得伪装成 0 数据；无结果不得混入不匹配供给。

- **空态有三种，含义不同，不得共用一套文案或样式**：① 该条件本身无货（类目型，给主/次两个出口）；② 筛选后无结果（逐条退路行，每行给一个可放宽的条件与其命中数，点击**只改一个参数**）；③ 页码越界。
- ★ **③ 页码越界绝不能说「没有结果」**——那一刻其实有货，只是页码超范围（链接过期、手改 URL）。文案只讲页码不存在，然后直接给「最后一页」「第 1 页」两个出口；也不给退路行，页码不是筛选条件没有「放宽」可言。
- 空态的出口不得退化成死控件：主按钮指向的目标必须与当前页不同。①「零筛选却零结果」时 `unfilteredTotal === total === 0` 是结构性恒等，「查看全部结果」会指回用户已经在的这一空页——此时整个主按钮不渲染。
- 接口太窄时**开宽接口，不要降级文案或行为去迁就它**。本批次这条错了三次（在租套数→改显示面积、计数名词→改成通用「条」、次要出口→改成回首页），三次的正解都是加一个必填 prop 或给 SQL 加一列。「可选 prop 带默认值」是通用文案回潮的入口，语境相关的文案一律必填。

## 工程纪律（本仓库反复踩的几类）

- **`aria-pressed` 只在 `role="button"` 下有效**。导航链接（`<Link>`，`role=link`）的当前态用 `aria-current`。禁止用「给它加个 `role="button"` 让属性合法」的捷径：那些确实是导航链接，谎称按钮比缺属性更糟。已有的 `aria-pressed` 都在真 `<button>` 上，合法，别一并清掉。
- **清理死代码一律逐类名 / 逐符号核查，禁止按注释标题整块删**。已两次险些误删：旧筛选条标题下的 `.filter-bar__input/.filter-bar__select` 实际被 `ui/Field.tsx` 复用（全站表单靠它），首页批次的 §11 也混着详情页样式。拿不准就留着并在注释里写明理由。
- **判死一个 CSS 类要两道判据同时成立：grep（含模板串拼接）零命中 + 运行时扫描零命中。缺一不可，两边各有真实反例：**
  - 只信运行时会误删：`.city-switcher__status--live` / `--coming-soon` 运行时扫 20 条路由 × 2 断点 **0 命中**，
    但 `CitySwitcher.tsx` 用模板串 `` `city-switcher__status--${city.serviceStatus}` `` 拼类名，
    取值域由 `domain/city-site-profile/schema.ts` 的 `CITY_SERVICE_STATUSES` 封闭。**是活的。**
  - 只信 grep 也会误删：`detail.css` 的 `.amap-layer` / `.amap-maps` grep **0 命中**，
    因为它们是高德 JS API v2.0 **运行时注入**的 DOM 类名，只有运行时扫描看得见。**也是活的。**
  - 还要防子串陷阱：`.detail__summary` 的「唯一近似命中」是 `page-detail__summary`，两者无关。
    grep 一律带边界，别用裸子串。
- **守卫要落在失效点那一层，且 fixture 必须是域层真能产出的状态**。只锁底层工具函数，编排层改回旧调用照样全绿（提示条静默消失）；fixture 用一个结构上不可能出现的组合（如 `unfilteredTotal=0` 配 `total=99`），守卫证明的是「prop 传了」而不是「传下去的值可用」。新增守卫后做**变异验证**：故意改坏，确认如期变红，再还原。
- 子代理报告的「环境级 / 生产级风险」必须在已知正确的环境上复验后才可采信——它们不掌握本会话的隔离库 / 端口上下文，容易把自身环境错配（连错库、切回默认库）归因成产品缺陷，且措辞会逐轮升级。

## SEO / 缓存 / 分析

- 每页唯一 title、description、canonical、OG；一个 H1。
- **例外：首页 Hero 的 H1/副标全站共用一句**，由产品指定（不等于设计稿 `首页.dc.html` 的文案），既不按城市定制、也不读 `CitySiteProfiles.hero.heading/body`；城市差异全部由 title / description / OG 承担。别把它「修回」逐城可配，也别按设计稿改回去——见 `components/frontend/home/HomeHero.tsx` 顶部说明与 OPT-035 工作项 §8。
- JSON-LD 与页面使用同一 DTO，不虚构库存、评级或价格。
- sitemap 只包含已发布内容和有效供给，域名来自类型化配置。
- 公共供给最长缓存 5 分钟，并由领域事件失效。
- 分析只记录匿名 ID、枚举、上下文和结果；曝光按可见性去重。

## 咨询

- 校验 Content-Type、body、同源/CSRF、schema、长度、枚举和隐私版本。
- 数据库唯一约束保证幂等；生产使用共享限流。
- 定向房源提交前再次 `assertEffectiveListing`。
- 失效目标不建立兴趣关系，可转通用需求。
- 不在响应、日志、监控或分析暴露 PII 与内部 Lead 信息。

