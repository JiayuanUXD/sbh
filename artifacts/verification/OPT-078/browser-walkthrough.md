# OPT-078 浏览器走查证据

日期：2026-09-09 ｜ 分支：`feat/opt-078-listing-filters-3052`
环境：本地 `pnpm dev`（:3717）+ Claude Browser pane（模拟视口 375 / 720 / 1440）

## 1. 三档实测

| 视口 | `.ls-grid` 列 | `.ls-card` 方向 | 卡高 | 图宽 | 视图切换 |
|---|---|---|---|---|---|
| 375 | 单列 343px | row | 107–123 | 116 | none |
| 720 | 单列 688px | row | 107 | 116 | none |
| 1440 | 4 × 324px | column | 357 | 324 | flex |

桌面（1440）与改动前完全一致——本次全部规则都在 `max-width: 767px` 内。

## 2. 比价对齐（本项的目的）

375 下取前 4 张卡的 `.ls-price__value` 左边缘：**154 / 154 / 154 / 154**，完全对齐。
一屏可见卡片数由 1.5 张变为 4 张。

## 3. `?view=row` 收敛

375 下 `?view=row`：`flex-direction: row`、图 116、价格列 `flex: 1 0 100%` 落到信息下方
（距卡顶 121px），与默认视图同款。改动前它是竖排整宽大图，与默认视图相反。

## 4. 走查抓到并修掉的两个问题

1. **整节 CSS 静默失效**：媒体查询写在 `.ls-card` / `.ls-toolbar__viewseg` 基础声明之前，
   同特异度后来者胜，一条都没生效也不报错。首轮实测指纹是「图宽已变 132、
   flex-direction 仍是 column、视图切换仍是 flex」——部分属性生效、部分没有，
   正是「两条规则打架」而不是「没编译」。已整节移到基础声明之后。
2. **标题穿出卡片**：`.ls-card__body` 缺 `min-width: 0`，flex 子项默认 `min-width: auto`
   被最长标题撑开，`text-overflow: ellipsis` 永不触发。补上后 `titleEscapes` 全为 false。

## 5. 一个既有缺陷（非本次引入）

1440 下 `document.documentElement` 可横向拖动 8px：`.ls-page` 宽 `100vw`(1440) 而
`clientWidth` 1425（滚动条 15px），`body { overflow-x: clip }` 只裁视觉。
**对照：未改动过的首页 `/shanghai` 完全相同**（`.hm-home` / `.hm-hero` / `.hero__bg` 同为 1440，
`scrollLeft` 同样能设为 8）。是 `100vw` 出血模式的全站问题，已另开任务。

## 6. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
