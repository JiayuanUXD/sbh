# Task Packet：OPT-069 房源图水印——详情满铺 + 卡片角标

> 状态：**设计已定，未实施**
> 创建日期：2026-09-04
> 来源：用户提出「为项目内图片增加水印，以防止被盗用」
> 编号说明：现存最大为 OPT-068，故取 069
> **前置依赖**：存量派生图回填必须先跑完，理由见 §8.1

---

## 1. 一句话

给房源/楼盘实景图打**可见水印**：详情页看到的母版满铺，卡片看到的派生图打右下角标。
干净原件另存 COS 私有前缀，水印随时可重刷。

## 2. 威胁模型（已与用户确认）

防的是**竞品扒图挂自己站**——右键另存、爬 `srcset`、脚本抓图，贴到他们的房源页。
不是版权追责（不做盲水印 / 数字指纹），不是爬虫限流（不做防盗链 / 限速）。

推论：水印必须**可见**，且必须出现在**每一张有盗用价值的公开文件**上。
只要还有一条路径能拿到可用的干净图，这个功能就等于装饰。
「有盗用价值」的下界取 `card 768`——唯一的例外是 320px 缩略图，理由见 §4.5。

## 3. 现状证据

### 3.1 媒体管线

`Media` 集合（`src/collections/Media.ts`）：单一集合装全部图——房源实景、文章配图、
landing hero、站点 logo 混在一起，`access.read: () => true`。
`upload.imageSizes` 三档宽度型派生 `thumb 320 / card 768 / hero 1600`，全转 webp，
`focalPoint: true`（`Media.ts:62`）。存储走 `s3Storage` → 腾讯云 COS，
前缀 `media`（`src/payload.config.ts:455`），未设 `disablePayloadAccessControl`，
故公开 URL 是同源的 `/api/media/file/<filename>?prefix=media`。

### 3.2 详情与卡片吃的是不同文件（本方案成立的关键）

| 用在哪 | 吃哪个文件 | 代码位置 |
|---|---|---|
| 详情画廊（主图 / 缩略图条 / 全屏灯箱） | **母版**，完全不发 `srcset` | `DetailGallery.tsx:34` `toRenderableMedia` 取 `item.resource.src` |
| 所有卡片（首页 / 列表 / 楼盘 / 文章） | **派生图** 320/768/1600 | `lib/frontend/media-srcset.ts` 的 `cardCoverProps` / `buildSrcSet` |
| 走 `<Media>` 原语的调用方 | `src`=母版，`srcSet`=三档 | `ui/Media.tsx`；调用方全是卡片，无详情页 |

也就是说「详情 / 卡片」这条产品线，恰好和「母版 / 派生」这条存储线重合。
**这是本方案能用两套版式的物理基础**，改动其一都会破坏它（见 §9 守卫测试）。

### 3.3 Payload 上传管线的三个可用切入点（已读源码核实）

1. **`beforeOperation` 跑在 `generateFileData` 之前**
   （`create.js:37` vs `:79`），此时 `req.file` 已就位——可以拿到干净母版 buffer。
2. **本地磁盘写入被 `!disableLocalStorage` 挡住**（`create.js:168`），
   而云存储插件会把它设为 `true`。**每个环境只有一条写入路径**，不会两边都写。
3. **云存储插件把自己的 hook 追加在集合已有 hook 之后**
   （`plugin-cloud-storage/dist/plugin.js:122`）。因此自建 plugin 只要在
   `plugins` 数组里排在 `s3Storage(...)` 之后，其 `afterChange` 就跑在上传之后。

## 4. 关键裁定

### 4.1 为什么不是「只给派生图盖水印、母版留干净并对外 403」

这是最初设想，读完源码后否决，三条硬伤：

- 给派生图换 buffer 只能改 `req.payloadUploadSizes`，那是 Payload 私有内部；
  且**本地磁盘路径持有的是另一个 buffer 引用**——`createImageSizes.js` 同时把
  buffer 写进 `req.payloadUploadSizes[name]` 和 `imageSizeFiles.push({ buffer })`，
  前者供 COS 上传、后者供本地 `uploadFiles`。改前者只影响生产。
  结果是**本地看不到水印、只有生产有**，正踩 `CLAUDE.md`「本地验之前先确认环境等价」。
- 母版 403 需要在 `access.read` 里按 filename 形状猜（`foo.jpg` vs `foo-768x512.webp`）。
  `checkFileAccess.js` 确实会传 `isReadingStaticFile: true` 与 `data.filename`，
  能力是有的，但判据不精确：用户传个叫 `foo-768x512.jpg` 的文件就绕过。
- 存量图没有派生（OPT-059 §7 明确不回填），`src` 会回落到被 403 的母版，
  **整站存量实景图直接裂图**。

### 4.2 为什么不是「服务时动态合成」

新增 `/api/media/wm/[...]` 冷图现场合成、回写 COS 当持久缓存，可行，但等于自建
一套图片服务。OPT-059 §4 刚因为「运行时优化器」这一类东西的复杂度裁掉 `next/image`，
再造一个是逆着既有裁定走。且首次请求把 sharp 放进请求路径。

### 4.3 为什么不是「全档同一套水印」（最简单的那个）

满铺水印的产品成本是真实的：图是转化链路的一部分，客户在详情页看图决定约不约看房。
iStock 敢满铺是因为它靠卖干净图赚钱，预览图**故意**做得没法看；租赁平台反过来。
同行（58 / 搜楼）普遍用角标或底部条，不满铺。

但「卡片完全不打」也不成立：卡片吃的是**公开的** 1600 派生图，
不打等于把一张干净的 1600px 图免费送出去，够竞品直接当详情大图用。

故：**详情满铺 + 卡片角标**，每一张公开文件都有标记，同时列表页不被糊。

### 4.4 为什么是「上传后覆盖写」而不是「上传前换 buffer」

见 §4.1 第一条：换 buffer 的两种存储模式行为不一致。
覆盖写对本地 fs 与 COS 是**同一条代码路径**，本地能验到真实效果。
代价是派生图生成两遍（Payload 一遍干净的、我们一遍带水印的）+ 4 次写。
上传是后台低频操作，接受。

### 4.5 `thumb 320` 档不打角标

320px 图对竞品无使用价值（他们的卡片也要 ≥600px），而按比例缩放后的角标在 320 上
约 9px，只会变成脏点、损害我们自己的列表页观感。这是明确取舍，不是遗漏。

## 5. 方案

### 5.1 架构

新增本地 plugin `watermarkPlugin`（`src/plugins/watermark.ts`），
在 `payload.config.ts` 的 `plugins` 数组里**置于 `s3Storage(...)` 之后**。

上传一张 `usage = listing-photo` 的图时：

1. **`beforeOperation`**（media collection hook）：把干净母版 buffer 存进 `req.context`。
   **不改 `req.file`**——让 Payload 照常用干净母版做尺寸探测、blurDataUrl、三档派生。
2. **Payload 原样跑**：干净母版 + 三档干净派生落到存储（本地 fs 或 COS，二选一）。
3. **`afterChange`**（由 `watermarkPlugin` 追加，排在上传之后）：
   - 干净母版 → 写 `media-source/<filename>`（备份，私有）
   - 母版 → 盖**满铺** → 覆盖写 `media/<filename>`
   - `card` / `hero` 两档 → 从干净母版 resize 到 `doc.sizes[n].width/height` →
     盖**角标** → 覆盖写 `media/<doc.sizes[n].filename>`
   - `thumb` 档不动（§4.5）
   - 写 `watermark: { version, appliedAt }`（需 `req.context` 守卫防递归，
     写法抄 `plugin-cloud-storage/dist/hooks/afterChange.js` 的 `skipCloudStorage`）

**顺序铁律：先备份、再烘焙。** 备份失败必须中止该图并抛错，否则干净原件永久丢失，
「可逆」这个前提就没了。

> hook 里不要 try/catch 吞错：Payload 的 `killTransaction` 会回滚整个 req 事务，
> 吞掉异常等于「返回成功但没落库」。

### 5.2 写入 shim

`src/lib/storage/media-writer.ts`，两个实现（COS 走 S3 client / 本地走 fs），
由既有的 `parseCosStorageConfig`（`src/lib/storage/cos-config.ts`）选择——
和 `s3Storage({ enabled })` 用**同一个判据**，不新增第二个真相源。

接口只需两个方法：`put(prefix, filename, buffer, mimeType)` 与 `get(prefix, filename)`。

### 5.3 水印渲染

`src/domain/media/watermark.ts`，纯函数，无 IO：

- `buildTiledOverlay({ width, height, config })` → SVG Buffer
- `buildBadgeOverlay({ width, height, config })` → SVG Buffer

已验证的实现要点（本设计阶段用 sharp 0.34.4 实跑过）：

- **不用 `composite({ tile: true })`**，直接生成整幅尺寸的 overlay SVG，
  若干 `<text>` 统一 `rotate(-30)`。省掉平铺接缝对齐，成本可忽略。
- **字号由图宽推导**（`fontSize = 图宽 / 列数 / 文字宽度系数`），
  保证任何母版尺寸下观感一致。
- **描边不能省**：`fill="#fff"` + `stroke="#000"` + `paint-order="stroke"`。
  纯白半透明字在落地窗那类高亮区会完全消失，深色字在近黑家具上同理。
- 中文字体在 sharp 的 librsvg 下正常渲染（`Microsoft YaHei, SimHei, sans-serif`）。
  **生产是 Linux 容器，字体可用性与本地不同**——见 §7.3。

### 5.4 字段

`Media` 新增两个字段（**需迁移**）：

- `usage`：`listing-photo` | `brand` | `article` | `other`。**只有 `listing-photo` 走水印。**
  - **默认值 `listing-photo`**。理由：误打可逆（`media-source/` 有干净原件，重刷即可），
    漏打不可逆（无水印图已经流出）。默认值要偏向可恢复的那一侧。
  - **不做「按上传入口预填」**（2026-09-04 写实施计划时订正）：`ListingMediaManager` /
    `BuildingMediaManager` 并不自己发上传请求（不调 `/api/media`、无 FormData），
    走的是 Payload 内建上传抽屉，没有可挂的落点。而默认值恰好就是房源场景要的值，
    所以这条本来也只对品牌素材有意义。
  - 品牌素材（logo、落地页背景）靠两条兜住：存量由 §6.1 的回填脚本纠正，
    新上传由字段说明提示运营改。**误标的后果是该图被打上水印**——立刻可见，
    且改 `usage` + 重刷即可从 `media-source/` 复原，不是不可逆损失。
- `watermark`：只读元数据 `{ version, appliedAt }`，供重刷任务判定幂等。
  - `version` 是**当前水印配置的内容哈希**（对 §5.5 那组参数 + 渲染器版本号求哈希），
    不是人工维护的版本号。运营改任一参数、或渲染器逻辑升级，哈希即变，
    重刷任务据此识别出「这张图还是旧配置烘的」。
    人工版本号会漏更新，届时重刷任务会静默跳过该跑的图。

### 5.5 后台可调 + 重刷任务

`SiteSettings` 新增「图片水印」tab（权限沿用已有的 `site_settings:manage`）：

- 总开关
- **详情满铺**：密度（横向列数 2–6）、透明度、旋转角、文案（默认取 `siteName`）
- **卡片角标**：位置（四角）、透明度、文案
- **只读预览**：固定样张按当前配置实时合成
- 界面必须明写：**保存只影响之后新上传的图，已有图片要点「重刷」**

> `SiteSettings.ts:9` 的文件头立了规矩：「只收运营会改的内容，开放配置只会制造
> 『运营填空 → 按钮没字』的翻车面」。水印参数天然带一个「改了没反应」的翻车面
> ——所以**配置与重刷必须同时存在**，只做其一就不该做这个 tab。

重刷任务 `rebakeWatermarkTask` / `MEDIA_WATERMARK_QUEUE`，
对齐 `payload.config.ts:156` 既有 jobs 写法：

- `TaskConfig` + `autoRun` cron + 15 分钟租约回收（与 `application-notify.ts` 同口径）
- 分块 20 条（同 `SUPPLY_IMPORT_CHUNK`）
- **幂等**：按 `media.watermark.version` 判定，已是当前版本的跳过 → 重跑安全
- 进度写进一个 batch 文档（形态抄 `SupplyImportBatches`）
- 数据源是 `media-source/` 的干净原件；缺失则跳过并记 error
- 单张失败不阻断后续（同 `import-task.ts` 语义 4）

## 6. 存量图

### 6.1 `usage` 回填规则（确定性，可脚本化）

反查引用，命中即定，优先级 `listing-photo` > `article` > `brand` > `other`：

| 被谁引用 | 判为 |
|---|---|
| `Listings` 的相册 / 封面 / 平面图资源 | `listing-photo` |
| `Buildings` 的相册 / 封面 / 资源 | `listing-photo` |
| `Articles` 封面 | `article` |
| `SiteSettings` / `Pages` / `Locations` / `CitySiteProfiles` | `brand` |
| `ListingReports`（用户举报上传的截图） | `other` |
| 无人引用 | `other` |

`usage` 是可编辑字段而非读时派生，边界情况运营可手工纠正。

### 6.2 回刷脚本

`scripts/backfill-watermark.ts`（骨架抄 `scripts/backfill-media-sizes.ts`）：
现有文件即干净原件 → **先备份进 `media-source/`** → 再走与 §5.1 同一套烘焙。

## 7. 风险与已知代价

### 7.1 后台看到的房源图也是满铺的

母版带水印，素材库与房源编辑页的预览随之带水印。属所见即所得，可接受；
需要干净原件时从 `media-source/` 取。

### 7.2 详情画廊的缩略图条会显示满铺水印

`DetailGallery` 的缩略图条也吃母版（`DetailGallery.tsx:401`），
所以会是满铺版式在小尺寸下的样子。

顺带指出一个**既有**问题（不在本工作项范围）：那条缩略图带目前直接加载全尺寸母版，
4000px 原片被塞进百来像素的格子。改成吃 `hero` 档既解决观感也解决性能，
建议单开工作项。

### 7.3 生产容器的中文字体（最可能的线上翻车点）

本地 Windows 有 `Microsoft YaHei`，**CloudRun 的 Linux 容器不一定有任何中文字体**。
缺字体时 librsvg 会渲染成方框或空白，而且**不报错**。

对策二选一，实施时定：

- Dockerfile 装 `fonts-noto-cjk`（增加镜像体积，注意 `DEPLOYMENT.md` 强调的包体积命门）
- 字体随仓库带，或把文案预渲染为 SVG 路径，彻底去掉字体依赖

**验收必须包含「在生产同构的容器里烘一张中文水印图并肉眼确认」**，不能只在本地验。

### 7.4 上传耗时增加

多一次满铺合成 + 两次派生重烘 + 4 次存储写。后台低频操作，可接受，
但批量上传（`MediaWorkbench` 拖拽多图）会明显变慢，需实测量化。

### 7.5 COS 存储翻倍

`media-source/` 是全量副本。COS 标准存储约 0.12 元/GB/月，可忽略。

## 8. 实施顺序

### 8.1 存量派生回填必须先跑完

`buildSrcSet` 在没有派生时返回 `undefined`，`cardCoverProps` 的 `src` 回落母版
（`media-srcset.ts` 的 `pickVariantSrc`）。而母版将是**满铺**的——
存量图的卡片会突然出现满铺水印，列表页观感崩掉。

故上线顺序固定为：

1. 跑 `scripts/backfill-media-sizes.ts` 补齐所有 `listing-photo` 的三档派生
2. 跑 `scripts/backfill-watermark.ts` 备份 + 烘焙
3. 才合并水印功能

### 8.2 合并即上线

`CLAUDE.md`：改动命中 `quality.yml` paths 的合并会直接全量切流。
本工作项改 `src/`，必然触发。**没准备好上线就别合。**

## 9. 验收

- **纯逻辑 TDD**：overlay 生成器是纯函数，Vitest 先红后绿，
  断言字号 / 间距随图宽的换算、密度与透明度参数生效。
- **像素断言**：烘焙后取采样点，断言与原图差异超阈值——证明水印真落上去了，
  比「没抛异常」强得多。同时断言 `thumb` 档**未**被改动（§4.5）。
- **两条守卫测试**：
  1. `Media.upload.imageSizes` 任何一档**不得同时**声明 `width` 和 `height`。
     同时声明会走 `resizeWithFocalPoint` 的真裁切分支
     （`getImageResizeAction.js`），右下角标可能被裁掉。
  2. 详情链路不得吃派生图、卡片链路不得吃母版（§3.2 的分工是本方案的物理基础）。
- **浏览器实测**（`CLAUDE.md` 铁律，非可选）：
  本地起 dev，用 `scripts/seed.ts` 的 E2E 夹具账号登录后台 → 上传一张房源图 →
  详情页满铺、列表卡角标 → 改一次 SiteSettings 配置 → 确认前台**不变**（符合预期）
  → 跑重刷 → 确认变了。
  验之前先 `pnpm exec payload migrate`，否则会看到缺列 500 的假象。
- **容器内字体验收**（§7.3）：在与生产同构的镜像里烘一张中文水印图，肉眼确认不是方框。

## 10. 测试影响面

- `tests/` 里凡断言 media URL / `sizes` 形状的用例不受影响（文件名不变，只换内容）。
- E2E 中 `page.route('**/api/media/file/**')` 的 mock 不受影响。
- `seed:media` 产出的图需要显式写 `usage: 'other'`，否则默认 `listing-photo`
  会让夹具图全部走水印烘焙、拖慢 seed。

## 11. 待确认项

1. **COS 桶 ACL**：`media-source/` 必须不可匿名访问。桶若为公有读，
   需加 bucket policy 或换独立私有桶。**实施第一步先验证。**
2. **存量 `listing-photo` 的量级**：决定重刷分块与耗时预估。
3. **字体方案**（§7.3）：装 `fonts-noto-cjk` 还是预渲染为路径。
