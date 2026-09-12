# Task Packet：OPT-095 详情页三处展示修正（楼盘封面 / 客服文案 / 供给表缩略图）

> 状态：**已实施，待合并**
> 创建日期：2026-09-12
> 来源：用户一次提出 5 项需求，本项收其中三项无迁移、纯展示的改动先发；另两项（建筑形态字段、导航二级菜单）见 OPT-096

---

## 1. 一句话

修三处 C 端展示：① 房源详情「所在楼盘」卡片恒显示占位图（根因是 OPT-047 卡片瘦身漏到了详情 DTO）；② 顶栏客服电话号码前加「客服」；③ 楼盘详情桌面供给密度表「房源」列加缩略图。

## 2. 设计裁定（2026-09-12 与用户确认）

| 问题 | 裁定 |
|---|---|
| 「所在楼盘图片缺失」是数据问题还是代码问题 | **代码问题**。线上抽查 3 套房源（`pu-fa-yin-hang-da-sha-2` 等），楼盘 164 `coverImage=18156` 非空、楼盘详情页画廊正常，但房源详情 `.building-summary-card__media` 渲染 `data-media-state="missing"` 占位。`mapListingCard` 为 2MB 缓存红线剔掉了 `building.coverImage / summary / airConditioning / network / parkingFee`（OPT-047，`288e8de`），`mapListingDetail` 以 `...card` 继承了这个收窄后的 `building` |
| 修在哪一层 | `mapListingDetail` 用**未收窄**的 `mapBuildingSummary(listing.building)` 覆盖 `building`。详情不进全量卡片数组缓存，不受 OPT-047 约束；卡片链路的收窄原样保留 |
| 顺带修复 | 详情「房源概况」参数表的空调 / 网络 / 停车费三行（`detail-spec/listing-rows.ts` 读 `ctx.building.*`）同一根因，同一修法自然恢复；不另起改动 |
| 客服文案形态 | 桌面顶栏 `header` 形态：「客服 021 6888 8888」（≥1024 才显示号码段，移动顶栏仍只图标）；抽屉行已是「客服电话 …」不动；`aria-label` 不变 |
| 缩略图只加桌面表 | 移动端已是 `ListingCard variant="building-supply"` 带图卡片（被 `tests/e2e/detail-pages.spec.ts` 锁定），只补桌面密度表 |
| 缩略图取图口径 | `ListingCardViewModel.coverImage`（房源封面 → 楼盘封面兜底，域层既有口径）；两者都缺时用共享 `CardMediaPlaceholder`，不让「房源」列在有图 / 无图行之间跳版式 |

## 3. 做法

| 层 | 改动 |
|---|---|
| `src/domain/public-catalog/mappers.ts` `mapListingDetail` | 返回对象里 `building: mapBuildingSummary(listing.building) ?? card.building`（后者恒不会命中——`mapListingCard` 已保证 building 可映射，写兜底只为类型收口） |
| `tests/`（新增或就近） | 单测：喂一份 building 带 `coverImage` / `summary` / `buildingServices` 的 listing 文档，断言 `mapListingDetail(...).building.coverImage?.src` 非空、`airConditioning` 非空；同时断言 `mapListingCard(...).building.coverImage` 仍为 undefined（OPT-047 不回退） |
| `src/components/frontend/ServicePhoneLink.tsx` | `header` 形态 `<span className="service-phone__number">` 前加 `<span className="service-phone__prefix">客服</span>`，与号码同受 ≥1024 显示控制 |
| `src/app/(frontend)/styles/member.css` | `.service-phone__prefix` 与 `__number` 同一显隐规则；`white-space: nowrap` 已有 |
| `src/components/frontend/BuildingSupplyBrowser.tsx` 桌面表 | 「房源」单元格改为 `缩略图 + (标题 / 副行)` 的横向布局；缩略图 56×42、`object-fit: cover`、`loading="lazy"`、`cardCoverProps(cover, '56px', 320)`（最小派生档就是 320w）；无图 `CardMediaPlaceholder compact` |
| `src/app/(frontend)/styles.css` `.building-supply-browser__table*` | 新增 `__cell`（flex）/ `__thumb` / `__text` 样式，`__primary` 加 `overflow-wrap:anywhere`；`colgroup` 不动，行高由 tr 的 56 兜底（实测 69） |
| 现有测试 | `tests/` 下引用供给表结构的断言（若有按 `td` 首个子元素取标题的）随之更新 |

## 4. 验收

- [x] 单测：`mapListingDetail` 的 building 带封面与楼宇服务字段（`frontend-mappers.test.ts`）；`mapListingCard` 收窄不回退（既有 `listing-card-payload-size.test.ts` 回归）
- [x] 本地浏览器（`next dev -p 3727`，本地库 88/88 迁移已执行）：
  - 房源详情「所在楼盘」卡片出现楼盘封面 `<img>`；「房源概况」出现空调 / 网络 / 停车费行（对照楼盘详情页「楼宇服务」同值）
  - 1440 顶栏显示「客服 021 6888 8888」一行不折；375 只图标；抽屉行文案不变
  - 楼盘详情 1440 供给表每行「房源」列左侧缩略图；无封面行显示占位；移动端卡片视图不变
- [x] `typecheck` 干净 / `lint` 0 error（+1 warning，与同目录手写 `<img>` 同类，见走查记录）/ `test:changed` 158 files 全绿
- [x] E2E 自查：`rg` `tests/e2e/` 里与 `building-supply-browser__table`、`service-phone`、`building-summary-card` 相关的选择器，确认没有被结构改动打破

证据：`artifacts/verification/OPT-095/`。

## 5. 不在本项内

建筑形态字段、导航二级菜单、楼盘出售口径（OPT-096）；`mapListingCard` 收窄策略本身；供给表移动端卡片样式。
