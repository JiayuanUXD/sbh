# Task Packet：OPT-076 详情页图集补 srcset / sizes 与主图优先级

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：eBay 前端对标分析（本轮清单项 I1）
> **相关**：`OPT-059`（派生尺寸管线）、`OPT-068`（楼盘侧 6 个调用方已接 srcset）、
> `OPT-047`（房源卡片缓存 2MB 上限）

---

## 1. 一句话

详情页图集的主图、缩略图、全屏三处都是裸 `<img src>`，直出原图；补上 `srcset` / `sizes`，
并把主图标成高优先级。

## 2. 范围被实测收窄了：房源列表卡**不改**

对标报告最初把「房源结果卡与行卡直出原图」列为本项最大的一块，理由是
「OPT-068 修到了楼盘侧 6 个调用方，房源列表卡漏掉了」。**实测推翻了这个判断。**

### 2.1 卡片其实早就在服务派生图

`mapListingCard`（`mappers.ts:652-660`）在投影时就把封面**换成了 768w 派生档**
（`pickVariantSrc(rawCover, LISTING_CARD_COVER_WIDTH=768)`），本地实测卡片 `src` 是
`cover-…-768x432.webp`，不是原图。所谓「直出原图」不成立。

### 2.2 加回 `variants` 的代价与收益，实测数字

同一个 mapper **刻意**把 `variants` 设为 `undefined`，因为列表页的 `unstable_cache`
缓存的是全量卡片数组，生产实测条目 2,278,117 字节已超 Next.js 的 2MB 硬上限，
**超限是静默失败**（页面照常 200，只有一行 stderr，`revalidate` 完全失效、每请求真打库）。
`tests/listing-card-payload-size.test.ts` 因此守着「单卡 ≤ 1200 字节」（当前约 886）。

| 项 | 实测 |
|---|---|
| 加回 `variants` 的单卡体积 | **+271 字节**（886 → 1157，把守卫留的 314 字节余量吃掉九成） |
| 网格卡 348px · 1x / 2x | 768 / 768 —— **与现状同档** |
| 移动整宽 375px · 1x / 2x | 768 / 768 —— **与现状同档** |
| 行卡 240px · 1x / 2x | 320 / 768 —— 仅 1x 这一种情形会选到更小的档 |

六种情形里只有一种能省流量，代价是把一个静默失败的缓存上限的安全余量吃掉九成。
**结论：房源卡与行卡维持原样，本项只做详情页图集。**

## 3. 改动

`src/components/frontend/DetailGallery.tsx` 一个文件：

| 位置 | 改动 |
|---|---|
| `RenderableMedia` | 增加 `srcSet?`，在 `toRenderableMedia` 里用 `buildSrcSet(item.resource)` 算好 |
| 主图 | 补 `srcSet` + `sizes`（`MAIN_IMAGE_SIZES`），并加 `fetchPriority="high"` |
| 缩略图 | 补 `srcSet` + `sizes`（`THUMB_IMAGE_SIZES`） |
| 全屏 | 补 `srcSet` + `sizes="100vw"` |

`sizes` 的取值按 `.dt-core` 的真实版面推导（主栏 = 容器 − 侧栏 372 − 列间 32），
逐档跟着断点写——**写歪了不会报错，只会让浏览器悄悄选错档**。缩略图那档刻意不做逐档
`calc`：所有断点下的值都远小于最小派生档 320w，多写的精度不产生任何差别，注释里写明了。

变体 URL 无需再校验：`mappers.ts` 的 `mapMediaVariants` 已对每一档各自跑过
`normalizePublicMediaUrl`，单档不合格只丢该档。

存量图没有派生尺寸时 `buildSrcSet` 返回 `undefined`，三处一律不发 `srcset`/`sizes`，
行为与改动前完全一致（OPT-059 §7：不回填存量）。

## 4. 一个差点写进代码的错误归因

在 Claude Browser pane 里走查时，主图一挂上 `srcset` 就渲染成「图片暂未加载」，
对照 master 确认「加了就坏、去掉就好」，看起来是铁证。据此我一度给
`detectPreHydrationFailure` 加了一条 `currentSrc !== ''` 的防护，并写了一段
「srcset 选档未完成会被误判为失败」的注释。

**换真实 Chrome（视口 976）后一切正常**：主图选中 1200w、`fetchpriority=high` 生效、
无失败占位。根因是 **Browser pane 的 `innerWidth` 是 0**，而 `sizes` 正是按视口宽度解析的——
0 宽视口下带 srcset 的图 `load` 照常触发、`naturalWidth` 恒为 0，正好撞上该函数的失败指纹。

那条防护已撤回（为不存在的缺陷加代码，还附一段虚假归因注释，比代码本身更有害），
只在函数注释里留下「验这段逻辑必须用有真实视口的浏览器」的告诫。

## 5. 验收（真实 Chrome，视口 976 / DPR 1.5）

| 位置 | 选中的档 | 判据 |
|---|---|---|
| 主图 | `gallery-1-1200x900.webp` | 显示宽 912 × 1.5 = 1368 → 取最大可用档；`fetchpriority=high`、`loading=eager` |
| 缩略图 ×3 | `gallery-{1,2,3}-320x240.webp` | 显示宽 156 × 1.5 = 234 → 取 320 档；`loading=lazy`，滚入视口才加载 |
| 全屏 | `gallery-1-1200x900.webp` | `sizes=100vw`，取最大档；Esc 正常关闭 |

`pnpm typecheck` 干净；`pnpm test` 343 文件 / 4705 用例通过。
