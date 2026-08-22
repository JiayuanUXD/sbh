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
- URL 是筛选、排序和分页状态的事实来源。
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
- 卡片：`--r-card` 18px、零边框、静态微阴影 `--shadow` + hover 上浮 6px 换 `--shadow-hover`。此条**取代**旧的「零阴影 / 卡片不做 hover 态」规则。
- 图上有文字必带底部 45% 渐变压暗（`rgba(0,0,0,.42)` → 透明）——图上白字按此规则核对，不逐张测 4.5:1。
- 房源卡 4:3、详情主图 16:10；图容器要 `display: block` + `aspect-ratio`（`span` 默认 inline 会让 aspect-ratio 失效、高度塌成 0），声明尺寸禁 CLS，有 alt 与失败占位。
- `backdrop-filter` 只写 unprefixed 一条：手写 `-webkit-` 兄弟声明会被 lightningcss 连同 unprefixed 一起丢弃，玻璃效果整体失效（前缀由构建按 browserslist 自动补）。
- 滚动进场用原生 `animation-timeline: view()`，必须 `@supports (animation-timeline: view())` 包裹且**不写 `fill-mode: both`**——时间线未激活时 both 会把元素锁死在 `opacity: .001`，整段内容隐形。
- 动效：常规交互用 token 三档 120/200/320ms，卡片过渡 500ms、滚动进场 400–800ms；避免自动轮播、阻挡搜索的视频、大面积阴影；一律尊重 `prefers-reduced-motion`。
- 旧 `--color-*` 名（`--color-copper`、`--color-paper` 等）现在只是新 token 的**别名**，只为未改版内页过渡而存在。新代码一律用新名；改版某页时顺手把该页引用换成新名。

## 状态

每页验证正常、加载、空、错误、404/失效、长文本、极值、图片失败、小视口和减少动效。失败不得伪装成 0 数据；无结果不得混入不匹配供给。

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

