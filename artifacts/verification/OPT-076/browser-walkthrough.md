# OPT-076 浏览器走查证据

日期：2026-09-09 ｜ 分支：`feat/opt-076-responsive-images-e099`
环境：本地 `pnpm dev`（:3717）+ **真实 Chrome**（视口 976 / DPR 1.5）

> **不要用 Claude Browser pane 验这一项**：它的 `innerWidth` 是 0，而 `sizes` 按视口宽度
> 解析，0 宽视口下带 srcset 的图 `load` 照常触发、`naturalWidth` 恒为 0，会被图集的
> 「补挂载前失败」探测判成加载失败。见 §3。

## 1. 三处 img 的实测选档

| 位置 | 显示宽 | 需求(×DPR) | 实际 currentSrc | sizes |
|---|---|---|---|---|
| 主图 | 912 | 1368 | `gallery-1-1200x900.webp`（最大可用档） | 逐档 calc，见源码 |
| 缩略图 ×3 | 156 | 234 | `gallery-{1,2,3}-320x240.webp` | `(max-width:1023px) 20vw, 201px` |
| 全屏 | 928 | 1392 | `gallery-1-1200x900.webp` | `100vw` |

主图另有 `fetchpriority="high"` + `loading="eager"`；缩略图 `loading="lazy"`，
初始不加载，滚入视口后才取（实测 currentSrc 由 `(not loaded)` 变为 320 档）。
全屏查看器点开正常、Esc 正常关闭。

## 2. 房源列表卡：实测后决定不改

- `mapListingCard` 早已把封面换成 768w 派生档，本地实测卡片 `src` 为
  `cover-…-768x432.webp`，「直出原图」的原始判断不成立。
- 加回 `variants` 实测 **+271 字节/卡**（886 → 1157，守卫阈值 1200）。
- 选档收益：网格卡 348px 与移动整宽 375px 在 1x/2x 下**都仍是 768**，与现状同档；
  只有「行卡 240px + 1x 屏」会选到 320。
- 六种情形一种受益，代价是吃掉一个**静默失败**的缓存上限九成的安全余量 → 不改。

## 3. 一次被环境骗到的对照实验

Browser pane 里主图加 srcset 后恒显示「图片暂未加载」，stash 掉改动即恢复正常——
「加了就坏、去掉就好」，对照组也确认过是干净的 master 版。据此我一度修改了
`detectPreHydrationFailure` 的判据。

换真实 Chrome 后**完全正常**。根因是 pane 的 0 宽视口，不是代码缺陷。
那次修改已撤回，只在源码注释里留下环境告诫。

教训：对照实验只能证明「两组有差异」，不能证明「差异来自被测改动」——
当两组跑在同一个非常规环境里时，环境本身可能就是那个变量。

## 4. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
