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

### 4.3 SVG 内嵌位图这条路——已验证可行（2026-09-06）

原始担心：现有两个 overlay 都是 SVG 文本交给 sharp 栅格化，图片水印最省事的做法是沿用
同一条路（SVG 里放 `<image href="data:image/png;base64,...">`），但**容器里的 librsvg
支不支持内嵌栅格图，当时没人验过**。

实测结论：**可行。**

- 本地 sharp 0.34.4 / libvips 8.17.2 / **librsvg 2.61.1**，`href` 与 `xlink:href`
  两种写法都渲染正确（造纯红方块内嵌，数输出红像素 1600/1600）。
- 各平台 `@img/sharp-libvips-*` 同为 `1.2.3`——容器（linux-x64）与本地（win32-x64）
  是同一次构建产出的同一套 libvips。
- **与字体那次风险不同类**：字体是基础镜像缺失的系统文件，而位图解码是编译进 libvips
  的能力，不依赖任何外部资源。

**体积问题必须处理**（原文没提到，实施时才暴露）：满铺在 3 倍画布上会生成几十到上百个格子，
逐格内嵌 data URI 的话一份 30 KB 的 logo 能把 overlay 撑到几 MB，而这是**每张图烘一次
都要付**的代价。做法是 base64 只放进 `<defs>`、格子用 `<use href="#wm">` 引用——
实测 800×600 / density 3 的满铺 overlay 只有 4954 字节。

仍然保留的判据：**上线后要在生产的 `/api/watermark-preview` 上肉眼确认**。
本地已用 `next build` + `next start` 生产构建验过两种版式（这是 OPT-069 的教训：
跑 tsx 源码不算数），但容器是最后一环。

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
