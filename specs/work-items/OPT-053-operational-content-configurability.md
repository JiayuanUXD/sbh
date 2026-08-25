# Task Packet：OPT-053 前台运营内容后台化——站点设置 Global + 已有能力接线

> 状态：**设计已定，未实施**
> 创建日期：2026-08-26
> 来源：用户提出「把前台的运营属性内容做成后台可配置」，并反馈「Hero 文案配了不生效」
> 编号说明：OPT-052 是 domain 错误在后台被吞，故取 053
> **前置依赖**：等 `fix/listing-price-unit-pushdown-9e41`（前端分支）合入 master 后开工。
> 理由见 §9。

---

## 1. 一句话

运营想改前台的品牌标识、首屏文案、推荐商圈，现在**每一项都要改代码发版**；
而少数几项虽然后台有配置入口，**前台根本不读**——运营填了没反应，比没有入口更糟。

## 2. 证据：三类缺口，性质完全不同

### 2.1 A 类：后台有入口，前台不生效（最伤运营信任）

`CitySiteProfiles`（后台「区域管理 → 城市站点配置」，`navigation-config.ts:88`）
的「首页内容」tab 里有一整组 Hero 字段。运营填完，**首页纹丝不动**：

| 后台字段 | 首页 `/{city}` | 未开城页 | 根因 |
|---|---|---|---|
| Hero 标题 | ❌ 不生效 | ✅ 生效 | `HomeHero.tsx:27` 写死常量 |
| Hero 正文 | ❌ 不生效 | ✅ 生效 | `HomeHero.tsx:28` 写死常量 |
| Hero 媒体 | ⚠️ **生效但行为错**（§2.5） | ✅ 生效 | `HomeHeroMedia.tsx` 的图/视频互斥逻辑 |
| 精选区域 | ❌ 首页 bento 没接 | ✅ 生效 | `HomeDistrictBento` 走 `recommendedOrder` |

`HomeHero.tsx:7-26` 的注释记录了 **2026-08-21 的产品裁定**：故意不接
`city.profile.hero.*`，原文「因此**不要**把它接回」，理由是「全站共用一句，
不按城市定制」。

**裁定本身没错，错的是后台字段的标签在撒谎**——它叫「Hero 标题」，
运营没有任何线索知道它只作用于未开城页。

### 2.2 B 类：真缺配置层

平台级品牌内容全部硬编码，且**没有任何全局配置 Global**（只有一个
`AdvisorServiceHours`，管服务时段）：

| 位置 | 内容 |
|---|---|
| `SiteHeader.tsx:32` | 文字标识 `商办租赁`（无图片 logo） |
| `SiteFooter.tsx:59` | `© {year} 商办租赁平台` |
| `SiteFooter.tsx:60` | `上海 · 商务办公租赁` ← **见 §2.4，这是 bug** |
| `HeroSummaryPanel.tsx:99` | `页面价格为公开挂牌价，实际价格以顾问报价为准` |
| `DetailGallery.tsx:363,371` | `示意图，以现场实际情况为准`（两处） |
| `HomeValueProps.tsx:7` | `VALUES` 三条价值主张 |
| `HomeTypeCards.tsx:12` | `TILES` 五张类型卡文案 |
| `public-nav.ts:22` | `MAIN_NAV_ITEMS` 主导航六项 → **归 `OPT-054`** |
| `public-nav.ts:32` | `FOOTER_COLUMNS` 页脚三组 → **归 `OPT-054`** |

合规类（价格免责、示意图声明）的优先级此前被低估：**法务一句话要改，
硬编码就意味着走一次完整发版**。

### 2.3 C 类：兜底遮蔽，运营没有反馈回路

前台对空值有硬编码兜底（如 `ComingSoonCityView.tsx:102`）。后果是
「没配置」和「配置了但值相同」在页面上完全一样——运营无法自证配置生效，
于是也没有动力去填。`ComingSoonCityView.tsx:42` 的注释直陈
「本地库 7 个 profile 全空」。

### 2.4 顺带捞到的 bug：页脚城市名写死

`SiteFooter.tsx:60` 是字面量 `上海 · 商务办公租赁`。这是**七城平台**——
访问 `/beijing`、`/shenzhen`，页脚照样说「上海」。

这不是「不可配置」，是错的。本工作项一并修掉。

---

### 2.5 Hero 背景媒体：配了有反应，但反应是错的

用户 2026-08-26 报「Hero 媒体也不生效」。核实结论：**配置确实被读取，
但 `HomeHeroMedia.tsx` 的图/视频互斥逻辑让运营得到的不是预期效果。**

```tsx
// HomeHeroMedia.tsx:38-47（摘要）
<img src={poster?.src ?? HERO_POSTER_SRC} alt={poster?.alt ?? ''} />
{!poster && loadVideo && (
  <video ...><source src="/api/media/file/hero-bg.mp4?prefix=media" /></video>
)}
```

四个独立问题：

| 问题 | 位置 | 后果 |
|---|---|---|
| **配了图片 → 视频背景消失** | `HomeHeroMedia.tsx:44` 的 `!poster &&` | 运营想换张底图，实际把动态视频关掉了。**这最可能就是用户感知的「不生效」** |
| **配了视频媒体 → 破图** | `HomeHeroMedia.tsx:39` 无条件塞进 `<img>` | 视频 URL 进 `img` 标签。本地库里有视频媒体，很容易被选中 |
| **背景视频完全不可配** | `HomeHeroMedia.tsx:45` 硬编码 `/api/media/file/hero-bg.mp4?prefix=media` | 运营无法换视频 |
| **兜底图不可配** | `hero-poster.ts:11` 的 `@/assets/hero-poster.jpg` | 构建产物，改一次要发版 |

**一条看似严重但实际不影响线上的**：`page.tsx:42` 的根路由传 `routeMode="legacy"`，
`HomeHero.tsx:41` 因此把 poster 置 `null`。但多城市模式下 `/` 会
`redirect` 到 `/{默认城市}`（`page.tsx:26-32`），**legacy 分支在生产是死代码**。

> 生产环境 `MULTI_CITY_ROUTING_ENABLED=true`（2026-08-26 经 CloudRun 服务配置核实，
> 线上版本 `sbh-112`）。**不要把 legacy 分支当 bug 修**——它是单城市模式的保留路径。

### 2.6 结论

Hero 背景媒体要**拆成图片与视频两个独立配置项**，取代现在「配了图就没视频」
的互斥逻辑。详见 §4.5。

---

## 3. 范围裁定

用户 2026-08-26 逐项确认。

### 3.1 本轮做

1. 新建 `SiteSettings` Global：品牌 / 合规 / 页脚 三个 tab（§4）
2. `SiteHeader` / `SiteFooter` 接 Global，**并修掉 §2.4 的城市名 bug**
3. Hero 主副标题接 Global（满足 2026-08-21 裁定的「全站共用一句」语义）
4. `CitySiteProfiles` 的 Hero 文案字段**改标签 + 加说明**（方案 a，见 §6）
5. 首页热门商圈 bento 与 Hero chips 接 `featuredRegions`（§7，零 schema 变更）
6. 「按类型浏览」五卡文案可配（`type` 枚举保持代码绑定）
7. 图片 logo（用户明确要求本轮做）
8. **Hero 背景图与背景视频拆成两个独立配置项**（§4.5），修掉 §2.5 的互斥逻辑

### 3.2 本轮明确不做

| 不做项 | 理由 |
|---|---|
| **页脚分组与主导航配置** | 用户 2026-08-26 裁定**拆为 `OPT-054` 单独一轮**。它的难点是路由池约束设计（自由填 `href` 必然产生静默死链），与本轮的内容配置是两类问题，且工作量约占原范围三分之一 |
| **根路由 `legacy` 分支的 poster 置空** | 生产走多城市模式，`/` 会重定向，该分支是死代码。见 §2.5 末尾 |
| **UI 微文案**（`图片暂未加载`、`清除全部条件`、各 placeholder） | 产品文案不是运营内容。进后台只会制造运维负担与翻车面——运营填空，按钮就没字了 |
| **区块标题**（`核心商圈房源`、`按类型浏览`） | 改动频率极低，不值一张表 |
| **首页区块顺序 / 显隐** | bento 有 5/3-4/1-2/0 张的降级规则、rail 有数量约束。开放配置会直接打穿布局 |
| **城市级品牌覆盖字段** | 用户选定「全局一套」。`CitySiteProfiles` 本就是城市覆盖层，读取层预留合并点即可；现在建覆盖字段是给零需求付表结构成本 |
| **`OPT-042` 多实例缓存失效** | 用户 2026-08-26 裁定本轮绕过，写清约束。见 §5.3 |

---

## 4. 数据模型：`src/globals/SiteSettings.ts`

slug `site-settings`。四个**展示型 tab**（品牌 / 合规 / 页脚 / 首页区块；
展示型 tab 不产生嵌套表，仍是单张 `site_settings` 表，`array` 字段除外——
`valueProps` 与 `typeCards` 会各自生成一张子表）。
结构照抄 `AdvisorServiceHours` 的成熟写法：`access.read: () => true` +
每字段 `defaultValue` + 后台 `admin.description` 写明作用位置。

### 4.1 品牌 tab

| 字段 | 类型 | `defaultValue` | 说明 |
|---|---|---|---|
| `siteName` | text | `商办租赁` | Header 文字标识 |
| `slogan` | text | 取自 `HERO_BODY` | **首屏搜索框上方副标题**（用户指定位置） |
| `heroHeading` | text | 取自 `HERO_HEADING` | 首屏搜索框上方主标题 |
| `logo` | relationship → media | 空 | **空则回落到 `siteName` 文字**——这是现状，不是降级 |

> `heroHeading` / `slogan` 放在品牌 tab 而非单独 tab，因为它们和 `siteName`
> 同属「平台对外的第一句话」，运营改品牌时会一起改。

### 4.2 合规 tab

**具名字段，不用 key-value 数组。** 理由：合规文案的展示位置写死在代码里，
数组的灵活性是假的——新加一条没有对应展示位的文案，前台根本不会渲染它，
而运营填错 key 是静默失败。代价是**后续加一条 = 一条新迁移**，已与用户确认接受。

| 字段 | `defaultValue`（取自现有硬编码） | 消费点 |
|---|---|---|
| `priceDisclaimer` | `页面价格为公开挂牌价，实际价格以顾问报价为准` | `HeroSummaryPanel.tsx:99` |
| `imageDisclaimer` | `示意图，以现场实际情况为准` | `DetailGallery.tsx:363,371`（两处共用） |

### 4.3 页脚 tab

| 字段 | `defaultValue` | 渲染 |
|---|---|---|
| `copyrightHolder` | `商办租赁平台` | `© {year} {copyrightHolder}` |
| `footerTaglineSuffix` | `商务办公租赁` | `{当前城市名} · {suffix}` ← **修掉 §2.4** |

城市名取自路由上下文（`CityContext`），不是配置项——它本来就该跟着路由走。

### 4.4 首页区块 tab（§3.1 第 6 项）

| 字段 | 类型 | 约束 |
|---|---|---|
| `valueProps` | array（`no` / `name` / `body`） | 默认值取 `HomeValueProps.tsx:7` 的三条 |
| `typeCards` | array（`label` / `sublabel` / `visible` / 顺序） | **`type` 与 `href` 不开放**——它们绑定 `Listings.listingType` 枚举，运营改了就是死链或空结果 |

`typeCards` 的每一项以固定 `type` 为主键（代码侧定义五个槽位），
运营只能改它的展示文案与显隐。**新增槽位需要发版**，这是有意的。

### 4.5 Hero 背景媒体：图与视频解耦

修掉 §2.5 的互斥逻辑。字段放 `CitySiteProfiles`（背景媒体本就该逐城不同，
与 §3.2「不建城市级品牌覆盖字段」不冲突——这不是品牌层）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `heroMedia`（现有，改标签为 **`Hero 背景图`**） | relationship → media | 加 `filterOptions` **只允许图片类型**，堵死 §2.5 的破图 |
| `heroVideo`（**新增**） | relationship → media | 只允许视频类型。空则回落到现有硬编码 `hero-bg.mp4` |
| `heroVideoEnabled`（**新增**） | checkbox，`defaultValue: true` | 「首屏播放背景视频」。关掉则只渲染背景图 |

渲染逻辑改为**图与视频各自独立取值**：

```
<img  src = heroMedia?.src ?? HERO_POSTER_SRC />

<video> 渲染条件 = heroVideoEnabled && loadVideo
        （loadVideo 仍受 reduced-motion / 移动端 / saveData 三个既有闸门约束）
  src     = heroVideo?.src ?? '/api/media/file/hero-bg.mp4?prefix=media'
  poster  = heroMedia?.src ?? HERO_POSTER_SRC   ← 与 <img> 同源，不再各写一份
```

关键差异：**渲染条件里不再有 `!poster`**。图片是视频的封面与降级底图，
本来就该同时存在——现在的 `!poster &&` 把两者做成互斥，是实现错误。

「只要静态图、不要视频」由 `heroVideoEnabled` **显式表达**。
拆解互斥逻辑等于拿掉了原来那个隐式开关（配图 = 关视频），
不补这个字段就是在修一个缺口的同时开另一个。

> `filterOptions` 限制媒体类型是本节最容易被漏掉的一条。不加，
> §2.5 的破图会以另一种形式复发（运营在「Hero 背景图」里选视频）。

---

## 5. 读取链路与缓存

logo 与页脚出现在**每一个页面**上，这是整个设计最容易出事的地方。

### 5.1 单次读取

在 `(frontend)/layout.tsx` 层读一次，经 props 下发。
**绝不允许各组件自行 `findGlobal`**——那是每页 N 次 DB 往返。

复用 `src/lib/frontend/cached-queries.ts` 的既有模式，与
`service-schedule.ts:46`（现有的 `findGlobal` 消费点）保持一致口径。

### 5.2 三层兜底

```
Global 存值  →  字段 defaultValue  →  组件内硬编码常量
```

第三层**必须保留**：`site_settings` 表在迁移执行前不存在，
构建期与迁移前的渲染不能崩。这也让本工作项可以分两次发布（§9）。

### 5.3 已知约束：多实例失效不保证（`OPT-042`）

CloudRun 多实例下，一个实例改了配置，**其他实例的缓存不会失效**。
运营改完 logo，可能要等缓存自然过期才全站一致。

- 这不是本工作项引入的问题，但**本工作项显著放大它的可见度**：
  以前失效滞后的是房源列表，现在是 logo。
- 本轮**不修**（用户 2026-08-26 裁定），按 `OPT-042` 自己的工作项独立解决。
- 缓解：站点配置属低频数据，TTL 设为 **60 秒**并接 `public-cache-revalidation.ts`
  的 `afterChange` 失效。单实例下即时生效，多实例下最坏 60 秒收敛。
- **后台必须写明这一点**：Global 编辑页加 `admin.description`
  「保存后最长 60 秒全站生效」。不写，运营又会得到一次「配了不生效」的体验——
  那正是本工作项的起因。

---

## 6. `CitySiteProfiles` Hero **文案**字段的处置（方案 a）

> 只管标题 / 眉题 / 正文三个文案字段。背景媒体字段见 §4.5。

用户 2026-08-26 选定方案 a。**保留字段，改标签与说明**：

| 现标签 | 改为 | 加 `admin.description` |
|---|---|---|
| `Hero 眉题` | `未开城页 Hero 眉题` | 「仅用于该城未开通服务时的招募页。已开城首页的文案在『站点设置 → 品牌』里改。」 |
| `Hero 标题` | `未开城页 Hero 标题` | 同上 |
| `Hero 正文` | `未开城页 Hero 正文` | 同上 |
| `Hero 媒体` | → `Hero 背景图`（见 §4.5，**不加 `未开城页` 前缀**——它首页也生效） | 「首页与未开城页共用的背景图。视频另设字段。」 |

未考虑的两条及否决理由：

- **b）改成 Global 打底 + 城市覆盖**：直接违反 2026-08-21 产品裁定，
  且重新引入它当初要避免的问题（各城 H1 口径不一致、改一句话要改七遍）。
- **c）移除字段、未开城页也读 Global**：未开城页文案本就带城市名
  （`商办租赁即将登陆{城市}`），移到全局会丢掉这个能力。

**纯字段标签改动，不产生迁移**（`label` / `admin.description` 不进 schema）。

---

## 7. 热门商圈接 `featuredRegions`（零 schema 变更，性价比最高）

### 7.1 现状

`HomeDistrictBento.tsx:5-13` 的卡片按 `recommendedOrder` 排序，
而那是 **`Buildings` 上的字段**——商圈按其下楼盘聚合排序
（`facade.ts:913`）。运营想这个月主推陆家嘴，得去挨个调楼盘的排序值。

`HomeHero.tsx:38` 的热门 chips 同理：`districts.slice(0, 4)`，自动取前四。

### 7.2 改法

`CitySiteProfiles.featuredRegions`（`CitySiteProfiles.ts:241`，关联 locations）
**字段早就存在**，目前只被 `/city-partner` 与未开城页消费。
本项是**纯接线**：

- bento 与 chips 优先读 `profile.featuredRegions`；
- **为空则回落到现有排序**——不摆空货架，也不改变现状行为；
- 复用 `city-context.ts:199` 已有的映射，不新增 DTO。

### 7.3 为什么这一项优先级最高

字段已有、DTO 已有、消费方已有两个先例，**零迁移**。
且它直接解决「运营想主推某商圈却只能绕道调楼盘排序」这个真实效率损失。

---

## 8. 导航配置 → 已拆出为 `OPT-054`

用户 2026-08-26 裁定拆分。理由：`MAIN_NAV_ITEMS` / `FOOTER_COLUMNS`
（`public-nav.ts:22,32`）的 `href` 指向真实路由，做成自由文本框就是静默死链
工厂——Next.js 对不存在的路由渲染 404，不抛异常、不进告警。

它需要的是**预设路由池 + 后台 `select` + 路由池过期守卫**这一整套约束设计，
与本工作项的「内容配置」是两类问题，合在一起会让两边都做不透。

详见 `specs/work-items/OPT-054-nav-configurability.md`。

**本工作项与 OPT-054 的唯一耦合点**：两者都会往 `SiteSettings` Global 加字段。
OPT-054 应在本工作项的迁移落地后再生成自己的迁移，避免同一张表的两条迁移
在快照链上打架（`OPT-048` 在册未解，见 §9.2）。

---

## 9. 迁移与上线顺序

### 9.1 前置依赖：等前端分支合入

`fix/listing-price-unit-pushdown-9e41` 工作树当前有 **8 个已改文件 + 1 个新测试
helper 未提交**，且本工作项要改的 `SiteHeader.tsx` / `SiteFooter.tsx` /
首页组件是它的活跃区域。用户 2026-08-26 裁定：**等它合入 master 再开工。**

### 9.2 迁移风险背景（开工前必读）

- `OPT-048 迁移快照链漂移` 在册未解；
- `TODOS.md` 的 **T1 / T2 未结**：生产已应用但仓库里不存在 4 条迁移，
  且本地 master 领先远端 1 个待推提交需要先插账本行。

**结论**：本工作项**只新增表 + 给 `city_site_profiles` 加两列**——
`site_settings` 主表 + `valueProps` / `typeCards` 各自的 `array` 子表，
外加 §4.5 的 `heroVideo`（可空关联列）与 `heroVideoEnabled`
（boolean，`DEFAULT true NOT NULL`）。

`heroVideoEnabled` 是本工作项**唯一需要写默认值的列**：默认必须为 `true`，
否则迁移一跑，所有已开城首页的背景视频当场消失。
但生成迁移前必须先确认 T1/T2 的状态，**不要在账本不一致的基线上叠新迁移**。

### 9.3 分两次发布

三层兜底（§5.2）让这件事成立：

1. **第一次**：Global 定义 + 迁移 + 后台录入 + 读取层。前台**不接线**，
   零可见变化。运营可以先把内容填进去。
2. **第二次**：前台各组件接线。此时配置已有内容，接线即生效——
   运营第一次看到的就是自己填的东西，不是默认值。

这个顺序直接对治 §2.3 的「没有反馈回路」。

---

## 10. 测试策略

按 `.agent/testing.md` 口径。重点不是覆盖率，是**守住那些会静默失效的东西**：

| 守卫 | 防的是什么 |
|---|---|
| 三层兜底逐层断言（Global 空 / 字段默认 / 组件常量） | 迁移前渲染崩溃 |
| 页脚城市名随路由变化（至少验两个城市） | §2.4 的 bug 复发 |
| `featuredRegions` 为空时回落到原排序 | 空货架 |
| `typeCards` 的 `type` 不可被配置覆盖 | 运营改出死链 |
| `CitySiteProfiles` Hero 文案字段仍只作用于未开城页 | 方案 a 被后续改动悄悄推翻 |
| **配了 `heroMedia` 后视频仍然渲染** | §2.5 的互斥逻辑复发——这是本轮最容易回退的一条 |
| **`heroVideoEnabled=false` 时视频不渲染，且背景图仍在** | 新开关把图一起关掉 |
| **`heroMedia` / `heroVideo` 的 `filterOptions` 拒绝错误媒体类型** | 破图复发 |

浏览器验收：改一次 logo / slogan / 商圈，确认前台生效，
证据存 `artifacts/verification/OPT-053/`。

---

## 11. 未决

- `OPT-042` 解决后，§5.3 的 60 秒 TTL 与后台提示文案应回收。
- 本工作项发布后，`HomeHero.tsx:7-26` 那段记录 2026-08-21 产品裁定的长注释
  需要改写：裁定仍然有效（全站共用一句），但**实现从「硬编码常量」变成
  「读全局 Global」**，原注释里「不要把它接回」的措辞会误导后来者。
