# Task Packet：OPT-099 前端优化五项（投影裁切 / 排序文案 / 二级导航收起 / 卡片等高 / 商圈筛选）

> 状态：**已实施，待合并**
> 创建日期：2026-09-16
> 来源：用户 2026-09-16 提出的 5 项前端优化

---

## 1. 一句话

① 修 hover 投影被滚动容器裁切；② 列表页与楼盘详情供给区去掉可见的「排序」文案；③ 点击二级导航跳转后下拉自动收起；④ 修 `.sf-media` 的 16:10 实际未生效导致的卡片不等高；⑤ 房源列表（租赁 + 出售）新增级联的「商圈」筛选维度。

## 2. 调查结论（2026-09-16 实测，非推断）

取证工具：**本地 Playwright 打生产站 `https://shangban.cc`**。
不用 Browser pane —— 它会拦掉站点自己的样式表（实测 `styleSheets[i].cssRules` 抛 `blocked`、`.sf-media` 的 `aspect-ratio` 读成 `auto`、`display` 读成 `inline`），量出来的全是无 CSS 的假数字。判据见 `memory/browser-pane-blocks-remote-stylesheets.md`。

### 2.1 ④ 卡片不等高：根因不是图片高度，是 16:10 从未生效

`/shanghai/listings` 一页 24 张 `.ls-card`，`.sf-media` 声明 `aspect-ratio: 16/10`，实测：

| | 声明 | 实测 |
|---|---|---|
| 媒体盒宽高比 | 1.600 | 1.333 / 1.341 / 1.348 / 1.484 / 1.500 / 1.530 / 1.600 …共 **8 种** |
| 媒体盒高（列宽 324） | 202.5px | 202.5 / 211.8 / 216 / 218.4 / 240.3 / 241.7 / 242.9 / 243 |
| 卡片高 | 应一致 | **329.3 与 356.3 两档** |

每一种实测比例都**正好等于那张图的原始比例**（如 `768x512` → 1.500 → 216px；`1620x1092` → 1.484 → 218.4px）。

**机制**：`.sf-media img { height: 100% }` 的百分比在「由 aspect-ratio 推导出来的高度」上**解析不了**，回落成 `auto`（即图片原始比例）；而带 aspect-ratio 的块盒其自动最小尺寸是**内容尺寸**，于是**比 16:10 更高的图把盒子顶高**，声明的比例形同虚设。比 16:10 更扁的图则顶不高盒子，比例正常保持。

**为什么一直没被发现**：本地夹具封面全是 `768x432`（16:9，比 16:10 扁），永远顶不高盒子 —— 本地实测 24 张卡媒体高全是 190.1px、卡高全是 304.2px，**完全正常**。只有生产的真实图（3:2 / 4:3 居多）才暴露。用户说的「依然存在」即由此而来：OPT-082 统一的是比例的**声明**，那条声明从未生效。

**已在生产页上注入 CSS 验证过修复**：

```
BEFORE: 盒比例 8 种 / 媒体高 8 种 / 卡片高 329.3、356.3
AFTER : 盒比例 1 种(1.600) / 媒体高 1 种(202.5) / 卡片高 1 种(315.8)
```
注入内容即 3.4 的两条；`object-fit: cover`、焦点裁切、`.sf-scrim`（91.1px = 45%）、`.sf-phototag` 均正常。

### 2.2 ① 投影裁切

`.hm-rail__track` 的 `overflow-x: auto` **连带把 `overflow-y` 提升成 `auto`**（实测计算样式 `overflowY: "auto"`），于是它成为裁切盒；而 padding 只有 `4px`（上）/ `12px`（下）。

`--shadow-hover: 0 14px 36px rgba(0,0,0,.12)` + hover 的 `translateY(-2px)` 所需出血：

| 方向 | 需要 | 现有（`.hm-rail__track`） | 现有（`.nearby-strip`） |
|---|---|---|---|
| 上 | blur/2 − offsetY + lift = 18 − 14 + 2 = **6px** | 4px ❌ | 4px ❌ |
| 下 | blur/2 + offsetY − lift = 18 + 14 − 2 = **30px** | 12px ❌（切掉 18px） | 4px ❌ |
| 左右 | blur/2 = **18px** | 48px ✅（1440） | 4px ❌ |

全站持有 `.sf-card` 的裁切型滚动容器**只有这两个**（已逐个核对：`.ls-grid` / `.card-grid` 是普通网格不裁切；`.location-panel__pois` 装的是 tab 不是卡片）。

### 2.3 ③ 二级导航不收起

点「租赁」后实测：URL 已变成 `/shanghai/listings`，而 `.site-nav__menu` 仍是 `visibility: visible / opacity: 1`，且 `.site-nav__group` 的 `:hover` 与 `:focus-within` **同时**仍然命中，`document.activeElement` 就是那个被点的 `.site-nav__sub`。

纯 CSS 展开没有「导航已发生」这个信号可用，必须由组件补一个显式的抑制态。

### 2.4 ⑤ 商圈：查询链路已通，缺的是词表、facet 与筛选行

- `ListingSearchInput.businessArea`、URL 参数 `businessArea`、canonical 回写、`ListingSearchDimension` 的 `businessArea`、`LISTING_CLEARABLE_DIMENSIONS` —— **全部已存在**
- `supply-adapter` 已把它作为 where 下推（`building.businessDistrict.slug in [...]`）
- **关键发现**：`LISTING_SCAN_POPULATE` 里 `buildings.businessDistrict: true` 配合 `locations: { name, slug, type, status }`，**商圈的 name / slug 早已随扫描查出来了**，只是 `rowFromListing` 把它丢成了一个裸 id（`businessDistrictId`）。所以补商圈 facet **零额外查询**
- 缺的：`SearchFacets.businessAreas`、筛选行、以及「切区时清商圈」的级联清除

## 3. 设计裁定（2026-09-16 与用户确认）

| 问题 | 裁定 |
|---|---|
| 商圈筛选形态 | **跟随「位置」级联**：只有选定某个行政区后才出现「商圈」行，只列该区下有房源的商圈并带计数。生产库共 294 个商圈节点，平铺放不下；级联同时与 Locations 的树形结构一致 |
| 商圈覆盖范围 | **只做房源列表**（`/listings` 租赁 + `/sale` 出售）。楼盘列表的域层完全没有 businessArea 维度，要新建解析白名单 / canonical / where 下推 / facet / 域层测试，属新域能力而非接线，不在本项 |
| 「排序」文案 | 列表页与**楼盘详情页供给区一并去掉**——两处用的是同一套 `.ls-toolbar__sort*` 类和同一个标签，只改一处会让同款控件分叉 |
| 去掉文案后的无障碍 | 可见文案没了，**无障碍名称不能一起没**：给房源列表那组排序链接补 `role="group" aria-label="排序"`（楼盘详情页本来就有） |
| 投影裁切覆盖范围 | 首页轨道 + **楼盘详情页「周边楼盘」条带一并修**，同一个成因 |
| 投影的横向出血 | **不改**。`.hm-rail__track` 的横向 padding 同时承担「首卡与容器对齐」职责，且横向裁切对滚动容器本就是正确行为；仅 ≤767px 时首卡左缘差 2px（`--gut` 16 < 18），不值得为它破坏对齐 |
| 二级导航收起机制 | **保留现有纯 CSS 展开**（键盘 Tab 流程依赖它，`SiteNav` 已有注释说明），只叠加一个抑制态。不改写成 state 驱动的下拉 —— 那要重做全部键盘行为 |
| 键盘激活是否收起 | **不收起**。`e.detail === 0`（键盘 Enter）时焦点仍在菜单里，收起来是错的 |

## 4. 做法

### 4.1 ① 投影裁切（`styles/surface.css`、`styles/home.css`、`styles.css`）

| 层 | 改动 |
|---|---|
| `styles/surface.css` | 新增 token `--sf-card-shadow-bleed-block: 6px 30px`，注释写明推导（blur/2 ∓ offsetY ± 2px hover 位移）与约束：**任何持有 `.sf-card` 的裁切型滚动容器必须用它做纵向 padding**。同时在 `.sf-rail` 的注释里点名 `overflow-x: auto` 会连带提升 `overflow-y`，这是裁切的来源 |
| `styles/home.css` `.hm-rail__track` | `padding-block` 改用该 token（4/12 → 6/30）；横向 calc 原样保留 |
| `styles.css` `.nearby-strip` | `padding: var(--sp-1)` 拆成 `padding-block` 用该 token、`padding-inline: var(--sp-1)`（横向同上，保留现状） |

净效果：轨道高度 +20px / 条带 +28px 的底部留白。轨道箭头 `.hm-rail__arrow` 是 `top` 锚定的绝对定位，不受影响（需走查确认）。

### 4.2 ② 去掉「排序」文案

| 层 | 改动 |
|---|---|
| `components/frontend/listing/ResultToolbar.tsx` | 删 `<span className="ls-toolbar__sortlabel">排序</span>`；排序链接包进 `<span role="group" aria-label="排序">` |
| `components/frontend/BuildingSupplyBrowser.tsx` | 删同一行 span；外层 `role="group" aria-label="排序"` 已有，不动 |
| `styles/list.css` | `.ls-toolbar__sortlabel` 变成零消费方，**删掉**（不留死规则） |
| 测试 | 断言两处不再出现可见「排序」文本、且排序控件仍有 `aria-label="排序"` 的可访问名 |

### 4.3 ③ 二级导航跳转后收起

| 层 | 改动 |
|---|---|
| `components/frontend/SiteNav.tsx` | 新增 `const [suppressedGroup, setSuppressedGroup] = useState<string \| null>(null)`。子项 `onClick={(e) => { if (e.detail > 0) setSuppressedGroup(item.href) }}`（`detail > 0` = 指针激活；键盘 Enter 是 0，不抑制）。group 容器加 `data-nav-suppressed={suppressedGroup === item.href ? '' : undefined}`、`onPointerLeave={() => setSuppressedGroup(null)}`、`onFocus`（capture）时也清除 —— 焦点回到该 group 内说明用户在用键盘，必须让菜单可见，否则焦点会落在 `visibility: hidden` 的元素上 |
| `styles.css` | 在现有 `:hover / :focus-within` 展开规则**之后**追加 `.site-nav__group[data-nav-suppressed] .site-nav__menu { opacity: 0; visibility: hidden; }`。特异度同为 (0,2,1)，靠「同特异度、后来者胜」压过 —— 本仓库既有惯例，不用 `!important` |
| 测试 | 单测断言点击子项后 group 带上 `data-nav-suppressed`、`pointerleave` 后清除、键盘激活（detail 0）不置位 |

抽屉侧无需改动：子项 `onClick` 已经 `close()`。

### 4.4 ④ 卡片等高（`styles/surface.css` 一处，全站生效）

```css
.sf-media { position: relative; display: block; overflow: hidden; }   /* 新增 overflow */
.sf-media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; ... }  /* 新增前两条 */
```

绝对定位让 `height` 有确定的解析基准，图片不再能顶高盒子；`overflow: hidden` 兜住任何残留溢出。

**安全性已逐个核对**（全部 `.sf-media` 消费方）：

| 消费方 | 高度来源 | 判定 |
|---|---|---|
| `.ls-card` / `.bd-card` / `.hm-supply-card` / `.article-card` / `.building-card-mini` / `.nearby-strip__card` | `.sf-media--16x10` | ✅ 正是要修的 |
| `.ls-rowcard__media` 桌面 | `width:240px; height:150px` 定高 | ✅ 本就正常，不受影响 |
| `.ls-rowcard__media` ≤767px | `width:132px; aspect-ratio:16/10` | ✅ **中的是同一个 bug，顺带修好** |
| `.hm-type-card__media`（唯一不带比例修饰符的） | `height: 168px` 定高；≤767px 下 `img` 是 `display:none` | ✅ 安全 |

`CardMediaPlaceholder`（缺图占位）不是 `img`，仍走普通流，容器比例由 aspect-ratio 撑住 —— 需走查确认居中未变。

**回归守卫**（实施时调整）：本 bug 能活到今天，唯一原因是**夹具封面全是 16:9**。
落地时没有改 E2E 夹具，改为两条：
  1. `tests/card-equal-height.test.ts` 新增一组 CSS 文本断言，锁住 `img{position:absolute;inset:0}`
     与 `.sf-media{overflow:hidden}` 这两条「缺一即失效」的声明（该文件 2026-09-04 建立时
     只锁了 `.sf-card{height:100%}`，**正是它漏掉媒体盒才让本 bug 存活**）；
  2. 走查脚本在运行时注入 6 种更高的图并与「撤回本次声明」的对照组比对，证据见
     `artifacts/verification/OPT-099/README.md`。
改 E2E 夹具封面会牵动多个既有快照断言，收益不及上面两条，留作独立待办。

### 4.5 ⑤ 商圈筛选（级联）

| 层 | 改动 |
|---|---|
| `domain/public-catalog/listing-scan.ts` | `ListingScanRow` 的 `businessDistrictId: number \| null` 旁**新增** `businessDistrict: DistrictViewModel \| null`（`rowFromListing` 里 `mapDistrict(building.businessDistrict)`，与 `district` 同写法，零额外查询）。`businessDistrictId` 保留 —— `rowToCandidate` 在用。行增重约 40 字节 × ≤1000 行 ≈ 40KB，距 `unstable_cache` 2MB 上限仍有余量，但需在注释里记账 |
| 同上 | `businessArea` 加入 `SCAN_MEMORY_DIMENSIONS`（口径同 `district`）；`toScanInput` 删 `businessArea`；`applyMemoryFilters` 按 `row.businessDistrict.slug` 判交集；`computeFacets` 产出 `businessAreas: Array<DistrictViewModel & { count }>` |
| `domain/public-catalog/supply-adapter.ts` | **不改**（实施时修正）。`buildListingWhere` 同时服务 `scanEffectiveListings` 与遗留的 `findEffectiveListings`，删掉下推会破坏后者。扫描路径拿到的是 `toScanInput(input)`、其中 `businessArea` 已被删掉，下推自然成为 no-op —— 与 `district` 完全同一处置。缓存键收敛的收益不变：改前每个商圈各产生一份扫描，改后同城同频道共用一份 |
| `domain/public-catalog/facade.ts` | `SearchFacets` 加 `businessAreas`（与 `ScanFacets` 同构） |
| `lib/frontend/listing-url.ts` | **先收口**：把 `FilterFormC` 与 `MobileFilterSheet` 里逐行相同的两份 `buildOptionHref` 提升为此处唯一实现，并加 `alsoClear?: readonly string[]` 参数。`.agent/frontend.md` 点名「href 构造」正是本仓库已翻车过的重复点，级联清除要动两份，先合再改 |
| `components/frontend/listing/FilterFormC.tsx` | `FilterRow` 加 `clearsKeys?: readonly string[]`；改选/取消本行时一并删这些键。**「位置」行声明 `clearsKeys: ['businessArea']`** —— 否则切区后会留下「静安 + 陆家嘴商圈」这种恒空组合 |
| `components/frontend/listing/MobileFilterSheet.tsx` | 改用 `listing-url.ts` 的唯一实现，行为随之一致 |
| `lib/frontend/listing-filter-rows.ts` | `buildListingFilterRows` 新增参数 `businessAreaCounts`（剥掉 `businessArea` 维度后的计数）与 `businessAreas`（候选 VM）。新增行 `{ key: 'businessArea', label: '商圈', options }`，插在「位置」之后。**级联闸门：`input.district` 为空时 options 恒为空数组**，由既有的「无候选值的行不渲染」规则整行隐藏。`buildListingFilterDimensions` 的 `businessArea` 维度 `activeText` 维持 `null`（该函数在取数之前运行、拿不到 facet；行未渲染时由编排层补一个只印维度名的 chip，即现状） |
| `components/frontend/city/CityListingsView.tsx` | `facetsOmitting(['businessArea'])` 加入现有并发 fan-out；把计数与候选传给 `buildListingFilterRows`。**并把区域候选那一路改成 `facetsOmitting(['district', 'businessArea'])`** —— 走查发现的缺陷，见 4.6 |

### 4.6 走查中发现并修掉的缺陷：位置行会塌成只剩一个区

第一轮浏览器走查实测：选中商圈后「位置」行**只剩已选的那一个区**，用户再也切不走。

根因：区域候选的计数只剥了 `district`、没剥 `businessArea`。那个商圈只属于当前这个区，
于是其余区的计数全为 0，被「计数为 0 的候选不渲染」规则滤掉。这正是本仓库既有的
「facets 必须算在筛选之前，否则选中一项后其余项自我擦除」在**从属维度**上的翻版 ——
判据是：算「改选浦东会有多少套」时，不能把一个属于长宁的商圈继续套上去。

处置：区域候选改用 `facetsOmitting(['district', 'businessArea'])`。商圈候选那一路**仍然只剥
`businessArea`**（`district` 必须留着，级联正是靠它成立），两者刻意不同。

`LISTING_CLEARABLE_DIMENSIONS` 已含 `businessArea`，不动。移动抽屉行数据驱动，理论零改动。

## 5. 验收

- [x] 单测：`computeFacets` 产出 `businessAreas` 计数；`applyMemoryFilters` 按商圈 slug 过滤；`toScanInput` 剥掉 `businessArea`；`buildListingScanCacheKey` 不再因商圈分裂
- [x] 单测：`buildListingFilterRows` 未选区时商圈行 options 为空、选区后只含该区商圈；「位置」行 href 一并删 `businessArea` 且删 `page`
- [x] 单测：`buildFilterOptionHref` 收口后 `FilterFormC` 与 `MobileFilterSheet` 产出同一 href（同一实现，断言两处调用同一导出）
- [x] 单测：`SiteNav` 抑制态置位/清除/键盘不置位；两处排序控件无可见「排序」文本但有可访问名
- [x] 浏览器（本地 dev，1440 + 375）：`/shanghai/listings` 选「静安」→ 出现商圈行 → 选一个商圈 → 结果收窄、chip 可清除；再切到「黄浦」→ 商圈参数已消失、结果非空
- [x] 浏览器：首页轨道 hover 卡片，投影四周完整不被切；楼盘详情「周边楼盘」同；轨道箭头位置未偏移
- [x] 浏览器：点「找楼盘 → 租赁」（★ headless Playwright 复现不出，改用真实浏览器窗口取证）跳转后下拉立即收起；鼠标移开再移回可重新展开；键盘 Tab 到父项仍展开、Enter 进入后菜单不被强收
- [x] **卡片等高取证走查**（注入 6 种更高的图 + 撤回本次声明的对照组，见证据 README）：E2E 夹具加一张比 16:10 更高的封面后，同一网格内 `.sf-media` 实测高度全等；**并在本项上线后用同一份 Playwright 脚本复测生产站**（本地夹具无法证伪，见 2.1）
- [x] E2E 自查 `tests/e2e/`：导航、列表筛选、工具条相关用例
- [x] `typecheck` / `lint`(0 error) / `test:changed`(155 文件 1891 用例) / `build`；`payload-types.ts` 未入库
- [ ] **上线后用同一份 Playwright 脚本复测生产站**（本地夹具无「比 16:10 更高」的图，④ 的真实收益只有线上看得到）

证据目录：`artifacts/verification/OPT-099/`。

## 6. 不在本项内

楼盘列表的商圈维度（域层需新建）；地铁维度接词表；商圈行改多选交互；`.hm-rail__track` 横向出血；把排序控件整体重做；筛选条 <768px 的触达下限缺口（`.agent/frontend.md` 已记为独立待办）。
