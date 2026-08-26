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
- 中文一律 `letter-spacing: normal`，**唯一例外**是 21px 引导副标 `+0.011em`（`.hm-lead`）；不给汉字套西文负字距。
- 数字（租金/面积/统计/日期）一律 tabular-nums；缺失显示 `—`、**不显示 0**，也不做「从 0 滚到真值」的入场动画——任一降级路径（SSR 首帧、禁用 JS、整页截图、观察器不触发）都会把真实库存渲染成 0。
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

## 列表页（筛选页）

房源列表 / 楼盘列表由 OPT-036 锁定，样式在 `styles/list.css`（`.ls-*` 房源与共用、`.bd-*` 楼盘）。列表页是**筛选页不是浏览页**，密度优先——以下是与首页刻意不同、且不能被「统一一下」改掉的地方：

- 容器 `--ls-w` **1280px**、section padding `--ls-sec` **32px**（首页/详情是 1180 / 72）。理由是布局刚需：结果网格要放 3–4 列，1180 下每列过窄。`.ls-page` 用负外边距抵消 `.site-main` 自带的 `padding`，纵向节奏与左右留白全由本页控制。
- 结果网格的列数断点是**内容驱动的三档** `1199 / 899 / 599`，是「只用 767 / 1023」这条全站规则的显式例外（列数由卡片最小可读宽度决定，不由设备类别决定）。除此之外列表页只用 767。
- **筛选激活态零色相**：实体 pill（`.ls-pill--active`，移动抽屉里的筛选项）用黑底白字 `#1d1d1f` / `#fff`；桌面分行文本条件区的行内选项（`.ls-filterc__opt--active`）用 `--accent-link` + 500 —— 两种语境两套规则，别互抄。**全站唯一允许用 `--accent` 底的筛选项**是楼盘页「仅看有在租」开关的 track（桌面 `.ls-filterc__switch--on`、抽屉 `.ls-msheet__switch--on`），它是「暂无在租降权分组」这条产品判断的正面出口；别照抄给第二个筛选项。
- 排序权重刻意低于筛选：13px 纯文本、无背景无边框、不独占一行高度。筛选改结果集，排序只改顺序。
- **价格定宽盒**：`.ls-price__value--day` 58px（元/㎡/天）、`--month` 88px（元/月 · 元/工位/月，六位数 `316,200` 需更宽），右对齐 + tabular-nums + 两位小数固定 → 同一单位下各卡小数点落在同一相对位置。这是北极星「能横向比价」的具体落点，不是排版洁癖；改宽度前先想清楚谁还在跟它对齐。楼盘卡在租套数用 `min-width: 36px`（不是 `width`：四位数会粘连）。
- **计价单位彼此不可换算**，因此**单位即结果集**：`?priceUnit=` 切的是结果集不是排序。随之而来的诚实义务是 `ExcludedUnitsBar`——必须说出「另有 N 套按 X 报价，因单位不可换算未计入本结果集」，它不是装饰。
  - ★ `PriceDisplayUnit` 是 **12 个取值**（周期 4 × 计价基础 3，含出售侧的 `rmb-total` / `rmb-sqm-total` 等），不是租赁那三个（元/月 · 元/㎡/天 · 元/工位/月）。那三个是**过渡期旧列 `listings.rentUnit` 的枚举**，与对外的 `priceUnit` 同名不同集。凡是按单位做判断的地方（筛选、精筛、排序前收束）都必须覆盖 12 个取值，并且判 `resolveListingPrice` 归一后的 `PriceViewModel.displayUnit`，**绝不判 `rentUnit` 列**——该列 `condition: () => false` 且带 `defaultValue: 'rmb-sqm-day'`，与结构化 `price.*` 长期不同步。这条已经出过三次同型缺陷（单位下推、区间下推、`filterByRentUnit` 的 3 值映射表），一律表现为静默漏筛或整页清空。
  - ★ 算这些计数时**必须先剥掉 `priceUnit` 维度**（`omitListingSearchDimensions` / `getSearchFacetsIgnoring` / `getCachedSearchFacetsIgnoring`），其余条件全部保留。直接用 `getSearchFacets` 会因为 facetInput 保留了 `priceUnit` 而让其余单位计数恒为 0 → 提示条 `return null` → 整个诚实机制**静默失效且不报错**。同型陷阱：facet 候选**清单**取自全集、**计数**取自剥离后的子集——只用子集当清单，会让用户选中的那一项连同整行从筛选条里消失（选中态只活在地址栏，看不见也单独清不掉）。
- `?view=grid|row` **不进 canonical**（只改渲染不改结果集，两个仅 `view` 不同的 URL 对搜索引擎是同一页），但地址栏保留，分享链接不丢版式。它由路由层单独解析成 prop，`buildCanonicalSearchParams` 完全不认识这个键。
- 视图切换 / 排序项这类控件**不得成为死控件**：无 `priceUnit` 时价格排序会被 `normalizeSort` 降级为 `recommended`，调用方必须把这两项从 `sorts` 里剔除；同理 `view=row` 必须有真实的行版式组件承载。
- 移动筛选是**独立抽屉**不是桌面横条的缩小版。抽屉的 open 状态必须处于稳定树位置（无 `key` 变化、不在会因 `searchParams` 重挂的 Suspense 边界内），否则每选一个条件抽屉就关一次——这条只能在真实路由上端到端验证，静态预览断不出来。列表路由目前**没有 `loading.tsx`**，这是该不变量的间接保障并已写成断言；将来要加 `loading.tsx`，必须重做端到端验证，不能删断言了事。
- 「清除全部 / 重置」的作用域由**编排层算一次、各处共用**（`clearAllHref` / `resetHref` 都是必填 prop）。组件自行按可见行推导必然与真实维度集合分叉（一个维度可能占多个 query 键，如面积的 min+max）。同源陷阱：生效却没有任何一行能显示的条件必须由编排层补 chip，且**补 chip 的覆盖判据要与筛选条本身的判据同源**（用导出的 `findActiveOption` / `rowShowsActivePick`），否则 `?leasableAreaMin=750` 这类偏离预设档位的值会「行内无 chip + 补充 chip 判为已覆盖 + 底栏称未选」三处齐声否认一个正在生效的筛选。
- `prefetch={false}` 的判据（不是无脑全加）：**高基数 + 内容驱动 + 常驻渲染**的链接要加（筛选选项 `FilterFormC` / `FilterPill`）；固定枚举（排序 4 项、视图 2 项、单位 3 项）、有硬上限的窗口（页码 ~7 个节点）、仅空态渲染的退路行不需要。桌面加了移动没加 = 同一缺陷漏了一半，不是「移动端风险较低」。
- 已知缺口（尚未修）：`.ls-filterc` 没有 `<768px` 隐藏规则，整块筛选条在 375 下照常渲染，其中 36 高开关 pill、28 高 chip、行内纯文本选项都低于 44px 触达下限。要修得先决定筛选条在窄屏下的归属，是跨两个列表页的一次性处置。

## 状态

每页验证正常、加载、空、错误、404/失效、长文本、极值、图片失败、小视口和减少动效。失败不得伪装成 0 数据；无结果不得混入不匹配供给。

- **空态有三种，含义不同，不得共用一套文案或样式**：① 该条件本身无货（类目型，给主/次两个出口）；② 筛选后无结果（逐条退路行，每行给一个可放宽的条件与其命中数，点击**只改一个参数**）；③ 页码越界。
- ★ **③ 页码越界绝不能说「没有结果」**——那一刻其实有货，只是页码超范围（链接过期、手改 URL）。文案只讲页码不存在，然后直接给「最后一页」「第 1 页」两个出口；也不给退路行，页码不是筛选条件没有「放宽」可言。
- 空态的出口不得退化成死控件：主按钮指向的目标必须与当前页不同。①「零筛选却零结果」时 `unfilteredTotal === total === 0` 是结构性恒等，「查看全部结果」会指回用户已经在的这一空页——此时整个主按钮不渲染。
- 接口太窄时**开宽接口，不要降级文案或行为去迁就它**。本批次这条错了三次（在租套数→改显示面积、计数名词→改成通用「条」、次要出口→改成回首页），三次的正解都是加一个必填 prop 或给 SQL 加一列。「可选 prop 带默认值」是通用文案回潮的入口，语境相关的文案一律必填。

## 工程纪律（本仓库反复踩的几类）

- **`aria-pressed` 只在 `role="button"` 下有效**。导航链接（`<Link>`，`role=link`）的当前态用 `aria-current`。禁止用「给它加个 `role="button"` 让属性合法」的捷径：那些确实是导航链接，谎称按钮比缺属性更糟。已有的 `aria-pressed` 都在真 `<button>` 上，合法，别一并清掉。
- **清理死代码一律逐类名 / 逐符号核查，禁止按注释标题整块删**。已两次险些误删：旧筛选条标题下的 `.filter-bar__input/.filter-bar__select` 实际被 `ui/Field.tsx` 复用（全站表单靠它），首页批次的 §11 也混着详情页样式。拿不准就留着并在注释里写明理由。
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

