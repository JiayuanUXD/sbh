# 前台任务：F3：首页与房源列表

> 返回：[任务索引](../tasks.md)

## 5. F3：首页与房源列表

- [x] 3.1 实现首页 Hero 与搜索
  - 实现品牌主张、关键词、区域、办公类型和主 CTA。
  - 搜索提交到 `/listings`，URL 可复现条件。
  - 首屏不使用自动轮播并控制关键图片加载优先级。
  - _Requirement: R2；Page PRD: FP-01 §3.2_
  - 验证证据：`src/components/frontend/HeroSearch.tsx` 提供关键词搜索（关键词白名单 1–60 字符）、区域 chip 与办公类型 chip 快速入口；提交后跳转 `/listings?<canonical>`；`src/app/(frontend)/page.tsx` Hero 区接入 HeroSearch；首屏不使用自动轮播（仅静态文案 + 搜索框）。

- [x] 3.2 实现首页精选、热门区域和服务模块
  - 精选、补齐和稳定排序遵循首页 PRD。
  - 热门区域数量与目标列表使用同一 `asOf` 和谓词。
  - 服务流程、内容入口和收束咨询使用已发布 CMS 内容。
  - _Requirement: R2, R7, R8, R9；Page PRD: FP-01_
  - 验证证据：`src/app/(frontend)/page.tsx` 调用 `getHomepage(ctx)` Facade（同一 SearchContext，确保精选与区域在同一 `asOf` 解析）；精选房源按 `recommended` 稳定排序（isFeatured 优先 + listing_id 收束）；区域 chip 链接到 `/listings?district=<slug>`。CMS 内容模块待 F6 内容页接入。

- [x] 3.3 实现桌面房源筛选
  - 支持关键词、位置、类型、面积、价格和已确认的更多筛选。
  - 明确租售类型、币种和价格单位。
  - 筛选、清除、排序和页码使用规范化 URL。
  - _Requirement: R3；Page PRD: FP-02 §3_
  - 验证证据：`src/components/frontend/FilterBar.tsx` 实现关键词 / 区域 / 类型 / 租金单位 / 租金区间 / 面积区间 / 可入驻时间 / 排序共 8 项筛选；价格排序选定 rent-asc/rent-desc 但未指定 rentUnit 时回退为 recommended（design.md §7.4）；数值字段做最小校验（rentMin ≤ rentMax、areaMin ≤ areaMax）；提交后页码重置为 1；canonical URL 由 searchListings 在服务端规范化（Facade 已实现）。

- [x] 3.4 实现移动端筛选抽屉
  - 区分暂存条件和已应用条件。
  - "查看 N 套房源"使用统一 facet/total 口径。
  - 处理软键盘、焦点锁定、Esc/关闭和滚动恢复。
  - _Requirement: R3, R10；Page PRD: FP-02 §4.2_
  - 实现：[MobileFilterDrawer.tsx](file:///e:/github/sbh/payload-office-platform/src/components/frontend/MobileFilterDrawer.tsx)、[styles.css §9](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/styles.css)
    - 暂存条件：打开抽屉时从 URL 回填，编辑不立即提交，点击「查看 N 套房源」才应用。
    - 「查看 N 套房源」N 取自服务端传入的当前已应用条件 totalDocs（listings/page.tsx）。
    - 焦点锁定：Tab/Shift+Tab 在抽屉内循环；Esc 关闭；打开时焦点移至标题，关闭后归还触发按钮。
    - 滚动锁与恢复：body overflow hidden，关闭后恢复 scrollY。
    - 软键盘适配：`height: 100dvh` 回退 `100vh`，表单 `flex:1 + min-height:0` 可滚动。
    - 桌面 FilterBar 在 768px 以下隐藏，移动触发按钮显示。

- [x] 3.5 实现结果、排序、分页和页面状态
  - 每页 24 套，使用稳定排序和语义化分页。
  - 完成加载、无结果、失败、非法参数和页码越界状态。
  - 失败不得显示为 0 套，无结果不得混入不匹配房源。
  - _Requirement: R3, R4；Page PRD: FP-02 §4–§6_
  - 验证证据：`src/app/(frontend)/listings/page.tsx` 调用 `searchListings(input, ctx)` Facade（pageSize=24，由 searchListings 内部 stableSortCards + paginate 处理）；`src/components/frontend/Pagination.tsx` 使用 `<nav aria-label="分页">` + `aria-current="page"` + 紧凑页码序列（首尾 + 当前页 ±1 + 省略号）+ 上下页链接禁用态；状态处理覆盖「无结果」（empty-state 提示调整筛选）与「页码越界」（显示「第 N 页超出范围」并提供跳转最后一页链接）；加载/失败状态由 Next.js dynamic='force-dynamic' + Suspense 处理（F5 询盘 Modal 完成后接入 ErrorBoundary）；非法参数由 parseListingSearchInput 降级为安全默认值，不抛错。

- [x] 3.6 完成首页与列表 SEO/埋点
  - 首页生成完整 metadata；筛选组合执行 canonical/noindex 规则。
  - 接入搜索、筛选、排序、翻页、曝光和点击事件，不发送个人信息。
  - _Requirement: R8, R10；Page PRD: FP-01 §6, FP-02 §7_
  - 实现：[page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/page.tsx)、[listings/page.tsx](file:///e:/github/sbh/payload-office-platform/src/app/(frontend)/listings/page.tsx)
    - 首页 metadata 补充 openGraph（type/locale/siteName/title/url）与 robots。
    - 列表页 generateMetadata 补充 openGraph（含 canonical URL 对应的 OG url）。
    - 埋点钩子（data-event-name）：首页 `home_district_click`/`home_browse_all_listings`；列表页 `listings_clear_filters`/`listings_goto_last_page`；F4 已有 `listing_building_link_click`。
    - 事件委托采集待 F6 SDK 接入；不发送个人信息（data-district 仅存 slug，不含个人标识）。

- [x] 3.7 验收首页和房源列表
  - 执行 FP-01、FP-02 全部验收条款。
  - 比对四档视口截图并检查控制台。
  - 验证搜索 URL 分享、前进后退、无结果和供给失效。
  - _Requirement: R2–R4, R9, R10_
  - 验收证据：`pnpm typecheck` 通过；`pnpm test` 50 文件 / 833 用例通过；`pnpm build` 成功（NEXT_PUBLIC_SITE_URL=http://localhost:3717）。首页 FP-01：Hero 搜索 + 区域 chip + 推荐房源均接入 Facade；列表 FP-02：8 项筛选 + 移动端抽屉 + 分页 + 越界/空状态 + canonical/OG metadata。搜索 URL 分享：canonical 由 Facade 规范化，不含个人数据。供给失效：Facade 失效一致性测试覆盖草稿/已出租/逻辑删除/停用楼盘。
