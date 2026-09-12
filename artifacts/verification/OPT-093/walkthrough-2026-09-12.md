# OPT-093 本地走查记录（2026-09-12）

环境：worktree `E:\wt-093`，分支 `feat/opt-093-district-card-pool-9f3a`，`next dev -p 3725`，
本地 PG（默认 `postgres` 库，走查前已 `payload migrate` 到最新）。

## 造数

本地上海只有 7 栋在营楼盘、3 个前台可见商圈，复现不了「楼盘排在精选楼盘前 30 名之外」。
用 SQL 把徐家汇的一栋楼盘克隆 31 份（`slug = opt093-clone-N`，`updated_at` 逐份加 N 分钟），
让其余商圈的楼盘全部掉到第 32 名之后——与线上漕河泾（第 76 名）、虹桥（第 36 / 75 名）同形：

| 商圈 | 在营楼盘 | 最好名次 |
|---|---|---|
| 徐家汇 | 32 | 1 |
| 虹桥 | 1 | 33 |
| 外滩 | 1 | 36 |

走查结束后已删除克隆行、清空本地 profile 的精选区域。

## 结果

| # | 操作 | 预期 | 实际 |
|---|---|---|---|
| 1 | 打开 `/shanghai`，精选区域为空 | 外滩（第 36 名）进卡片区 | ✅ 卡片：徐家汇、外滩。虹桥不出现——本地它 `frontend_visible = false`，被既有可见性门槛挡住，与本改动无关 |
| 2 | 夹具账号登录，`PATCH /api/city-site-profiles/1 {featuredRegions:[外滩, 徐家汇]}` → 刷新 | 顺序变为外滩 → 徐家汇，立即生效 | ✅ `home-districts-featured-bund-first.png` |
| 3 | `PATCH /api/buildings/329 {recommendedOrder:-1}`（clone 5）→ 刷新 | 徐家汇卡的代表楼盘首位变成 clone 5 | ✅ `home-districts-recommended-order.png`：`clone 5 · clone 31 · clone 30 · clone 28` |

封面图显示为破图是本地无 COS 的既有现象（见 memory `local-cos-placeholder-breaks-upload`），不在本项范围。

## 闸门

- `pnpm typecheck` 干净
- `pnpm lint` 0 error（34 条既有 warning）
- `pnpm test` 376 files / 5019 passed

---

# 追加：精选区域「保存后再进来是空的」

## 复现（修复前）

1. 打开 `/admin/collections/city-site-profiles/1` → 首页内容 → 精选区域，在 上海 / 徐汇 下勾「漕河泾开发区」（本地 `frontend_visible = false`）→ 保存
2. `PATCH /api/city-site-profiles/1` → **422** `featured_region_invalid: 精选区域必须是启用且前台可见的行政区或商圈`
3. 页面上：toast 数秒后消失；字段无红字；「保存」按钮 `disabled = true`，字段仍显示三个 tag
4. 离开再进：只剩两个 tag → 「消失」

## 结果（修复后）

| # | 操作 | 实际 |
|---|---|---|
| 1 | 打开下拉 | 不可见节点显示「（前台不可见）」，checkbox `arco-checkbox-disabled`；浦东新区（不可见）仍能展开，其下「陆家嘴」可勾（`admin-cascader-hidden-marked.png`） |
| 2 | 勾陆家嘴 → 保存 → 列表页 → 再进 | PATCH 200；三个 tag 都在，tag 文案只有名称「上海 / 浦东新区 / 陆家嘴」 |
| 3 | 用 API 把陆家嘴 `frontendVisible=false`，改一个别的字段后保存 | PATCH 400；字段上方红字「「陆家嘴」前台不可见，不能作为精选区域」常驻，输入框变红；toast「下面的字段是无效的： 精选区域」（`admin-cascader-field-error.png`） |
| 4 | 楼盘编辑页 → 位置交通 | 级联框一个标签「城市 / 行政区 / 商圈」、值「上海 / 黄浦 / 外滩」，无重复 |

走查后已把陆家嘴改回可见、清空本地 profile 的精选区域。

---

# 追加 2：搜索模式里不可见节点仍可勾（2026-09-12 线上复现）

环境：worktree `E:\wt-cascade`，分支 `fix/cascade-search-hidden-1e10`（基于 a0abaa9），`next dev -p 3731`，
本地 PG 默认 `postgres` 库（`migrate:status` 到 `20260912_083722_opt_094_header_service_phone` 全 Yes）。
夹具：上海 / 徐汇 下「漕河泾开发区」(802) 与「徐家汇」(800) `frontend_visible = false`；「浦东新区」(3) 不可见而其下「陆家嘴」(5) 可见。

## 复现（修复前，Browser pane 真实鼠标）

| # | 操作 | 实际 |
|---|---|---|
| 1 | 精选区域框输入「徐汇」 | 4 行：上海/徐汇、上海/徐汇/徐家汇、…/漕河泾开发区（前台不可见）、…/徐家汇（前台不可见）；后两行 `li[aria-disabled=false]`、复选框 `disabled=false` |
| 2 | 点「漕河泾开发区」行 | 复选框没留在勾选态、无 tag（`eligibleCascadeKeys` 兜底在搜索模式**是走到的**）；**但「保存」从 disabled 变可点**——无效点击把表单置脏了 |
| 3 | 先勾徐家汇再点漕河泾 | 同上：tag 只有徐家汇 |

顺带核对：PR #183 的 55068d3 是 17:38 合入、a0abaa9 的部署 17:45 才开始，线上「勾上了」很可能测在部署之前的版本上。

## 结果（修复后）

脚本 `cascade-search/probe.mjs`（Playwright、真实鼠标事件、深浅两主题各跑一遍，不点保存不改库）：

```
node artifacts/verification/OPT-093/cascade-search/probe.mjs http://localhost:3731
```

| 判据 | dark | light |
|---|---|---|
| 搜「徐汇」：不可见行复选框 `disabled` + `aria-disabled` 壳；可见行可用 | ✅ | ✅ |
| 真实点击不可见行文字 → 无 tag、未勾、保存仍 disabled | ✅ | ✅ |
| 真实点击不可见行 li 右侧空白（绕过 stopPropagation 走到 onChange）→ 同上 | ✅ | ✅ |
| 点可见行 → tag 出现、保存可点、关键词「徐汇」保留 | ✅ | ✅ |
| 搜「上海」：浦东新区不可勾、其下陆家嘴可勾 | ✅ | ✅ |
| 无新增控制台错误（媒体 500 = 本地无 COS 既有现象） | ✅ | ✅ |

- 产物：`result-after.json`（连跑两次都 ALL PASS）、`search-xuhui-dark.png` / `search-xuhui-light.png`（展开态，暗色下无白底残留）。
- **对照组** `result-before.json`：同一脚本、把两个源文件临时换回 `origin/master` 版跑，两主题各 4 项红
  （不可见行复选框可用、点文字/点空白后「保存」变可点、浦东新区可勾），修复后全绿。
- 手工（Browser pane）另做了持久化三步：搜「上海」勾陆家嘴 → 保存：`PATCH /api/city-site-profiles/1` 请求体 `featuredRegions:[5]`、
  响应 200 `featuredRegions:[5]`「更新成功」；刷新后 tag「上海 / 浦东新区 / 陆家嘴」仍在、`GET ?depth=0` 为 `[5]`。
  树形面板（不输入关键词）行为不变：不可见行政区 `arco-checkbox-disabled`、黄浦可勾。走查后已把 `featuredRegions` 清空。

## 探针自己踩的坑（写进脚本注释了）

- Playwright 会因 `aria-disabled` 拒绝点击不可见行，要 `click({ force: true })`——「点了也不生效」正是要验的。
- Arco Trigger 进场动画期间壳层 `pointer-events: none`，此时点击会**穿透**到弹层底下的元素（实测打到了「类型卡片覆盖」里的
  react-select 输入框），Cascader 失焦、弹层关闭、关键词被清空——看起来像「点了不可见行把面板点没了」。
  等 `style.pointerEvents === 'auto'` 再点；dark 先跑碰巧过了、light 稳定红，是时序不是主题。
- Browser pane 不合成帧时（`rAF` 不跑）Arco 的 `throttleByRaf` 定位不执行，弹层贴在文档 (0,0)：把页面滚到顶再按 ref 点即可，
  `Backspace` 在该输入框里送不进去，改关键词只能刷新重输。

## 闸门

- `pnpm typecheck` 干净；`eslint` 改动文件 0 error（1 条既有 warning：`options` useMemo 的 `selectableTypes` 依赖）
- `pnpm test` 381 files / 5051 passed（含新增 happy-dom 组件测试 5 条 + reconcile 5 条）
