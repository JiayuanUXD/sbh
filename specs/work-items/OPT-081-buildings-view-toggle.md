# Task Packet：OPT-081 楼盘列表页卡片样式切换

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：用户要求「楼盘列表页增加一个卡片样式切换功能，参考房源列表页」

---

## 1. 一句话

楼盘列表页（`/buildings`、`/[city]/buildings`）加上房源页那套 `?view=grid|row` 卡片样式
切换：网格 4 列卡 ↔ 整宽横排行。**版式只作用于「当前有在租」组**，「暂无在租」的紧凑行
恒定不变。

## 2. 这一页原先「刻意不做」视图切换——为什么现在可以做

`CityBuildingsView.tsx` 顶部曾把「没有视图切换」写成一条裁定，理由是：横向紧凑行
（`BuildingCompactRow`）已经被用作「暂无在租」组的降权表达，**高度反差就是降权本身**；
再给用户一个把有在租组也切成横向行的开关，两组的反差就会消失、分组语义随之失效。

那条理由的前提是「切成横向行 = 让有在租组也去用那个紧凑行」。本项不走这条路：

- row 版式下有在租组渲染的是**新组件** `BuildingResultRow`——182 高的整宽横排卡，
  与房源页 `.ls-rowcard` 同一套度量；
- 「暂无在租」组**恒定不受 `view` 影响**，仍是两列紧凑行。

1440 实测（本地夹具）：

| 版式 | 有在租 | 暂无在租 |
| --- | --- | --- |
| grid | 340 高 · 四列 | 72 高 · 两列（664 宽） |
| row | 182 高 · 整宽 1344 | 72 高 · 两列（664 宽） |

反差从 4.7× 收窄到 2.5×，**没有消失**，且 row 版式多出「整宽 vs 半宽」这条 grid 没有的
区分；两组之间本就还有 48px 外边距 + 1px 分隔线 + 分组标题。旧决定要防的是「两组长得
一样」，这条没有发生。

**顺带更正一处长期错误的注释**：仓库多处把这个反差写成「182 : 64」，那是 OPT-036 按设计
稿标称值写的，与实际渲染对不上（`.bd-card` 没有任何 height 约束，实际由内容撑到 340；
`.bd-row` 是 `min-height: 64`，实际 72）。新写的注释一律用实测值。

## 3. 右侧数值列放什么

房源页横排行的产品意图是「价格全部落在最右同一列，纵向扫读比价」。楼盘没有报价（报价
属于楼内各房源），这一页可比的数是**在租套数**，因此 `.bd-rowcard__statcol`（定宽 176、
右对齐、左侧 1px 分隔线）放「N 套在租」26/600 + 「合计 xxx ㎡」。字段与网格卡完全相同，
只是排布不同——与 `ListingResultRow` / `ListingResultCard` 的既有分工一致。

## 4. 移动端：两种版式收敛为同一套竖排卡

`.ls-toolbar__viewseg { display: none }`（≤767）是**全局类选择器**，楼盘页用的是同一个
`ResultToolbar`，因此移动端两页都没有切换控件。房源页当初收敛过（OPT-078 两种视图都变
横排），楼盘页若不收敛，带 `?view=row` 的分享链接在手机上会渲染成另一种版式**且没有任何
控件切回去**——那不是「隐藏了一个死控件」，是把用户锁在一个版式里。

因此 `.bd-rowcard` 在 ≤767 收敛回竖排卡，度量逐条对齐 `.bd-card`。375 实测两者高度均为
**352px**（第一版差 5px，原因是 statcol 作为 body 的兄弟节点拿不到 body 的 `gap: 5px`，
补 margin-top 时补成了 10；已改回 5）。

## 5. 埋点：`section` 增加 `vacant`

`ListResultAnalytics.section` 原本是 `'grid' | 'row'`。楼盘页此前把它当**分组**标记用
（grid = 有在租、row = 暂无在租）；加了版式切换之后，有在租组在 row 版式下也要发 `row`，
两者在同一页撞成同一个取值，这个维度就失去了它存在的理由（「区分同一页的两种呈现」）。

处置：枚举扩成 `'grid' | 'row' | 'vacant'`，暂无在租组改发 `vacant`。

- `isListSection` 是 **fail-closed 闸门**（`ListClickAnalytics` 用它决定整条事件报不报，
  不是丢字段），已改成从 `LIST_SECTIONS` 推导，不再两处各写一份字面量。
- **口径变更**：`building_result_click` 的 `section='row'` 在本项之前指「暂无在租紧凑
  行」，之后指「用户选中的横排卡」，两段数据不可直接合并。
- `lib/frontend/analytics/events.ts` 对 section **取值域零校验**，只按 key 白名单过滤，
  因此不需要改那边。

## 6. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/components/frontend/listing/BuildingResultRow.tsx` | **新增**：楼盘横排行组件 |
| `src/app/(frontend)/styles/list.css` | 新增 `.bd-rowlist` / `.bd-rowcard*`；≤767 收敛块；更新 viewseg 隐藏理由 |
| `src/components/frontend/city/CityBuildingsView.tsx` | 新增可选 `view` prop；currentParams 挂 view；有在租组按 view 二选一；暂无在租组 section 改 `vacant`；改写顶部裁定注释 |
| `src/app/(frontend)/buildings/page.tsx` | 解析 `?view=` 并传入 |
| `src/app/(frontend)/[city]/buildings/page.tsx` | 同上 |
| `src/components/frontend/listing/list-analytics.ts` | section 扩 `vacant`；`isListSection` 改为从 `LIST_SECTIONS` 推导 |
| `src/components/frontend/listing/ResultToolbar.tsx` | 更新预取实测注释（`/buildings` 4 → 5 条变体） |
| `src/app/(frontend)/styles/surface.css` | `.sf-scrim` 消费方清单补第七处 |
| `tests/opt036-buildings-view-wiring.test.ts` | **+9 条** OPT-081 用例 |
| `tests/opt036-building-search.test.ts` | **+1 条** canonical 不含 view |
| `tests/opt068-listing-navigation.test.ts` | 白名单补 `BuildingResultRow.tsx` |
| `tests/opt068-media-srcset.test.ts` | 白名单补 `BuildingResultRow.tsx` |

## 7. 刻意不做

- **不动 `city-routes.ts` 的查询键白名单**：legacy `/buildings?view=row` 经 307 转到
  `/shanghai/buildings` 时 `view` 会被丢掉——这是**既有行为**（`selectBuildingQuery` 只
  保留 `grade`，房源页同理丢 view），与本项对称，不在范围内。要改会同时改动房源页与
  城市切换语义，并打破 `tests/city-routes.test.ts` 的既有断言，应另开工作项。
- **不改 `BuildingResultCard`**：它的 `sizes` 是 `(max-width:767px) 100vw, 320px`，与本项
  无关；新行组件自带 `240px` 那一档。
- **不把 view 塞进 canonical**：两个只差版式的 URL 对搜索引擎必须是同一页面，已加守卫。
- **不改「暂无在租」组的排布**：见第 2 节。

## 8. 验证

- [x] `pnpm typecheck` 干净
- [x] `pnpm lint` 0 error（23 个 `<img>` warning 为既有，所有结果卡组件都有）
- [x] `pnpm test` 4715 passed / 41 skipped（新增 10 条）
- [x] 新增用例**变异验证**：4 个变异各自被抓
      （section 退回 `row`、不挂 currentParams、row 分支渲染网格卡、暂无在租组跟着 view 变）
- [x] `pnpm build` 通过（exit 0，无 error）
- [x] E2E：`multi-city-isolation.spec.ts` / `landing-pages.spec.ts`（两者都有「控制台零
      错误」硬守卫覆盖 `/buildings`）——14 passed。
      **坑**：首轮 `multi-city-isolation` 报红，断点在 `/shanghai` 首页 canonical、与本项
      无关：Playwright 进程不读 `.env.local`，`MULTI_CITY_ROUTING_ENABLED` 取不到，测试按
      单城口径断言而 dev server 是多城。`MULTI_CITY_ROUTING_ENABLED=true` 重跑 3 passed /
      1 skipped。跑这两个 spec 时记得带上这个变量。
- [x] 浏览器实测（1440 + 375，见第 2、4 节数字；row 下 sort/filter/pager href 均保住
      `view=row`；工具条 aria-current 正确；移动端 viewseg 隐藏且两版式渲染一致）
