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
