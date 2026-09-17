# Task Packet：OPT-102 楼盘库编辑页收成两个 tab（基础信息 / 展示内容）

> 状态：**已实施，待合并**（分支 `refactor/opt-102-buildings-form-two-tabs-d94f`，证据 `artifacts/verification/OPT-102/`）
> 创建日期：2026-09-17
> 来源：用户「后台，楼盘库的编辑页面，参考房源编辑页，将多个 tab 合并成 2 个，一个是基础信息，
> 一个是展示内容，包括内部表单的布局」。

---

## 1. 一句话

楼盘编辑表单从 5 个 tab（基本信息 / 位置交通 / 楼宇属性 / 媒体与配套 / 介绍与 SEO）收成
「基础信息」+「展示内容」两个，前三个降级为分节标题；row 按语义重排并给固定列轴；
group 去框与组外同轴——全部照房源编辑页（OPT-032 §3.3-A）的口径与同一套组件 / 样式。
**零 schema 影响**：71 个数据字段（路径 / 类型 / required / unique / options / 默认值）新旧逐字相同。

## 2. tab 映射

| 旧 tab | 新位置 |
|---|---|
| 基本信息 | 「基础信息」§基本信息（3 列：`[楼盘名称, URL 标识, 发布状态]` `[启停状态, 物业类型, 楼宇等级]` `[认证状态, 注册能力, 推荐排序]`） |
| 位置交通 | 「基础信息」§位置交通（级联控制器整行；`[地址, 最近地铁, 纬度, 经度]` 4 列；`district` / `businessDistrict` 两个隐藏字段不再包在 row 里） |
| 楼宇属性 | 「基础信息」§楼宇属性（`[竣工时间, 总楼层, 物业公司, 物业费]` `[停车位, 在售单价]`；三个 group 内各 4 列；楼盘认证 array 原样） |
| —（原散在楼宇属性末尾） | 「基础信息」§核验与版本（核验信息 group 4 列 + 版本号只读展示态 `ListingReadonlyValue`） |
| —（原在基本信息末尾） | 「基础信息」§数据来源（标题与 group **共用** `hasDataSourceData` 条件，手工建的楼盘两者一起不渲染） |
| 媒体与配套 | 「展示内容」§媒体与配套（封面 / 图集隐藏字段、媒体资源工作台、配套芯片选择器） |
| 介绍与 SEO | 「展示内容」§介绍与 SEO（摘要、详细介绍富文本、SEO group 内 `[标题, 描述]` 各 100%） |

与房源页刻意不同的一处：**URL 标识仍是可编辑字段**。房源的 slug 由 `listing-protect` 的
`ensureUniqueSlug` 服务端生成，才能收进标题框的图标；楼盘没有这条钩子，slug 是运营手填的必填项。

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `src/collections/Buildings.ts` | 5 tab → 2 tab；`COL_3 / COL_4 / COL_FULL` + `sectionHeading()` 工厂（复用 `ListingFormSectionHeading`，可带 `condition`）；row 重排、全部 row 子字段给 `admin.width`；`version` 走 `ListingReadonlyValue` |
| `src/domain/supply-import/data-source-field.ts` | 导出 `hasDataSourceData()`，group 与楼盘的分节标题共用 |
| `src/app/(payload)/custom.scss` | `.collection-edit--listings` 那块固定列轴 / 去组框 / 复选框规则的作用域扩到 `.collection-edit--buildings`（同一块规则，不另抄） |
| `src/components/admin/ListingFormSectionHeading.tsx` / `ListingReadonlyValue.tsx` | 文件头注明楼盘也在用（不改名：要动 importMap 与两处守卫） |
| `tests/building-form-layout.test.ts`（新） | 两 tab / 分节标题顺序 / 重组件只在展示内容 / 无 collapsible / 版本号只读展示态 / 隐藏字段不在 row / row 子字段全有 width / 列宽只有三档 / 基本信息 3 列其余 4 列 |
| `scripts/verification/opt102-buildings-form-shots.ts` | 一次性取证脚本 |

**没有迁移。** tab / row / ui / `admin.*` 都不进 schema。证据：一次性脚本把 `origin/master` 与本分支的
`Buildings.fields` 展平比对（路径 + type + required / unique / hidden / relationTo / hasMany / options /
maxRows / min / max / maxLength / defaultValue），71 = 71，两边差集均为空（`SCHEMA_FIELDS_IDENTICAL`）。
pre-commit 的迁移闸门按路径判（暂存 `collections/` 就拦），提交需 `SKIP_MIGRATION_CHECK=1`——
逃生舱使用前已向用户说明并取得确认。

## 4. 走查里踩到的坑（写进 `.agent/backend.md`）

Payload 的 `RenderFields` 外面套着 `RenderIfInViewport`：**没滚进视口的字段不渲染**，group 的
`.render-fields` 在折下时是空的。DOM 探针没滚动就会把懒加载误判成「组内字段没渲染」——本次先用旧配置
做对照才发现是视口问题（旧配置里最靠下的「核验信息」同样是空的，房源页亦然）。取证前必须整页滚一遍。

## 5. 验收

- [x] `typecheck` 干净 / `lint` 0 错误 / 新守卫 + 房源守卫 + 供给导入 / 访问 / 删除 / 缓存钩子测试全绿
- [x] 新旧字段集合逐字相同（§3）
- [x] 浏览器 `/admin/collections/buildings/1` @1440 / 375（e2e-adm 夹具）：根节点带 `collection-edit--buildings`；tab = `[基础信息, 展示内容]`；分节标题顺序如 §2；基本信息 row 子项 `flex-basis: calc(33.333% - 16px)`、其余 `calc(25% - 16px)`、SEO 子项 `calc(100% - 16px)`；四个 group `border 0 / margin-left 0`、组内 row 与组外同轴；版本号渲染为 `.listing-readonly`
- [x] 展示内容 tab：媒体工作台、配套芯片选择器、富文本（1 个 contenteditable）、SEO group 均在
- [x] 数据来源：手工楼盘（无来源）标题与 group 一起不渲染；临时 PATCH 写入 `source=manual-import` 后标题 + 4 列 row 出现，随后已还原为 null
- [x] 保存三步铁证：改「推荐排序」0→1 → `PATCH /api/buildings/1` **200**（请求体含 name / slug / city / seo 等全量字段）→ toast「更新成功」→ 强刷回显 1、API 回 1、version 59→60；随后改回 0（version 61）
- [ ] CI 三项（PR 后）
- [ ] 线上走查（合并部署后）

证据：`artifacts/verification/OPT-102/`（4 张整页 PNG + `probe.json`）。

## 6. 不在本项内

- 楼盘 slug 收进标题框图标（需先给楼盘加服务端 slug 生成钩子）
- 楼盘认证 array 的行内布局（Payload 原生 array 行，与房源媒体工作台不是一类）
- 「有效房源聚合」卡片与启停按钮（本次未动）
