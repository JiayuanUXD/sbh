# Task Packet：OPT-071 图片水印——logo 作为水印源

> 状态：**设计已定，未实施**
> 创建日期：2026-09-06
> 来源：用户「增加一个支持上传图片水印的功能」
> **前置依赖**：`OPT-069` 已于 2026-09-05 上线（文字水印，默认关闭）。本工作项在其上扩展水印源。

---

## 1. 一句话

现在水印只能是文字。运营想用 logo，就得让**满铺和角标各自独立地选「用文字」还是「用图片」**。

## 2. 已定的决策

用户在 2026-09-06 的需求梳理里选定：

**两种版式都支持图片，各自独立选图或字。**

理由：满铺是防扒图的主力，角标是品牌位。只做角标等于「上传图片水印」这件事拿不到防盗价值；
而两种版式绑在一起选，运营就没法做「详情页铺 logo、卡片只压一个小标」这种常见配法。

## 3. 配置形态

`SiteSettings.watermark` 现有 `tiled` / `badge` 两组。各加两个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | select：`text`（默认） / `image` | 该版式用文字还是图片 |
| `image` | upload → media，**可空** | `source: 'image'` 时的图源 |

`image` **必须可空**。设成 required 会生成 `NOT NULL` + `ON DELETE SET NULL` 的死结——
被引用的 media 从此删不掉（`OPT-070` 已为此把四列收口过，见
`src/domain/media/media-delete-cleanup.ts`）。改为可空 + 钩子摘除。

## 4. 三个必须处理的陷阱

### 4.1 版本哈希必须吃图片身份，否则换 logo 不会重刷

`computeWatermarkVersion` 现在只吃文字配置。换了 logo 而哈希不变 → 之后每一轮重刷都判
「已是当前版本」跳过 → **新旧两个 logo 永久共存，且没有任何报错**。

这与 `WATERMARK_FONT_PACKAGE` 是同一类失效（见 `watermark.ts` 该常量的注释）。
哈希输入必须包含 **media id + 该 media 的 `updatedAt`**：只有 id 不够——运营可以同名覆盖上传，
id 不变而像素全变。

### 4.2 logo 自己不能被打水印

logo 是一条 Media 记录。如果它的 `usage` 是 `listing-photo`，回刷会给它自己烘上水印，
然后被烘过的 logo 再去给别人当水印源——套娃且不可逆。

`backfill-media-usage.ts` 的 `GLOBAL_REFERENCE_SOURCES` 已把 `site-settings` 的
`logo` / `typeCards.coverImage` 归入 `brand`。新增的两个 `watermark.*.image` 路径
**必须同步加进那张表**，否则查无引用会落到 `other`（不危险，但分类不准），
而运营手动改成 `listing-photo` 就会中招。

### 4.3 容器里 librsvg 能不能渲染内嵌位图，没人验过

现有两个 overlay 都是 SVG 文本，交给 sharp 栅格化。图片水印最省事的做法是沿用同一条路径——
SVG 里放 `<image href="data:image/png;base64,...">`。**但 librsvg 对内嵌栅格图的支持在生产容器里
从未验证过。**

这与 OPT-069 的中文字体是同一类风险：本地能渲染不代表容器能。**上线前必须在生产的
`/api/watermark-preview` 上肉眼确认**，判据与字体那次相同。

若 librsvg 不支持，退路是 **sharp 原生 composite**：把 logo 预缩放后按网格生成多个
`{ input, top, left }` 条目。满铺需要旋转，用 `sharp(logo).rotate(angle)` 预处理一次再平铺。
这条路更稳但要两套代码路径，且与文字版式的参数语义要对齐。

**建议：先花半天用 `next build` + `next start` 在本机把 SVG 内嵌位图这条路验通再动手**
（OPT-069 的教训：跑 tsx 源码不算数，缺陷只在打包产物与容器里出现）。

## 5. 还要改的地方

- `buildTiledOverlay` / `buildBadgeOverlay`：按 `source` 分派；图片路径需要新的尺寸参数
  （logo 相对图宽的比例），文字的 `density` / 字号推导不适用。
- `/api/watermark-preview`：预览必须与烘焙同源（走 `mergeWatermarkConfig`），
  图片模式下也要能预览，否则「所见即所得」这个 tab 的唯一意义就没了。
- `WatermarkPreview.tsx`：查询串要带上图片模式的参数。
- `mergeWatermarkConfig`：`source: 'image'` 但 `image` 为空时的回落规则——
  建议回落到文字，并在后台明示，而不是静默不打水印。

## 6. 验收判据

1. 满铺用图 / 角标用字、以及反过来的组合，预览与烘焙结果一致。
2. 换掉 logo（同名覆盖与换一张都要试）后，`watermark.version` 改变，重刷会重烘存量图。
3. logo 自身的 `usage` 不是 `listing-photo`，且删除 logo 不被外键卡住。
4. **在生产后台预览里肉眼确认图片水印渲染正常**——与 OPT-069 第 4 步同等地位，
   不可用「CI 全绿」顶替。
5. `pnpm test` 覆盖：版本哈希对图片身份敏感、`source` 缺图时的回落、两种版式独立生效。
