# Task Packet：OPT-059 图片渲染管线——上传时派生尺寸 + 焦点裁切

> 状态：**设计已定，未实施**
> 创建日期：2026-08-27
> 来源：用户提出「想对『按类型浏览』和『热门商圈』的图自由配置，以便控制图片质量」
> 编号说明：OPT-058 是缓存 hook 测试 flake，故取 059
> **配套工作项**：`OPT-060`（首页配图可配）。**本工作项必须先上线**，理由见 §8.1。

---

## 1. 一句话

全站每一张图都是**原图直出**——4000px 的原片被整张下载，塞进 168px 高的类型卡里。
「图片质量差」的一半根因不在素材，在渲染管线。

## 2. 证据：三个层面同时缺位

### 2.1 存储层：`Media` 集合没有任何派生尺寸

`src/collections/Media.ts:39` 是光秃秃的 `upload: true`——没有 `imageSizes`、
没有 `formatOptions`、没有格式或尺寸校验。全仓 `grep imageSizes` 在
`src/collections/` 与 `payload.config.ts` 均**零命中**，`payload-types.ts:395-411`
的 `Media` 接口也没有 `sizes` 键。COS 里每个媒体只有原图一个 object。

### 2.2 投影层：DTO 只能表达单一尺寸

`MediaViewModel`（`contracts.ts:31-37`）只有 `src / width / height / alt / blurDataURL`，
由唯一投影点 `mapMedia`（`mappers.ts:346-360`）产出，且**完全不读 `raw.sizes`**。
即使存储层有了派生图，URL 也到不了 C 端。

`focalX` / `focalY` 是同一个故事的另一半：**字段和数据库列早就存在**
（`payload-types.ts:409-410`；迁移 `20260725_103653_m0_schema_sync.ts:276-277`
已建 `focal_x` / `focal_y` 列），但 `MediaViewModel` 未声明、`mapMedia` 未映射，
全仓 `src/`（除生成物外）对它零消费。

> Payload 的 `focalPoint` **默认为 `true` 且独立于 `imageSizes`**
> （`node_modules/payload/dist/uploads/types.d.ts:210-214`）——焦点能力一直都在，
> 只是没有任何人读它。

### 2.3 渲染层：共享原语自己就是裸 `<img>`

`src/components/frontend/ui/Media.tsx:66-77` 渲染原生 `<img>`，`Media.tsx:73`
的注释写着「暂走原生 img，后续接入 next/image」。它的 `blurDataURL` prop
（`Media.tsx:23`）**只声明未使用**。

更麻烦的是它几乎没人用：全仓唯一消费方是 `ListingCard.tsx:5`，另有
**17 个组件直接写裸 `<img>`**，包括本次的两个主角
（`HomeTypeCards.tsx:54`、`HomeDistrictBento.tsx:28`）。

裁剪全靠外部 CSS 的 `object-fit: cover`，且**全前台没有一处 `object-position`**
（唯一现存的是 `styles.css:4702` 的 `bottom`，属 contain 语义）：

| 选择器 | 位置 | 容器尺寸 |
|---|---|---|
| `.sf-media img` | `surface.css:29` | 类型卡 168px 定高（`home.css:191`） |
| `.hm-bento-card img` | `home.css:226` | 480 / 232 / 280 三档（`home.css:220-223`） |

也就是说：**同一张图要同时喂给 480px 高的 bento 大卡和 232px 高的小卡，
而裁哪一块完全不可控（恒为居中）**。

## 3. 目标与非目标

**目标**：让首页两个区块（及全站复用同一原语的地方）拿到尺寸合适、格式现代、
裁切可控的图片，且**上线瞬间前台零变化**。

**非目标**：
- 不迁移其余 15 个裸 `<img>` 组件——原语就位后逐个迁移，塞进这次会把回归面撑到不可验证；
- 不回填存量图片（§7）；
- 不引入 `next/image`（§4，已裁定）。

## 4. 关键裁定：为什么不是 `next/image`

`next/image` 的运行时优化器能拿到两样修正案拿不到的东西：按 `Accept` 头发 AVIF
（比 WebP 再小 20~30%）、按设备宽度取更细的档位。**但它在本项目的部署形态下要付两笔额外成本**：

1. **冷缓存税打在 LCP 上**。优化产物缓存在 CloudRun 实例的临时盘，实例回收、
   扩缩容、**每次发版**都清零。而本仓库是「合并 master 即上线」的高频部署
   （见根 `CLAUDE.md`「合并到 master 即上线」），每次上线后每实例每图的首次请求
   都要拉整张原图回容器、sharp 现算，和 SSR 抢同一份 CPU。
2. **自我流量放大**。`payload.config.ts:415-419` 保留了 Payload 文件路由与
   access control（未设 `disablePayloadAccessControl` / `generateFileURL`），
   故 `doc.url` 恒为同源 `/api/media/file/<filename>?prefix=media`。优化器每次
   未命中要打回自己的 API 路由过一遍权限逻辑再回源 COS——同一张图在容器里走两遍，
   且**拉的是整张原图（3~5MB）而不是派生图（约 300KB）**。

**成本对比**（万张房源图量级）：

| | 本方案（上传时派生） | `next/image` 运行时优化 |
|---|---|---|
| COS 存储 | +6~8%（约 3GB，≈0.3 元/月） | 0 |
| CloudRun CPU | 上传时一次性 | 每次发版后全量重算 |
| COS→容器回源 | 每图一次 | 每实例每图每次缓存失效拉整张原图 |
| 用户体验 | 恒定 | 每次发版后图片慢一阵 |

结论：`next/image` **并不更省钱，它把成本从「看得见的存储」挪到「看不见的
CPU 和流量」，还附送体验抖动**。派生图的生命周期由插件自动管理（§6.4），
管理成本为零。

**会改推 `next/image` 的条件**（当前均不满足，记录以备将来）：优化产物有跨实例的
持久缓存（如前置能缓存 `/_next/image` 的 CDN）；或部署频率大幅降低。
若日后成本敏感度提高，正确的下一步也**不是**运行时优化器，而是腾讯云
**数据万象**（URL 参数在存储侧完成缩放/转格式，容器零参与）——但那要求把媒体从
「Payload 路由回源」切成「COS 直链」，是独立的架构变更，不搭本次的车。

> 附带发现：`next.config.ts:20-27` 的 `images.remotePatterns` 是
> `{ protocol: 'https', hostname: '**' }` 全通配，使 `/_next/image` 成为任意
> https 源的公开图片代理（可刷带宽 / SSRF 探测）。**与本工作项无关但应尽快收敛**，
> 已另开任务处理。

## 5. 方案

### 5.1 存储层：`Media` 配 `imageSizes`

三档**宽度型**派生（不裁剪、保持原比例，裁剪交给 CSS），统一输出 WebP：

| 档位 | 宽度 | 用途 |
|---|---|---|
| `thumb` | 320w | 移动端、小缩略 |
| `card` | 768w | 卡片链路默认（§5.2） |
| `hero` | 1600w | bento 大卡、详情大图 |

宽度型而非定尺寸裁剪，是因为 bento 三种坑位（480/232/280）比例各不相同，
**一份派生图配合 focal 定位可以通吃**。加 `withoutEnlargement`：小于目标宽度的
原图跳过派生，不做无意义放大。

约束：
- 属 collection 变更 → 必须 `payload migrate:create` 生成显式迁移
  （生产 `push: false`；`.githooks/pre-commit` 会拦「改 collection 不带迁移」）；
- 须 `pnpm generate:types` 重生成 `payload-types.ts`，提交前核对
  `grep -c prefix` 必须是 2；
- **`Media.ts:26-37` 的 `prefix` 字段与其 `defaultValue` 不可顺手移除**——
  它是本地/CI（无 COS）环境不 500 的前提，理由见该处注释与迁移
  `20260805_cos_media_prefix`。

### 5.2 投影层：DTO 扩展，但守住 OPT-047 的 2MB 教训

`MediaViewModel` 追加两个**可选只读**字段（追加形态，不动 `src` 语义）：

- `srcSet?: string`——派生图的 srcset 串；
- `focal?: { x: number; y: number }`——`focalX/focalY` 为 `null` 时**整个字段不写**
  （否则渲染出 `object-position: null% null%` 会让整条声明失效）。

`mapMedia` 对**每个 size 的 url 单独过一遍 `normalizePublicMediaUrl`**——
派生图 URL 与主图同构（COS 模式下插件 `afterRead` 同样追加 `?prefix=media`，
故能通过 `media-url.ts:10-13` 的同源路径分支），但不能因此就信任未校验的值直出 DTO。

**卡片链路不带 `srcSet`。** `OPT-047`（`mappers.ts:552-583`）记录过一次生产事故：
列表页 `unstable_cache` 的条目实测 2,278,117 字节、超过 Next.js 的 2MB 硬上限，
**写入被静默拒绝**（页面照常 200，只有一行 stderr），`revalidate: 300` 失效、
每请求真打库。单卡约 2160 字节，其中 `coverImage` 占 541（25%），且封面在
`card.coverImage` 与 `card.building.coverImage` **各存一份**。

所以在 OPT-047 剔 `blurDataURL` 的同一处（`mappers.ts:566`），把卡片封面的
`src` **直接替换成 `card` 档派生图的 URL**，并剔掉 `variants`：

- **大头是换值不是加字段**——`src` 原地替换、`variants` 整个丢弃，不会重蹈超限覆辙；
- 列表页却从原图直出变成 768w WebP。

**唯一的净增长是 `focal`**（约 22 字节/卡，1000 张卡约 22KB，占 2MB 上限约 1%）。
保留它**不是因为它现在就在用**——`styles.css` 的 `.listing-card__media img`
（约 889 行）没有 `object-position: var(--focal-x, …)`，`.sf-media` 的其它调用方
（`ListingResultCard` / `ListingResultRow` / `BuildingResultCard` /
`BuildingCardMini` / `HomeSupplyCard` / `BuildingCompactRow`）也都还是裸 `<img>`、
不发焦点变量，卡片链路里这 22 字节/卡目前没有任何消费方。保留的理由是**为后续
组件逐个迁移到共享原语预留**——体积占比约 1%，不值得等到那时候再改一轮 DTO。
（`building.coverImage` 已被 OPT-047 的解构整个丢弃，故只增一份而非两份。）

完整 `srcSet` 只进**首页十张封面卡**与**详情页**——两者不是不受 2MB 上限约束
（`getCachedHomepage`、详情页缓存查询同样走 `unstable_cache`，同受这条硬上限
约束），而是体积够小（量级几 KB，远低于上限），不构成风险。别把这两条链路
当成可以随便加字段的例外。

### 5.3 渲染层：升级共享原语 + 两区块接入

- `ui/Media.tsx` 学会渲染 `srcset` / `sizes`，并把 focal 注入为 CSS 自定义属性；
- **两条** cover 语义的共享规则加
  `object-position: var(--focal-x, 50%) var(--focal-y, 50%)`——
  `surface.css:29`（类型卡）与 `home.css:226`（bento）；
- `HomeTypeCards.tsx:54`、`HomeDistrictBento.tsx:28` 的裸 `<img>` 换用共享原语。

> **为什么只有两条。** `list.css:193`（`.bd-row__thumb img`）与 `home.css:129`
> （hero poster）服务的组件本轮不迁移（`BuildingCompactRow` / `HomeHeroMedia`），
> 不会发出 `--focal-x` 变量——给它们加 `object-position: var(--focal-x, 50%)`
> 是**只有回退值生效的死 CSS**。随各组件迁移时再加。
>
> `.sf-media img` 被六处调用共享，加变量后未迁移的调用方同样不发变量、
> 落到 `50% 50%`，行为不变。

**contain 语义的明确不套 focal**：`SiteHeader.tsx:49` 的 logo、`styles.css:1741/4701`、
`DetailGallery.tsx:470`（看大图场景）。`styles.css` 是 5000+ 行的旧文件，
其中 11 处 `object-fit: cover` 需按选择器反查消费组件后再决定是否改，
**不做全局替换**。

**留给 hero 迁移时的坑**（本轮不涉及）：`home.css:129` 同一条规则同时管 hero 的
poster 与 `<video>`。将来迁移 `HomeHeroMedia` 时须把 poster 的选择器拆出来单独加
`object-position`——video 没有分焦点的等价语义，focal 只应作用于 img/poster 层。

### 5.4 已知交互：blur 插件会多跑几次 sharp

`blurDataUrlsPlugin`（`payload.config.ts:527-536`）的 `beforeChange` 会枚举
`payloadUploadSizes` 并对每个 image 文件覆写**同一个** `data.blurDataUrl`。
加了 `imageSizes` 后它会对每个派生尺寸各跑一次 sharp，最终 `blurDataUrl`
来自最后枚举的那个尺寸而非原图。

视觉上无差（32px 缩略再 blur，源是哪档都一样），上传时多几次小图 sharp 可接受。
**记录在案、本次不做处理。**

## 6. 影响与风险

### 6.1 上传耗时（唯一的用户可感成本）

派生图生成**同步发生在上传请求里**：sharp 三次缩放 + WebP 编码，再向 COS 上传
4 个文件而非 1 个。对一张 3~5MB 的手机照片，预估多 **0.5~2 秒/张**；COS 上传
派生图是同地域小文件，几十毫秒级可忽略。

用户上传的体感大头是「原图从自己的网络传到服务器」（本来就是几秒），
所以变化是「进度条走完后转圈多转一秒左右」。

注意：**今天上传已经在跑 sharp 了**（blur 插件），本次是把「一次」变成「四次」，
不是从零引入处理环节。

若 §9 的实测超出预期，旋钮（不影响设计骨架）：砍掉 `thumb` 档、
降低 WebP 编码 `effort`（速度可提数倍、体积差 5% 以内）、
收紧 `withoutEnlargement` 的适用面。

### 6.2 前台零变化（刻意设计）

上线瞬间：存量图无派生 → `srcSet` 缺失 → 回落原图 `src`；`focalX/focalY`
全为 `null` → 不写 `object-position` → 落到 CSS 默认 `50% 50%`，
**恰好等于今天 `object-fit: cover` 的行为**。

### 6.3 跨环境 URL 形态不一致

本地存储与 COS 模式下 url 形态不同（带不带 `?prefix=media`），且 COS 关闭时
插件完全不注入 size url 的 `afterRead`。**测试须按契约断言（可归一化、路径前缀），
不做字符串全等断言**——`normalizePublicMediaUrl` 对绝对 URL 返回
`url.toString()`（WHATWG 规范化，可能与原串不严格相等）。

### 6.4 派生图的生命周期无需人工管理

已读插件源码确认：`plugin-cloud-storage/dist/hooks/afterDelete.js` 在删除媒体文档时，
把主文件与 `doc.sizes` 中**全部派生文件一并从 COS 删除**。桶里不会积孤儿文件。

### 6.5 客户端组件边界

`client-components-no-server-imports.test.ts:98` 有传递闭包守卫。若原语升级涉及
客户端组件，映射必须在服务端完成、只把纯 DTO 传下去，**不能让客户端组件
import `site-settings.ts`**，否则守卫红且 `next build` 失败。

## 7. 存量图片：不回填（已裁定）

**理由不是"太麻烦"，而是收益结构决定的**：画质收益的大头来自
「不再把原图整张塞进小卡」与「裁切可控」，而后者（focal）对存量图**立即可用**
——字段和列都在，默认 50/50 等于现状，运营想调随时调。

至于派生尺寸：`OPT-060` 上线后运营**本来就要重新挑选并上传首页那十张图**
（5 张类型卡 + 5 张商圈封面），重新上传即天然走新管线——比写 backfill 脚本便宜得多，
且是本来就要做的动作。

其余存量图回落原图 `src`，行为等于今天。

## 8. 实施顺序

### 8.1 本工作项必须先于 OPT-060 上线

反过来的话，运营在 OPT-060 上线后配的那批图，上传时 `imageSizes` 还没生效、
不会有派生图，等本工作项上线后**还得再传一遍**。先铺管线，运营第一次上传就一次到位。

### 8.2 部署形态无需改动

`Dockerfile:36-37` 有意采用完整镜像（非 standalone，因 standalone 产物不含
`src/migrations` / `tsx` / payload CLI，无法容器内跑迁移）。sharp `^0.34.4`
在 `dependencies`（`package.json:71`）、`@img/sharp-linux-x64` 在
`Dockerfile:4,10` 的 deps 阶段装入、`payload.config.ts:406` 显式传入——
**运行时已可用，不需要为本工作项切 standalone**。

## 9. 验收

常规（typecheck / 单测 / 迁移）之外，以下四项**必须在浏览器里实际做**
（见根 `CLAUDE.md`「完成前必须在浏览器里实际走一遍」）：

1. **焦点选择器眼见为实**：用 `scripts/seed.ts` 的 E2E 夹具账号登录后台，
   确认 Payload 的焦点选择器**确实出现在媒体编辑抽屉里**。
   （`focalPoint` 默认 `true` 是从类型定义读到的，界面行为须实测。）
2. **两个断点各验**：`home.css:210` 在 ≤767px 把类型卡图片 `display: none`、
   bento 三档高度统一成 232px（`home.css:238-241`）。**桌面绿不等于移动绿。**
3. **上传耗时对比**：后台传同一张 5MB 照片，记录改动前后耗时，用实测数确认
   §6.1 的估算；超出预期就动那几个旋钮。
4. **`srcSet` 真的生效**：新上传的图在 C 端应发出 768w WebP 而非原图；
   存量图应回落原图且不报错。

**本地验之前先 `pnpm exec payload migrate`**——本地库落后于 `src/migrations/`
会看到「缺列 500 → 页面降级」的假象，把结论带偏。

证据存 `artifacts/verification/OPT-059/`，长日志与截图不粘进对话或 PR 正文。

## 10. 测试影响面（已核实）

| 文件 | 影响 |
|---|---|
| `tests/preflight-migrations.test.ts:44` | 迁移计数是**精确相等断言**，本工作项 bump 一次（写作当日为 `67`，即 `src/migrations/` 下除 `index.ts` 外的 `.ts` 数——注意有 3 个文件名含 `indexes`，别数错），并续写 30-42 行的清单注释 |
| `tests/frontend-mappers.test.ts:276-330` | `mapMedia` 现有断言逐字段、**无整对象 `toEqual`** → 不破坏；需补 `srcSet`/`focal` 新用例，各档 URL 沿用 307-314 的不安全 URL 过滤断言 |
| `tests/frontend-media-fallback.test.ts` | 占位文案断言（读源码字符串）→ 不动文案即不破坏；`srcset`/focal 行为在此补新用例 |
| `src/test/frontend/payload-documents.ts:32-44` | `makeMedia` 夹具需支持 `sizes` / `focalX` / `focalY` |
| `tests/client-components-no-server-imports.test.ts:98` | 见 §6.5 |

`imageSizes` / `focal` 今天在 `tests/` 与 `src/collections/Media.ts` 均零覆盖
——属**新增测试**而非更新测试。

---

## 11. 实施后的遗留事项（2026-08-27 落地时登记）

分支 `feat/opt-059-image-pipeline-4b3c`，11+3 个提交。六个任务各自过审，最终全分支
审查另抓到一个**跨任务缺陷**（类型卡的 srcset 链路整条是死的——`typeSummaries` 的
封面取自被 `mapListingCard` 收窄过的卡片，`variants` 早被剔掉；六轮逐任务审查全没
看见，因为它跨在两个任务的接缝上），已修复并补了正反两条断言。

以下是**明确搁置**的事项，按优先级：

### 11.1 视觉验收未完成（必须在 OPT-060 上线前补）

三张截图（`desktop.png` / `mobile.png` / `focal-effect.png`）因执行环境的
Browser pane 不合成帧而无法产出。已完成的是**机制证据**：焦点选择器的渲染后 DOM、
新图走 `.webp` 派生档 / 存量图回落原图的真实网络请求、两个断点的
`getComputedStyle` 实测值。**没有证据支撑的是视觉结论**——「裁切构图合理、无拉伸」
「焦点偏移后肉眼能看出裁切确实偏了」。

补做步骤（不依赖当时的会话上下文）见
`artifacts/verification/OPT-059/VISUAL-VERIFICATION-PENDING.md`。

**为什么可以先合并、但必须在 OPT-060 前补**：这三项要验的东西只有在**运营新上传
图片并设焦点之后**才可能出问题；而上线瞬间存量图零变化已由回落契约 + 单测 +
网络请求证据覆盖。OPT-060 正是「让运营开始配图」的那一步。

### 11.2 图片加载失败时的观感变了（错误路径）

改动前两处是裸 `<img>`，失败就露出卡片的 `#8e8e93` 灰底；现在共享原语的
`errored` 分支会渲染 `.media-placeholder`（浅色渐变 + 图标 + 「图片加载失败」文案）。
**bento 卡的商圈名是白字**，压在浅色占位块上只有 `sf-scrim` 一层兜底，对比度掉档，
且多出一段与卡片主体重复的可见文案。

与之相关的还有一条：`HomeTypeCards` 的 `<span class="sf-media">` 内会渲染出
`<div class="media-placeholder">`，属 HTML5 无效嵌套（浏览器不重排、无 hydration
mismatch，只有校验器报错）。

**两条一起修最省**：把占位块改成 `<span>` + `display: grid`，嵌套与配色一次解决。
只在错误路径触发，故未阻塞合并。

### 11.3 可选的小改进

- `mappers.ts` 里 `raw.sizes` 那个 `Record<string, RawSize>` cast 是多余的。
  **去掉它反而更安全**：`payload-types.ts` 生成的 `Media['sizes']` 已是
  `{thumb?/card?/hero?}` 的精确形状，去 cast 后**改档位名会变成编译错误**——
  等于把「档位名对不上 → 静默失效」这条风险从测试兜底升级为编译器兜底。
- `tests/frontend-media-fallback.test.ts` 缺一条「传了 `sizes` 但无 `variants`」
  的用例（实现是对的，纯覆盖盲区，约 5 行）。经变异测试确认这个洞是真的。
- `Media` 的 `upload` 没设 `adminThumbnail: 'thumb'`，后台素材库列表仍在下载
  原图。一行的收益。
- `HomeDistrictBento` 的 `BENTO_SIZES` 键类型是 `Record<string, string>` 而非
  `sizeClass` 的字面量联合——拼错不会被 TS 抓住，只会静默落到兜底值。
- bento 三档的 `sizes`（`62vw` / `32vw` / `47vw`）只有 1440 视口一个实测点，
  其余是手算反推取安全上界。复审独立核算确认**不存在选到更小档位的糊图风险**，
  仅在 vw≈1232–1239 这个约 7px 宽的窗口里 main 卡会选 768 档而非 1600 档，
  实际放大约 0.5%，肉眼不可感知。
