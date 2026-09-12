# Task Packet：OPT-093 首页热门商圈候选池换源、去上限 + 精选区域保存失败无感

> 状态：**已实施，待合并**
> 创建日期：2026-09-12
> 来源：用户想在线上首页热门商圈配「陆家嘴 / 张江 / 漕河泾 / 虹桥 / 静安寺」，
> 查线上库发现只配「精选区域」会漏掉漕河泾与虹桥

---

## 1. 一句话

首页商圈卡候选池不再从「精选楼盘前 30 栋」反推，改为按该城**全部在营楼盘**聚合、
不设张数上限；运营只需在「城市站点配置 → 首页内容 → 精选区域」里选商圈、拖顺序，
不必再去楼盘上改「推荐排序」。

## 2. 根因

`facade.ts#getHomepage` 的商圈卡聚合 `byArea` 取自 `findFeaturedBuildings(ctx, 30)`——
这个 30 是为「精选楼盘」栏过取的（展示 8 张，过取 30 供封面挑选），商圈卡顺手借用了。
商圈能否进池于是取决于其楼盘在 `recommendedOrder ↑, updatedAt ↓` 里是否排进前 30。
线上上海所有楼盘 `recommendedOrder` 皆为 0，实际按更新时间倒序：漕河泾（华鑫慧享城，
第 76 名）、长宁虹桥（第 75 名）、闵行虹桥（第 36 名）全部出局。

此外 `DEFAULT_DISTRICT_CARD_POOL_LIMIT = 20` 在视图层重排**之前**截断，任何上限都可能把
精选商圈挤出去——与 OPT-060 修的缺陷同类，只是阈值从 5 变成 20。

`CitySiteProfiles.featuredRegions` 只负责**重排**（`orderByFeaturedRegions`），不负责拉入。
运营看不到「进池门槛」这层逻辑，只会觉得「配了没反应」。

## 3. 做法

| 层 | 改动 |
|---|---|
| `src/domain/public-catalog/facade.ts` | 商圈卡聚合源改为 `allEffectiveBuildings`（`findEffectiveBuildings`，≤200，同一批 `Promise.all` 已在查、`depth: 2` 已填充 `businessDistrict`，零新增查询）。内存里按 `recommendedOrder ↑, updatedAt ↓` 排一次再聚合，代表楼盘 / 封面仍取「最推荐的那栋」 |
| 同上 | 删除 `DEFAULT_DISTRICT_CARD_POOL_LIMIT` 与 `districtCardPoolLimit` 选项：候选池 = 所有「有在营楼盘」的商圈。质量门槛（无在营楼盘不进池）不变，天然把张数锁在楼盘数以内 |
| `src/components/frontend/city/CityHomeView.tsx` | 只改注释：候选池不再有上限，重排 + 截张数的顺序不变 |
| `tests/public-catalog-facade.test.ts` | 替换两条 `districtCardPoolLimit` 用例（见 §4） |

**不改**：精选区域配置继续留在 `unstable_cache` 之外（改配置立即生效、不打供给侧标签）；
`findFeaturedBuildings` 与首页「精选楼盘」栏不动；后台字段不动、无迁移。

DTO 代价：上海当前 32 个有在营楼盘的商圈 × 约 600B ≈ 20KB，全在服务端缓存，不过网络。

## 4. 验收

- [x] 单测：精选楼盘前 30 名之外的商圈，只要有在营楼盘就进候选池（`poolFixture(35)` 全进）
- [x] 单测：无在营楼盘的商圈仍不进候选池（既有用例）
- [x] 单测：每张卡的代表楼盘按 `recommendedOrder ↑, updatedAt ↓` 取，不受 `findEffectiveBuildings` 返回顺序影响
- [x] 单测：候选池张数 = 有在营楼盘的商圈数，不再被 20 截断
- [x] 本地浏览器：克隆 31 栋楼盘把外滩压到第 36 名后仍出卡；精选区域改顺序立即生效；代表楼盘随 `recommendedOrder` 变
- [x] `typecheck` 干净 / `lint` 0 error / `test` 5019 passed

证据：`artifacts/verification/OPT-093/`。

## 5. 上线后运营侧要做的

后台「站点与内容 → 城市站点配置 → 上海 → 首页内容 → 精选区域」依次选
陆家嘴 → 张江 → 漕河泾 → 虹桥 → 静安寺，保存即生效。

线上有两个同名商圈「虹桥」（长宁区 `hongqiao` = 虹桥开发区；闵行区 `minhang-hongqiao` =
虹桥商务区），建议在「城市与区域」里把名字改成「虹桥开发区」「虹桥商务区」消歧（只改名，不动 slug）。

## 6. 追加：精选区域「保存后再进来是空的」（2026-09-12 用户反馈）

### 根因（本地复现）

两层叠加：

1. 级联框刻意**不按「前台可见」过滤**（`LocationCascadeField` 硬约束 3，为楼盘归属场景设），
   但 `protectCitySiteProfile` 要求精选区域必须 `frontendVisible = true`。选到不可见商圈 → 保存 422。
2. 422 只有一条几秒消失的 toast（不说是哪个商圈）；自定义 Field 组件没渲染字段级错误，也没渲染标签；
   失败后「保存」按钮变灰——看起来像保存成功。运营退出再进，看到的是库里的旧值，即「消失」。

线上两个同名「虹桥」里闵行那个（`minhang-hongqiao`）正是 `frontend_visible = false`，选错一个整条保存作废。

### 做法

| 层 | 改动 |
|---|---|
| `src/domain/geography/location-cascade-eligibility.ts`（新） | 纯函数：`cascadeNodeEligibility`（停用 / `frontendVisibleOnly` 下不可见 → 不可选，理由可区分）、`eligibleCascadeKeys`（onChange 兜底过滤） |
| `src/components/admin/LocationCascadeField.tsx` | 新 prop `frontendVisibleOnly`：不可见节点标「（前台不可见）」，多选用 `disableCheckbox`（不像 `disabled` 那样向下继承，不可见行政区底下的可见商圈仍可勾）；已选标签经 `renderFormat` 只显示名称；补渲染 `FieldLabel` / `FieldError` / `FieldDescription`（自定义 Field 组件会整个替换 Payload 的字段 UI，此前三者都没人画） |
| `src/collections/CitySiteProfiles.ts` | `featuredRegions` 传 `frontendVisibleOnly: true`，补 description 说明规则与修法 |
| `src/domain/city-site-profile/profile-protect.ts` | 精选区域校验失败改抛**字段级** `ValidationError`（`path: featuredRegions`、`label: 精选区域`、传 `req.t` 让 toast 是中文），文案点名节点且够短（Payload 字段错误是单行 tooltip，长了截省略号） |

不动 `location-field-guard`：它的两种失败（停用 / 类型不符）级联框本来就挡住了。

### 验收

- [x] 单测：可选性判定（默认不看可见性；`frontendVisibleOnly` 下不可见不可选；停用优先）；onChange 兜底过滤
- [x] 单测：三种校验失败都是 `ValidationError`，`path/label` 正确，文案含节点名
- [x] 本地浏览器：下拉里不可见节点带标注且勾不上；不可见行政区仍可展开、其下可见商圈可勾；选「上海 / 浦东新区 / 陆家嘴」保存 200，退出再进三个值都在
- [x] 本地浏览器：值里的商圈事后被隐藏 → 保存后字段上方红字「「陆家嘴」前台不可见，不能作为精选区域」常驻、toast「下面的字段是无效的： 精选区域」
- [x] 回归：楼盘编辑页的级联框正常，一个标签一个值
- [x] `typecheck` / `lint` 0 error / `test` 5023 passed

### 追加 2：搜索模式漏网（2026-09-12 线上复现）

组件开着 `showSearch`，输入「虹桥」后是扁平结果列表 `.arco-cascader-list-search-item`——
线上实测闵行「虹桥商务区」在这里 `aria-disabled="false"`、复选框照常可点。

根因：Arco 2.66 `Cascader/panel/search-panel.js` 只认 Node 的 `disabled`，`disableCheckbox` 只在树形面板
`panel/option.js` 生效。`filterOption` 也拦不住——`store.searchNodeByLabel` 是「路径上任一节点命中即保留」，
搜「徐汇」会把徐汇底下的不可见商圈一起带出来（且不可见节点的 label 是带标注的 ReactNode，
默认 filter 反而永远匹配不到它自己的名字）。本地复现（修复前）：值确实没写进去（`eligibleCascadeKeys` 兜底在搜索模式也走到了），
但一次无效点击把表单置脏——「保存」从 disabled 变可点，无事可存。

| 层 | 改动 |
|---|---|
| `location-cascade-eligibility.ts` | 新增 `reconcileCascadeSelection(next, current, byId, options)`：过滤之外还回答「与当前值有无实质变化」（含顺序），无变化不 setValue、不置脏 |
| `LocationCascadeField.tsx` | `frontendVisibleOnly` 下 `showSearch` 改对象形态：`renderOption` 自绘搜索行（可选行复选框 + 路径；不可选行禁用复选框、`aria-disabled` 壳吞掉点击），`retainInputValueWhileSelect: true` 保住原来「勾完关键词还在」的行为；穿透到 li 的点击（行内空白 / 键盘 Enter）由 reconcile 兜底。其它 7 处字段仍是布尔 `showSearch`，字节不变 |
| `tests/location-cascade-field-search.test.ts`（新） | happy-dom 里真渲染 Arco Cascader：打开、输入、点搜索行；不可见行禁用且不触碰表单，li 穿透路径不写值不置脏，不可见行政区下的可见商圈可勾，对照组（不开开关）照常可选。曾做变异检查：去掉 reconcile 的早返回，li 穿透用例即红 |

- [x] 单测：reconcile 五种情形（勾到不可见 / 真变化 / 换序 / 旧值残留 / 不开开关）
- [x] happy-dom 组件测试 5 条；全量 `pnpm test` 381 files / 5051 passed
- [x] 本地浏览器（真实鼠标）：搜「徐汇」不可见行禁用；点文字、点行内空白都不写值、保存按钮保持 disabled；点可见行正常；搜「上海」浦东新区不可勾、其下陆家嘴可勾；选陆家嘴保存 PATCH 200 / 响应 `featuredRegions:[5]` / 刷新回显；树形面板不变
- [x] 深浅两主题的展开态截图 + 修复前对照组（同一脚本跑 `origin/master` 版组件，4 项判据红）：`artifacts/verification/OPT-093/cascade-search/`

## 7. 不在本项内

- 后台「该商圈暂无在营楼盘，首页不会展示」提示：需给级联组件新开一个查询接口，另立工作项。
