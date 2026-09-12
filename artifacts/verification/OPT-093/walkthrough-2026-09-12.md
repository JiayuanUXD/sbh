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
