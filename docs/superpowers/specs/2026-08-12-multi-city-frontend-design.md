# 多城市前台适配设计

> 状态：已批准设计（2026-08-12），设计评审修订（2026-08-13）
> 范围：`payload-office-platform` C 端城市路由、城市站点配置、公开查询、缓存、SEO、三类前台申请的城市归属及浏览器验收
> 不包含：本文件不实施代码、不执行生产写入、不开放任何尚未由运营确认的区域或供给数据

## 1. 背景与当前事实

后台地理模块已经具备城市、行政区、商圈、地铁线和地铁站的多城市管理能力，`locations` 已通过 `city` 关系支持按城市查询。上海、杭州、苏州、嘉兴、南京、无锡、宁波七城的地理主数据已经完成导入；导入节点默认 `frontendVisible=false`，所以“数据已存在”不等于“已对前台开放”。

前台当前处于“领域层部分支持城市、页面层仍为单城市”的状态：

- `domain/public-catalog` 的查询输入和 `SearchContext` 已有 `city`，Supply Adapter 也能按 Building 所属城市过滤；但 `SearchContext.city` 是**可选**字段，`supply-adapter.ts` 是 `if (ctx.city)` 才追加过滤 —— **漏传 city 不报错，而是返回全国数据**（fail-open）；
- 公开 DTO（`domain/public-catalog/contracts.ts`）**不包含任何 city 字段**，当前无法从详情结果反查记录所属城市；
- `site-config.ts` 仍把 `SUPPORTED_CITIES` 固定为 `['shanghai']`，且 `resolveDefaultCity()` 对白名单外的 `NEXT_PUBLIC_DEFAULT_CITY` 直接抛错（构建失败）；
- `locations.slug` 全局 unique 但**可编辑**，没有任何不可变约束；
- 前台缓存为模块级 `unstable_cache(...)` 单例，`tags` 在闭包中静态，现状写死 `homeTag('shanghai')` / `facetsTag('shanghai')`；
- `defaultSearchContext()`、公开缓存查询和失效标签仍存在上海默认值或硬编码；
- 首页、页头、页脚、委托和发布页面中仍有上海文案；
- 当前公开路由为 `/listings`、`/buildings` 及其详情页，没有城市路径前缀，也没有城市切换入口；
- `HeroSearch` 虽可接收 `city`，但现有提交流程没有完整保证城市参数贯穿目标 URL；
- Lead 和 Supply Submission 已有城市 relationship，可以复用；“城市合伙人”与需求、供给语义不同，需要新增独立申请池，不能塞入任一既有线索链。

因此本次改造的核心不是再造一套地理查询，而是建立一个可靠的前台城市上下文，并让路由、页面、查询、缓存、SEO 和表单统一消费它。

## 2. 已确认的产品决策

1. 七城入口同时上线；没有有效供给的城市仍提供独立城市页，展示“正在开通”。
2. 城市级页面使用路径前缀：`/{city}`、`/{city}/listings`、`/{city}/buildings`。
3. 新闻和隐私政策保持全局；委托、发布与城市合伙人招募保持全局路径，但继承当前城市上下文。
4. `/` 重定向进入 `/shanghai`，不按 IP 自动选择城市。（产品语义为"永久"；实际状态码在观察期用 307，稳定后再提升为 308，见 §6.3）
5. 筹备城市不借用上海房源；页面提供城市服务说明、可公开区域概览、委托、发布和“成为城市合伙人”入口。
6. 城市内容采用独立站点配置：SEO 和服务状态必填，Hero、简介、联系文案和推荐区域可选，并有共享视觉/文案兜底。
7. 切换城市时保留关键词、面积、租金、类型和排序，清除行政区、商圈、地铁等城市专属筛选。
8. 城市站点运营内容独立于 `locations`，采用与城市 Location 一对一的 `city-site-profiles` 模型。
9. 现有需求/供给双链保持不变；城市合伙人申请作为第三条独立申请链。继续保留“获取选址方案”CTA；供应提交不自动转换或发布，合伙人申请也不自动创建商户、团队、用户或任何公开内容。

## 3. 目标与非目标

### 3.1 目标

- 每个城市级请求只解析一次 `CityContext`，其余页面和服务显式消费该上下文。
- 任何公开供给、facet、推荐和数量都不能跨城市串数据。
- 七城都有稳定 URL；运营可以按城市独立控制 `live` 或 `coming-soon`。
- 旧 URL 有明确兼容重定向，不制造重复 canonical。
- 委托、发布和城市合伙人申请保存用户实际选择的城市，并由服务端重新校验。
- 缓存 key、tag、metadata 和 sitemap 都具备城市维度。
- 桌面、平板和移动端都能清晰、可访问地完成城市切换。

### 3.2 非目标

- 不做 IP 定位、自动城市跳转或浏览器定位授权。
- 不把新闻、隐私政策或其他全局内容复制为七份城市页面。
- 不因本次前台改造批量开放 `locations.frontendVisible`。
- 不把筹备城市标记为已有真实供给，不虚构房源数量、价格、评级或服务承诺。
- 不改变有效供给统一谓词，不建立前台专用的简化供给查询。
- 不改变 Lead 生命周期、Supply Submission 审核/转换规则或自动发布策略；不把合伙人申请的“合作意向确认”解释为已签约或自动转正式业务对象。
- 不在本设计阶段执行生产数据写入、部署或 URL 切流。

## 4. 总体架构

一次城市级请求按以下顺序处理：

```text
/{city}/...
   ↓
resolveCityContext(citySlug)
   ├─ Location(type=city, canonical active record)
   └─ CitySiteProfile(city, switcherVisible, serviceStatus, content)
   ↓
CityContext { id, slug, name, serviceStatus, profile }
   ├─ 路由与 Metadata
   ├─ Header / 城市切换
   ├─ Public Catalog 查询与 Facets
   ├─ Cache key / tag
   ├─ Entrust / Publish / City Partner 城市归属
   └─ Live 页面或 Coming-soon 页面分支
```

### 4.1 CityContext

建议在前台领域边界建立只读 DTO：

```ts
type CityContext = Readonly<{
  id: number | string
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  profile: PublicCitySiteProfile
}>
```

约束：

- 路由和 Server Component 只能通过统一 resolver 获取城市上下文，不能各自查询 Payload；
- resolver 只接受外部 `unknown`，完成 slug 规范化和白名单式校验；
- profile 不存在或关联到非城市 Location 时，城市路径返回 404；`switcherVisible=false` 只隐藏切换器入口，不改变既有 URL；
- 不允许“解析失败则回退上海”，否则错误 URL 会污染查询、缓存和线索归属；
- `/entrust`、`/publish` 只有在完全缺少 `city` 时才使用默认城市上海；显式无效参数必须可见报错并阻止提交。

### 4.1.1 Resolver 的去重与缓存（实施必读）

`layout`、`page`、`generateMetadata` 是三次独立调用，"一次请求只解析一次"必须落到机制而非约定：

- `resolveCityContext(slug)` 用 `React.cache()` 包裹 → 请求内去重；
- 内层 profile 查询走按城市构造的 `unstable_cache`，key 与 tag 均含 `citySlug`，tag 为 `public:city-profile:<citySlug>` → 跨请求复用；
- 不允许任何组件绕过 resolver 直接查 Payload 拿城市。

### 4.1.2 城市白名单的去留（替换 site-config 编译期常量）

多城市后城市集合由数据库驱动，必须同步改造 `lib/frontend/site-config.ts`，否则"运营独立开城"仍需改代码发版，与 §13 阶段 4 矛盾：

- 删除 `SUPPORTED_CITIES` 常量与 `SupportedCity` 类型；
- `defaultCity` 保留为 env（`NEXT_PUBLIC_DEFAULT_CITY`，缺省 `shanghai`），但**校验下沉到运行时 resolver**：启动期解析不到对应 profile 只输出告警，`/` 重定向目标缺失时该请求返回 404，**不再让构建失败**；
- `DEFAULT_CITY` 常量保留，仅作为 `/entrust`、`/publish` 缺省 city 的唯一来源。

### 4.2 职责边界

- `locations` 回答“城市及其行政层级是什么”，保持地理主数据职责；
- `city-site-profiles` 回答“该城市如何在前台运营”，保存状态、SEO 和营销内容；
- `domain/public-catalog` 返回公开 DTO，并复用统一有效供给服务；
- `app/(frontend)` 只负责路由、metadata、页面编排、重定向和错误边界；
- `components/frontend` 只接收 `CityContext` 或 Public Catalog DTO，不直接访问 Payload。

## 5. City Site Profile 数据模型

新增 Payload Collection：`city-site-profiles`，与 `locations(type=city)` 一对一。

### 5.1 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `city` | relationship → locations | 是 | 只能关联 canonical、active、`type=city` 的记录；数据库唯一约束保证一城一份 |
| `serviceStatus` | select | 是 | `live` / `coming-soon` |
| `switcherVisible` | checkbox | 是 | 控制是否出现在城市切换器；与 Location 的前台区域可见性分开 |
| `sortOrder` | number | 是 | 城市切换器稳定排序 |
| `seoTitle` | text | 是 | 唯一页面标题模板，不含站点域名；长度 ≤ 60 字符，且必须包含该城市名（服务端校验），避免七城复制粘贴产生重复 title |
| `seoDescription` | textarea | 是 | 城市级 description；长度 70–160 字符，必须包含该城市名 |
| `heroEyebrow` | text | 否 | 空值使用共享兜底 |
| `heroHeading` | text | 否 | 空值使用包含城市名的共享兜底 |
| `heroBody` | textarea | 否 | 空值使用共享兜底 |
| `heroMedia` | relationship → media | 否 | 复用现有媒体系统和图片失败占位 |
| `introHeading` | text | 否 | 城市服务简介标题 |
| `introBody` | textarea | 否 | 城市服务简介正文，保持短内容和共享组件渲染边界 |
| `contactHeading` | text | 否 | 委托卡片标题兜底覆盖 |
| `contactBody` | textarea | 否 | 委托卡片说明兜底覆盖 |
| `featuredRegions` | relationship[] → locations | 否 | 仅允许同城、active、`frontendVisible=true` 的行政区或商圈；`maxRows: 12`，保证前台渲染边界确定 |

### 5.2 写入校验与生命周期

- `city` 关系必须在服务端验证为城市节点；客户端筛选不是安全边界。
- **城市 slug 是对外 URL 契约，本期方案定档为冻结修改。** `Locations` 增加 `beforeChange` 服务端校验：城市一旦存在关联 City Site Profile，禁止修改 `slug`，后台返回明确错误文案；草拟中和 live 城市采用同一规则，避免先发布筹备页再改 slug 造成断链。本期不增加 `previousSlugs`。该约束未实现前，禁止公开任何城市前缀路由。
- `featuredRegions` 的类型、所属城市、状态和 `frontendVisible` 必须在服务端逐项校验。
- `live` 只表示城市站点采用正式供给体验，不改变 Listing 的有效供给规则。
- 城市无有效供给时，live 列表可以展示真实空结果；不得回退其他城市。
- 已对外公开的 profile 不建议物理删除。`switcherVisible=false` 只停止切换器入口；如果需要关闭既有 URL，必须另行确定 noindex、重定向或下线策略。
- `serviceStatus` 是运营决策，不从瞬时有效供给数量自动推导：筹备城市设为 coming-soon；live 城市短期变为 0 套时展示真实空结果，不自动改变服务承诺。
- profile 变化触发对应城市首页、metadata 和 sitemap 缓存失效；Location 可见性变化触发该城市 facets/首页/区域概览失效。

### 5.3 初始数据与迁移

实现需要两类显式迁移：

1. Payload 生成的 schema migration：创建 collection、关系、索引和 city 唯一约束；生成正文不得手改。
2. 独立、幂等的数据迁移：按 seed 中的不可变城市代码绑定七个 canonical 城市 profile。

初始状态：

- 上海：`live`，复用现有已确认的上海 SEO/首页内容作为初始值；
- 杭州、苏州、嘉兴、南京、无锡、宁波：`coming-soon`；
- 七城均可在切换器显示；筹备城市默认 `noindex,follow`；
- 数据迁移不修改任何 Location 的 `frontendVisible`；
- 如果 canonical 城市缺失、重复或不可变代码不匹配，迁移必须中止并输出人工处理清单，不能按名称猜测关联。

迁移交付必须包含 dry-run、预计/实际影响行数、PostgreSQL 验证和回滚说明。生产应用迁移与七城 profile 数据属于单独获批的发布动作，不由本设计自动授权。

## 6. 路由与兼容策略

### 6.1 Canonical 路由

| 路由 | 行为 |
|---|---|
| `/` | 重定向 → `/{defaultCity}`（状态码见 §6.3） |
| `/{city}` | 城市首页 canonical |
| `/{city}/listings` | 城市房源列表 canonical |
| `/{city}/listings/{slug}` | 城市房源详情 canonical |
| `/{city}/buildings` | 城市楼盘列表 canonical |
| `/{city}/buildings/{slug}` | 城市楼盘详情 canonical |
| `/news`、`/news/{slug}` | 全局资讯，不复制城市路径 |
| `/pages/privacy` | 全局隐私政策 |
| `/entrust?city={city}` | 全局需求流程，携带城市上下文 |
| `/publish?city={city}` | 全局供应流程，携带城市上下文 |
| `/city-partner?city={city}` | 全局城市合伙人招募页，query 只负责预填与归属；canonical 固定为 `/city-partner` |

### 6.2 旧路由兼容

- `/listings` → `/{defaultCity}/listings`，保留合法的通用筛选参数；
- `/buildings` → `/{defaultCity}/buildings`；
- `/listings/{slug}`：先按统一公开详情服务取得记录真实城市，再跳到 `/{actualCity}/listings/{slug}`；
- `/buildings/{slug}`：同理跳到记录真实城市；
- 城市详情 URL 与记录真实城市不一致时，跳到真实城市 canonical；
- 不存在、未公开或失效对象按现有公开详情规则返回 404，不通过重定向泄漏其存在。

旧路由兼容至少保留一个完整 SEO 迁移周期；删除兼容入口需要独立评估日志、外链和索引情况。

### 6.3 重定向状态码分级（不可回滚性约束）

308 会被浏览器**永久缓存**，一旦跳错，用户在清缓存前无法自愈。因此按目标是否可变分级：

| 重定向 | 目标是否可变 | 状态码 |
|---|---|---|
| `/` → `/{defaultCity}` | 静态路径映射 | 阶段 3 上线用 **307**；观察一个完整周期（访问日志无异常 + Search Console 无收录异常）后，作为**独立获批的发布动作**提升为 308 |
| `/listings`、`/buildings` → 城市前缀 | 静态路径映射 | 同上 |
| `/listings/{slug}`、`/buildings/{slug}` → 记录真实城市 | **可变**（楼盘可换城市、房源可换楼盘） | **长期保持 307**，禁止使用 308 |
| 错城详情 URL 纠正 | **可变** | **长期保持 307** |

### 6.4 重定向的实现位置

- 静态路径映射（`/`、`/listings`、`/buildings`）：观察期统一使用页面级 `redirect()`，以便服务端 kill switch 在运行时控制方向；稳定并独立批准提升 308 后，才允许移入 `next.config` 的 `redirects()`；
- 记录派生跳转（详情旧 URL、错城纠正）：页面级 `redirect()`，复用统一公开详情服务的结果，不额外查一次 Payload；
- **不引入 middleware / proxy**：它会拦截包含静态资源在内的全部请求，成本与调试复杂度都高于上述两种方式，且与 CloudRun 冷启动敏感度冲突。

### 6.5 动态路由冲突

`[city]` 只能消费存在且关系合法的 City Site Profile。`switcherVisible` 只影响选择器，不作为路由授权。`news`、`pages`、`entrust`、`publish`、`city-partner` 等静态路由继续优先匹配；测试必须覆盖这些词不会被错误解析为城市。

## 7. 城市切换交互

### 7.1 入口

- 桌面端：城市按钮常驻 Logo 右侧；
- 移动端：城市按钮保留在顶部，不能隐藏到二级导航后；
- 弹层中的城市使用真实链接，显示“已开通 / 正在开通”文字，不能只依赖颜色；
- Logo 在城市级页面返回当前城市首页；在全局新闻、隐私页返回默认城市首页；
- 委托、发布和城市合伙人页的 Logo 与返回链接优先使用已解析的 query city。

弹层/抽屉需满足键盘开启、方向键或 Tab 导航、Esc 关闭、焦点归还、触控目标不小于 44px，并尊重 `prefers-reduced-motion`。

### 7.2 切换参数规则

保留：

- `q`
- `areaMin` / `areaMax`
- `rentMin` / `rentMax` / 完整计价单位语义
- `listingType`
- `availableBefore`
- `sort`

清除：

- `district`
- `businessArea`
- `metro`
- `page`（重置第一页）
- 其他由当前城市地理主数据派生的参数

切换目标：

- 城市首页 → 目标城市首页；
- 房源/楼盘列表 → 目标城市同类型列表，并应用上述保留规则；
- 房源/楼盘详情 → 目标城市同类型列表，不尝试复用当前详情 slug；
- 委托/发布 → 保持当前流程并替换 query city；
- 全局页面 → 城市选择后进入目标城市首页。

## 8. 页面状态

### 8.1 Live 城市

- 首页 Hero、文案和 metadata 优先读取 City Site Profile，缺少可选字段时使用共享兜底；
- 精选房源、热门区域、楼盘、facets、相关推荐和计数全部显式传入 CityContext；
- 所有供给仍调用唯一有效供给服务，不复制或弱化资格谓词；
- 正常空结果展示真实的“暂无匹配结果”，可以引导修改筛选或提交委托，但不能混入其他城市供给。

### 8.2 Coming-soon 城市

城市首页展示：

- 城市名与“正在开通”状态；
- 城市级 Hero/服务说明；
- 仅展示 active 且 `frontendVisible=true` 的区域概览；没有公开区域时整段隐藏；
- “委托找办公室”“发布本地房源”“成为城市合伙人”和现有“获取选址方案”CTA；“成为城市合伙人”进入 `/city-partner?city={city}`；
- 表单或链接携带并明确显示当前城市。

不展示：

- 借用上海或其他城市的房源、楼盘、价格和数量；
- 误导性的“0 套房源”统计；
- 没有选项的区域/商圈/地铁筛选器；
- 虚构顾问覆盖、成交数据或开通日期。

访问 coming-soon 城市的 `/listings` 或 `/buildings` 时，服务端返回该城市的筹备页面变体，保留 URL，不重定向到上海。

### 8.3 错误态

- 未知城市、profile 缺失或绑定错误：404；
- 查询服务失败：显示错误态和重试/委托入口，不能伪装成 0 数据；
- 城市 profile 的可选营销内容异常：使用共享兜底，但不能改变城市 id/slug/status；
- 供给查询异常不能使用其他城市缓存作为兜底。

## 9. 公开查询与缓存

### 9.1 查询上下文

把当前“默认上海”的 API 改为显式城市输入：

```ts
function createSearchContext(city: CityContext, now?: Date): SearchContext
```

`asOf`、`timezone='Asia/Shanghai'` 和 `channel='public-web'` 保持现有规则。

**城市隔离必须由类型强制，而非纪律。** 当前 `SearchContext.city` 可选 + Supply Adapter `if (ctx.city)` 才过滤，意味着漏传 city 会静默返回全国数据。要求：

- `SearchContext.city` 改为**必填** `city: string`；
- **删除** `defaultSearchContext()`，只保留 `createSearchContext(city, now?)`，杜绝任何"默认上海"入口；
- 改造后 §14.2 的数据隔离由编译器保证，code review 只作为二次防线。

列表、详情、推荐、首页、facets、sitemap 和咨询目标校验均使用同一上下文。

### 9.1.1 公开 DTO 增加城市字段

§6.2 的旧 URL / 错城重定向依赖"从记录反查真实城市"，而当前 `domain/public-catalog/contracts.ts` 没有任何 city 字段。要求在 DTO 层显式补齐，而不是在页面层再查一次 Payload（否则违反 §4.2）：

- `ListingDetail`、`BuildingDetail`、`ListingSummary`、`BuildingSummary` 增加 `citySlug: string` 与 `cityName: string`；
- `mappers.ts` 从 `building.city`（canonical Location）填充，缺失即视为数据异常并按 404 处理，不得留空字符串；
- `cityName` 同时供 Header、面包屑与详情 JSON-LD 使用，避免各处再拼城市名。

### 9.2 Cache key 与 tag

最低要求：

```text
key:  <resource>:<citySlug>:<normalized-args>
tags:
  public:home:<citySlug>
  public:facets:<citySlug>
  public:city-profile:<citySlug>
  public:sitemap
```

- 城市 slug/id 必须实际进入缓存 key；
- 不能只在函数参数里传 city、却仍绑定 `homeTag('shanghai')`；
- **动态 tag 方案已定档：按城市构造的 memoized factory。** 模块级 `Map<citySlug, CachedFn>`，未命中时用 `unstable_cache(fn, ['<resource>', citySlug], { tags: [...按城市构造], revalidate: 300 })` 创建并缓存该 wrapper。**`citySlug` 必须同时出现在 `keyParts` 与 `tags` 中** —— 只把 city 放进函数入参，tag 仍是闭包静态的，这正是现有 `cached-queries.ts` 注释里承认的限制。
- Next 16.2 的 Cache Components（`'use cache'` + `cacheTag`）确实原生支持动态 tag，但会改变整个渲染模型，**本次不迁移**，另立独立任务评估。实施期间不得顺手改动缓存范式。
- 类别级全量失效可以作为正确性兜底，但城市级 tag 必须存在以避免无必要的七城同时刷新；
- Listing/Building 领域事件从对象真实城市计算失效 tag；城市不明时才使用类别级保守失效；
- profile、Location status/frontendVisible、featuredRegions 变化分别失效对应城市页面、facets 和 sitemap。

缓存最长 5 分钟，并保留领域事件主动失效。

`public:sitemap` 保持全局单 tag（不按城市拆分）：任一城市内容变更都会刷新整份 sitemap。这是**有意取舍** —— sitemap 生成成本低、正确性优先于失效精度；如后续 URL 规模显著增长再评估拆分。

### 9.3 预渲染与运行时成本

七城 × 首页/列表使构建与冷启动成本进入需要显式决策的范围（CloudRun 冷启动敏感）：

- 城市首页：`generateStaticParams` 枚举全部 profile + ISR（`revalidate: 300`），保证七城首屏稳定；
- 城市列表页：**纯动态渲染**，不预渲染筛选组合；
- 详情页：沿用现有策略，不因城市化改变；
- 阶段 2 完成后需记录一次构建时长基线，阶段 3 上线后对比，回归超过 50% 视为需优化项。

## 10. SEO 与站点地图

### 10.1 Metadata

- 每个城市首页、列表和详情只有一个 canonical；
- title、description、OG 和 H1 读取同一 CityContext/Public DTO；
- 城市名只由 canonical Location/Profile 提供，不从未校验 query 拼接；
- 详情 JSON-LD 与页面使用相同 Public DTO，不虚构价格、库存或评分；
- 七城均为中文站，不使用 `hreflang` 区分城市。

### 10.2 索引规则

- `live` 城市首页和有效供给页面：允许索引；
- `coming-soon` 城市页面：默认 `noindex,follow`；
- coming-soon 城市不进入 sitemap；
- 城市切换器仍可展示并访问 coming-soon 城市；
- profile 从 coming-soon 改为 live 后，metadata、robots 和 sitemap 同步失效并切换；
- sitemap 只包含 live 城市、已发布内容和统一有效供给服务返回的对象。

## 11. 委托、发布、城市合伙人与城市归属

### 11.1 URL 与展示

从城市页进入：

```text
/entrust?city=hangzhou
/publish?city=hangzhou
/city-partner?city=hangzhou
```

页面必须明确显示当前服务城市。用户可通过城市控件修改，修改后 URL 与表单状态同步。`/city-partner` 是全局招募页，所有 query city 变体的 canonical 都是 `/city-partner`，不为七城复制招募内容。

### 11.2 服务端校验

- query、hidden input 和客户端状态均不可信；
- 提交时按 slug 重新解析 City Site Profile 和 canonical city Location；
- 合法城市保存对应 Lead、Supply Submission 或 City Partner Application 的 city relationship；
- 缺少 city 的直接访问使用上海；显式无效 city 显示校验错误并拒绝提交，不能静默记到上海；
- 来源、隐私同意、幂等、同源/CSRF、schema 和限流规则保持现有实现；
- 不在响应、日志或分析事件中暴露联系人、手机号、原始 IP 或内部 Lead 状态。

### 11.3 既有业务流程不变

- Entrust 继续“两阶段”：第一阶段先保存联系方式，第二阶段选填结构化需求；第一阶段即保存城市关系；
- Publish 继续轻量提交：楼盘/地址/面积/租金/联系人为必填，图片可选；
- Supply Submission 继续进入独立线索池，由运营核验后人工转换，不自动建楼盘、建房源或发布。

### 11.4 城市合伙人入口与两阶段申请

- 本期入口仅放在 §8.2 coming-soon 城市首页，不加入主导航、live 城市首页或全站页脚；`/city-partner` 仍允许合法直接访问。
- CTA 文案固定为“成为城市合伙人”，目标为 `/city-partner?city={currentCity}`。
- 第一阶段必填：合作城市、姓名、手机号、申请人身份、隐私同意。第一阶段成功即持久化独立申请，避免后续长表单放弃造成线索丢失。
- 第二阶段选填：公司/机构、当地资源类型、行业经验、合作设想。延续现有 Entrust 两阶段的交互模式，但使用独立 schema、API 和 Collection。
- 第二阶段按 `requestId + phoneNormalized` 可信定位第一阶段记录；不向客户端暴露顺序数据库 ID。重复提交由幂等键和数据库唯一约束返回首次成功语义。
- 合作城市默认使用 query city；缺少 city 的直接访问使用默认城市。显式无效、停用或关系错误的城市必须可见报错并阻止提交。

申请人身份采用封闭枚举：`业主/物业运营方`、`商业地产经纪/渠道`、`企业服务机构`、`本地运营团队`、`其他`。当地资源采用可多选封闭枚举：`楼宇/业主资源`、`企业选址需求`、`经纪渠道网络`、`本地运营团队`、`政府/商协会资源`、`其他`。`其他` 被选中时才显示限长补充说明。

### 11.5 `city-partner-applications` 独立申请池

新增 Payload Collection `city-partner-applications`，不复用 Leads 或 Supply Submissions：

| 分组 | 字段 | 规则 |
|---|---|---|
| 第一阶段提交事实 | `city`、`applicantName`、`contactPhone`、`applicantIdentity` | 必填，创建后不可修改；city 仅允许 canonical active 城市 |
| 第二阶段提交事实 | `organizationName`、`resourceTypes[]`、`experienceSummary`、`cooperationPlan`、`detailsCompletedAt` | 选填；只允许通过专用第二阶段端点补充一次，之后只读 |
| 运营流程 | `status`、`assignee`、`internalNote`、`handledAt` | 仅有 manage 权限的后台用户可维护；关键状态变化写审计 |
| 溯源与合规 | `requestId`、`idempotencyKey`、`sourcePath`、`sourceUrl`、隐私版本、`submitterIpHash` | 服务端写入；IP 只存哈希；幂等键建唯一索引 |

状态机固定为：`待联系 → 已联系 → 评估中 → 合作意向确认 / 暂不合适 / 已撤回`。只允许从非终态向后流转；“合作意向确认”只是运营判断结果，不自动创建 Merchant、Team、User、Broker 或公开内容，也不代表签约完成。

提交事实 append-only、Collection 禁止公开直接 create/update/delete；公开写入只能走 `/api/city-partner-applications` 与其第二阶段专用端点，经过 schema、同源/CSRF、限流、幂等和隐私校验后由服务端受控写入。

### 11.6 后台权限、数据范围与通知

- 后台入口归入“商户合作”，菜单为“城市合伙人申请”，支持状态、城市、负责人和创建时间筛选。
- 新增菜单码 `city-partner-applications`，操作码 `city_partner_application:read` / `city_partner_application:manage`；公开创建不对应后台操作权限。
- ADM 可读取和管理全部申请；OPS/MGR 只可读取、分配和处理其授权城市；其他角色默认无入口。完整手机号继续受 `phone:full` / `phone:masked` 控制。
- 新申请通知授权城市内具有 read 权限的运营接收人；城市没有接收人时回退到 ADM 待办/通知。通知创建失败必须进入可重试任务并可观测，不能把已成功持久化的申请回滚或静默丢单。

### 11.7 城市合伙人 SEO 与隐私

- `/city-partner` 只有一个 title、description、canonical 和 H1，可进入 sitemap；`?city=` 不形成独立可索引页面。
- 页面只说明合作方向、申请流程和信息用途，不承诺独家区域、收益、签约资格或确定开城日期。
- 公开响应、日志、通知摘要和分析事件不得包含姓名、完整手机号、公司名称、经验描述、合作设想或原始 IP。

## 12. 分析与隐私

可新增匿名枚举事件：

- `city_switcher_opened`
- `city_switched`（from/to/status/pageType）
- `coming_soon_cta_clicked`（city/ctaType）
- `city_page_view`（city/status/pageType）
- `city_lead_submitted`（city/status/formType，仅枚举，不含任何表单内容）
- `city_partner_cta_clicked`（city/status）
- `city_partner_application_started`（city）
- `city_partner_application_submitted`（city，第一阶段成功）
- `city_partner_application_completed`（city，第二阶段完成）

后两个事件是阶段 4 逐城开通的**决策依据**：没有 `city_page_view` 与 `city_lead_submitted` 的比值，就无法判断某个筹备城市是否具备开城价值，只能凭感觉决定。

事件只记录城市 slug、页面类型、筛选是否保留、申请阶段等非 PII 枚举；不记录关键词原文、姓名、手机号、公司、资源描述、合作设想、留言和原始 URL query。曝光事件按可见性去重。

## 13. 发布策略

### 阶段 1：数据与 resolver 基础

- 新增 City Site Profile 与 City Partner Application Collections、schema/data migration、公开 DTO 和 resolver；
- 七城 profile 建立后做数据库唯一性、关联和状态验证；
- 此阶段不切换公开路由。

### 阶段 2：公开查询与缓存城市化

- 清理页面查询链上的上海硬编码；
- 首页、列表、详情、推荐、facets、缓存和 sitemap 接入显式城市上下文；
- 先用单元/集成测试证明不串城。

### 阶段 3：路由、交互与表单

- 上线城市前缀、旧 URL 重定向（按 §6.3 状态码分级）、城市切换器、coming-soon 页面；
- Entrust/Publish 显示并保存城市；上线 `/city-partner` 两阶段申请、独立后台申请池、权限与通知；
- 同步 metadata、robots、canonical 和 sitemap。

**必须带 kill switch。** 本阶段一次性改变对外 URL 契约，仅靠 revert 部署回滚代价过高：

- 引入服务端环境变量 `MULTI_CITY_ROUTING_ENABLED`，在请求时控制 canonical 归属与重定向方向（关：旧 URL 为 canonical，城市前缀不对外；开：城市前缀为 canonical，旧 URL 307 过去）。不得使用 `NEXT_PUBLIC_`：公开环境变量可能在构建期内联，不能作为可靠的运行时恢复开关；客户端只接收服务端计算后的布尔状态；
- 开关关闭时，城市前缀路由仍可访问但返回 `noindex`，供内部验收；
- 与 §6.3 的页面级 307 配合：观察期内任何异常可通过一次配置/服务修订关闭开关恢复，且不留下浏览器永久缓存的错误跳转；
- 观察期结束、确认稳定后，才执行"删除开关 + 307 提升为 308"这一独立获批动作。

### 阶段 4：验收与逐城开通

- 上海维持 live；其他六城以 coming-soon 同时可见；
- 运营逐城发布区域/内容/供给并核验后，独立切换为 live；
- 不以“数据库已有节点”作为开城依据。

由于本需求同时跨 Collection/迁移、公开查询/供给、前台路由/视觉、咨询和浏览器验收，实施计划应拆成上述里程碑和独立 Task Packet，避免一个任务同时激活过多专项规则。

## 14. 验收标准

### 14.1 路由矩阵

- `/` 返回 307（观察期）/308（提升后），Location 为 `/{defaultCity}`；
- 七个 `/{city}` 均按 profile 返回 200；
- coming-soon 城市的 `/{city}/listings`、`/{city}/buildings` 返回 **200 + 筹备页面变体 + `noindex,follow`**，保留原 URL，不重定向到上海；
- 非法、缺失 profile 和绑定错误的城市返回 404；
- `/listings`、`/buildings` 按 §6.3 的静态映射状态码重定向；
- 旧详情与错城详情一律返回 **307**（永不 308），Location 指向记录真实城市；失效详情不泄漏并返回 404；
- `MULTI_CITY_ROUTING_ENABLED` 关闭时，旧 URL 恢复为 canonical 且城市前缀页面返回 `noindex`；
- `/news`、`/pages/privacy`、`/entrust`、`/publish`、`/city-partner` 不被 `[city]` 截获；`/city-partner?city=hangzhou` 的 canonical 仍为 `/city-partner`。

### 14.2 数据隔离

- 上海所有公开供给查询结果的 Building city 都是上海；
- 对杭州等筹备城市查询时，结果和计数中不出现上海对象；
- facets、热门区域、推荐和 sitemap 使用与列表相同的城市及有效供给边界；
- 查询异常显示错误态，不转换成空结果。

### 14.3 切换器

- 列表切换城市保留通用筛选、清除地理筛选并把页码重置为 1；
- 详情切换进入目标城市同类型列表；
- coming-soon 状态有文本标识；
- 键盘、Esc、焦点归还、读屏名称和 44px 触控目标通过。

### 14.4 表单

- 页面展示城市、URL 城市、服务端解析城市和数据库 relationship 一致；
- 缺少 city 的直接入口记录上海；
- 显式无效或被篡改的 city 被拒绝，不静默归上海；
- Entrust 第一阶段已持久化城市，第二阶段更新不改变归属；
- Publish 仍只创建 Supply Submission，不自动转换或发布。

### 14.5 城市合伙人申请

- coming-soon CTA 携带当前城市进入 `/city-partner`，直接访问缺省上海，显式无效/篡改城市被拒绝；
- 第一阶段成功后数据库已有独立申请且城市正确；第二阶段可继续补充一次，重复请求返回幂等成功且不新增记录；
- 状态机拒绝跳步和终态回退；“合作意向确认”不创建 Merchant、Team、User、Broker 或公开内容；
- OPS/MGR 只能访问授权城市，ADM 可访问全部，无权限用户直接 API 返回 403；完整手机号按字段权限脱敏；
- 城市接收人存在时通知对应运营；不存在时生成 ADM 待办/通知；通知暂时失败可重试且申请记录仍保留；
- `/city-partner` metadata 唯一，query city 不生成重复 canonical；日志、响应、通知摘要和分析事件无 PII。

### 14.6 SEO 与缓存

- 每个 live 城市页面 title、description、canonical 和 OG 唯一且一致；
- coming-soon 返回 `noindex,follow` 且不进入 sitemap；
- 旧 URL 不与新 URL 同时成为 canonical；
- 城市实际进入 cache key 和 tag；profile、区域和供给变更只产生预期失效；
- 缓存命中情况下仍通过交叉城市测试证明无串数据。

### 14.7 自动化与真实浏览器

按影响范围执行：

```text
pnpm exec payload generate:types
pnpm exec payload generate:importmap   # 仅新增后台组件注册时
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm build
```

Collection/schema 变化必须在 PostgreSQL 执行 migration dry-run、apply、验证和回滚演练。

**验收职责划分**（避免 4 档 × 7 项全手工的高成本重复）：

- **E2E（`tests/e2e/`，必须自动化）**：§14.1 路由矩阵全量、§14.2 跨城数据隔离、§14.3 切换器参数保留/清除与键盘可达性、§14.4 三类表单城市归属与篡改拒绝、§14.5 合伙人两阶段/权限/通知边界、§14.6 canonical/robots/sitemap 断言。这些是回归高发区，必须每次 CI 执行。
- **真实浏览器（手工，只做视觉与交互观感）**：375×812、768×1024、1440×900、1920×1080 四档，每档验证上海 live 首页/列表、一个 coming-soon 城市、城市切换弹层/抽屉的视觉与焦点表现、Entrust 第一阶段、Publish 提交入口、City Partner 两阶段视觉与恢复、一个相邻全局页面和控制台。

记录路由、操作、预期、实际、截图/日志和未验证项。

## 15. 风险与守护措施

| 风险 | 守护措施 |
|---|---|
| 缓存 key 带城市但 tag 仍写死上海 | 对 key 和 tag 分别写测试；代码审查搜索 `homeTag('shanghai')`、`facetsTag('shanghai')` |
| 动态 `[city]` 截获全局路由 | 静态路由优先 + 路由矩阵 E2E |
| Profile 关联到停用/重复上海记录 | 按不可变代码绑定；唯一约束；迁移遇歧义中止 |
| coming-soon 页面形成薄内容 SEO | 默认 `noindex,follow`，live 后才进入 sitemap |
| 表单 hidden city 被篡改 | 服务端重新解析并保存 relationship |
| 无供给时错误回退上海 | 查询和缓存 fail-closed；交叉城市集成测试 |
| 批量开放区域导致未核验数据上前台 | 数据迁移明确不修改 `frontendVisible` |
| 旧外链和搜索权重丢失 | 旧索引/详情重定向到唯一 canonical（状态码按 §6.3 分级） |
| 一次改动跨域过大 | 按四阶段建立 Task Packet，串行迁移与共享查询改造 |
| **漏传 city 静默返回全国数据** | `SearchContext.city` 改必填、删除 `defaultSearchContext()`；类型层面消除 fail-open |
| **308 跳错后浏览器永久缓存、无法自愈** | 静态映射观察期用 307，记录派生跳转长期 307；提升 308 为独立获批动作（§6.3） |
| **运营改城市 slug 导致全站断链** | 任一存在 City Site Profile 的城市均由服务端 hook 禁改 slug；本期不提供别名路径（§5.2） |
| **城市白名单仍是编译期常量，开城需发版** | 删除 `SUPPORTED_CITIES`，校验下沉运行时（§4.1.2） |
| 阶段 3 一次性切流无退路 | 服务端 `MULTI_CITY_ROUTING_ENABLED` kill switch + 页面级 307 观察期（§13 阶段 3） |
| resolver 被重复调用致每页多次 DB 往返 | `React.cache()` 请求内去重 + 按城市 `unstable_cache`（§4.1.1） |
| 详情页无法反查真实城市，§6.2 重定向落空 | 公开 DTO 增加 `citySlug` / `cityName`（§9.1.1） |
| 七城 SEO 文案复制粘贴产生重复 title | `seoTitle` / `seoDescription` 长度与"必须含城市名"服务端校验（§5.1） |
| 合伙人申请误入需求/供给流程 | 独立 Collection、API、权限和状态机；禁止自动创建正式业务对象（§11.5） |
| 合伙人第二阶段重复补录或越权改写 | `requestId + phoneNormalized` 可信定位、一次性补充、数据库幂等与提交事实只读（§11.4–11.5） |
| 城市无运营接收人导致合伙人申请无人处理 | 回退 ADM 待办/通知，失败进入可重试任务并可观测（§11.6） |

## 16. 设计结论

本方案以独立的 City Site Profile 管理前台开城状态和运营内容，以 canonical Location 管地理主数据，以统一 CityContext 串起路由、查询、缓存、SEO 和表单。七城可以同时获得稳定入口，但只有完成内容和有效供给核验的城市进入 live；筹备城市承担真实需求、供给和城市合作申请，不借用其他城市数据，也不制造搜索引擎薄内容。

该边界保留现有有效供给规则和需求/供给双链，并用独立 City Partner Application 构成第三条申请链；三类申请互不自动转换，为今后逐城开放提供无需换 URL、无需迁移历史记录的稳定路径。

## 17. 修订记录

### 2026-08-13 设计评审修订

对照 `payload-office-platform` 现有代码复核后的修订，全部为**约束强制方式**与**运维可逆性**两类补强，未改变产品决策（§2）与目标边界（§3）。

必修项（原设计缺口）：

1. §9.1 —— `SearchContext.city` 由可选改必填、删除 `defaultSearchContext()`。原设计只以文字纪律要求"不得调用无城市上下文"，而现有 Supply Adapter 是 fail-open（漏传即返回全国数据）。
2. §9.1.1 —— 公开 DTO 增加 `citySlug` / `cityName`。原设计要求详情服务"能可靠解析记录所属城市"，但未落到字段，§6.2 的重定向无法实现。
3. §6.3 / §6.4 —— 重定向状态码分级与实现位置。原设计全用 308，其中记录派生的跳转目标可变，308 会把可变映射永久烧进用户浏览器。
4. §4.1.2 —— 城市白名单去留。原设计未交代 `SUPPORTED_CITIES` 与 `resolveDefaultCity()` 的改造，与"运营独立开城"矛盾。

补强项：

5. §4.1.1 resolver 请求内去重机制；§5.2 城市 slug 冻结；§9.2 动态 tag 方案定档（memoized factory，明确本次不迁移 Cache Components）；§9.2 sitemap 单 tag 的取舍说明；§9.3 预渲染与构建成本基线；§13 阶段 3 kill switch；§14.1 coming-soon 列表页状态码；§14.7 E2E 与真实浏览器的职责划分；§5.1 SEO 文案约束与 `featuredRegions` 上限；§12 补充开城决策所需的两个事件；§15 风险表补 8 条。

### 2026-08-13 城市合伙人修订

1. §8.2 增加“成为城市合伙人”入口，目标为全局 `/city-partner?city={city}`；本期仅在 coming-soon 城市首页露出。
2. §11.4–§11.7 定档两阶段申请、独立 `city-partner-applications` 申请池、状态机、权限、通知、SEO 与隐私边界；不复用 Lead/Supply Submission，不自动创建正式业务对象。
3. §12、§13、§14、§15 同步补充分析、发布、验收与风险守护。
4. §5.2 的城市 slug 方案定档为“存在 profile 即冻结”，本期不引入 `previousSlugs`。
5. §6.4 / §13 的观察期重定向定档为页面级 307，并把 kill switch 改为服务端 `MULTI_CITY_ROUTING_ENABLED`，避免 `NEXT_PUBLIC_` 构建期内联破坏运行时恢复能力。
