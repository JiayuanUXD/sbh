# Task Packet：OPT-104 汇租选址全量采集 + 入库对账

> 状态：**实施中**（分支 `data/opt-104-huizuxuanzhi-crawl-9b3d`，worktree `E:\wt-hzx`，证据 `artifacts/verification/OPT-104/`）
> 创建日期：2026-10-06
> 来源：用户「采集 huizuxuanzhi.com 下面的所有楼盘和房源信息」。摸底与方案讨论后四次拍板：
> ① 用途选 **C（楼盘 + 房源进本站）**，法律 / 图片版权 / SEO 风险已当面说明；
> ② 图片**只抓楼盘的**，房源图片不抓；③ 房源详情页**全抓**；④ 生产已有的旧数据**一起对账**。
> 方案阶段发现前台目录容量上限（§6），第五次拍板：**只导入不上架**——新数据一律草稿，前台暂不变；
> 以后放出时按「**每楼盘限量**」挑子集（具体放出另开工作项，见 §6）。
> 实施中发现对方图床有防盗链（不带 Referer 返回 403），第六次拍板：**伪造 Referer 抓楼盘图**（§9 决定 ⑥）。

---

## 1. 一句话

本地零依赖采集器把对方 6.4 万个页面原样落盘 → 本地解析成规范化同步包 → 后台上传同步包，
CloudRun 上的任务按 `(dataSource.source='huizuxuanzhi', dataSource.externalId)` 幂等新建 / 更新；
新数据一律草稿，旧数据对账（对方已消失的房源下架）。**本工作项不改前台可见范围。**

## 2. 摸底事实（2026-10-06 实测）

| 项 | 事实 |
|---|---|
| 站点 | 上海汇租科技，只做上海；ThinkPHP/FastAdmin 服务端直出，不需要跑 JS；无登录、无 Cookie 校验 |
| robots.txt | `User-agent: * / Disallow:`（全放行） |
| 规模 | 楼盘 **3,665**（`/loupan?page=1..184`），房源 **57,500**（`/office?page=1..2875`），每页 20 |
| URL | 楼盘 `/loupan/l{id}`；房源 `/loupan/l{楼盘id}-x{房源id}.html`（**只认 x 后的 id**，楼盘段写错也照常返回） |
| 不存在的 id | HTTP **500** + `<title>发生错误</title>`（不是 404） |
| 坐标 | 楼盘页 hidden input `lng`/`lat`，**百度 BD-09**；本站前台用高德 **GCJ-02**，入库前须转换 |
| 楼盘图集 | 楼盘页 require 配置内嵌 `buildingPicImages` JSON，图在 `huizutec.oss-cn-shanghai.aliyuncs.com` |
| 楼层 | 房源只有「低区 / 中区 / 高区」，没有具体楼层号 |
| 联系方式 | 只有 400 总机，未见经纪人个人手机号——**不采集任何个人信息** |

已见的数据质量问题（解析阶段必须处理，不得原样入库）：

- 行政区标错：「万科时一区」地址在虹桥枢纽（闵行），站上标长宁区；「浦东区」与「浦东新区」混用。
  → 以坐标反查行政区做校验，冲突进人工清单。
- 「5A甲级」「地铁10分钟」等标签几乎每个楼盘都挂，像模板默认值 → **不映射到 `grade`**。
- 房源描述是模板拼出来的套话；部分楼盘无价格、无房源。
- 图片文件名是阿里系 `O1CN01…-wisdomhammer.jpg`，对方的图本身也是转载，来源链不清。

生产现状（2026-10-06 只读 SQL）：

| 对象 | 来源 `huizuxuanzhi` | 其它 | 备注 |
|---|---|---|---|
| buildings | 20（全部 `published`） | 63 | externalId = 站上楼盘 id（如 `5086`） |
| listings | 2,158（2,119 published+approved，39 draft） | 71 | externalId = 站上房源 x-id（如 `63425`）；merchant 全是「官网」(id 1)；`syncedAt` 停在 **2026-08-05**，两个月未同步 |

历史包袱：2026-08 那轮导入的分支 `feat/import-huizuxuanzhi` 已删，生产留有 4 条仓库里找不到的迁移（见 `DEPLOYMENT.md`「迁移漂移」）。
**本工作项的一切写入都必须走仓库内代码 + 应用内任务，不得在工作区对生产直接跑脚本或数据迁移。**

## 3. 阶段与进度

| # | 阶段 | 产物 | 状态 |
|---|---|---|---|
| 1 | 枚举 | `state/enum-*.json` | 进行中（2026-10-06 02:45 起，零报错） |
| 2 | 详情 | `raw/b`、`raw/l` | 排队（楼盘约 2.3 小时、房源约 33 小时）。楼盘图片改由同步任务在服务端拉取，本地不再下载 |
| 3 | 解析清洗 | `parse.ts` + `build-dataset.ts` → NDJSON 同步包 | 代码完成，样本页验证通过，等全量 |
| 4 | 对账报告 | `reconcile.ts` → 下架包 / 挂靠建议 / 坐标反查区名 | 代码完成，样本验证通过（抓出万科时一区标错区） |
| 5 | 应用内同步任务 | `source-sync-batches` + `run-source-sync` + 端点 + 后台页 + 测试 | 代码完成；本地端到端走通（§10） |
| 6 | 本地全量演练 | 本地库灌满全量，测耗时与后台性能 | 等阶段 2 |
| 7 | 生产执行与验收 | 后台上传同步包、核对计数、浏览器走查 | 等阶段 6 |

## 4. 采集（阶段 1–2）

代码：`payload-office-platform/scripts/import-huizuxuanzhi/crawl.mjs`（零依赖，不需要 pnpm install）。
数据目录 `HZX_DATA_DIR=E:/hzx-data`（放在 worktree 之外，删 worktree 不丢数据；仓库内默认目录已 gitignore）。

```bash
HZX_DATA_DIR=E:/hzx-data NODE_USE_ENV_PROXY=1 node scripts/import-huizuxuanzhi/crawl.mjs enumerate
```

子命令 `enumerate → buildings → listings → images`，`status` 看进度。每个都能中断重跑，已落盘的跳过。

**礼貌约束（不可放宽）**：

- 单线程；请求起点间隔 ≥ 2s + 0~500ms 抖动；图片走另一台主机，间隔 1s。
- 429 / 5xx / 网络错误 → 指数退避（30s 起，最多 6 次）。
- **403、验证码页、非 HTML 响应 → 立即停机**，不换 IP、不上代理池、不破解验证码，等人评估。
  （2025 年修订的《反不正当竞争法》明确禁止「避开或破坏技术管理措施」获取数据。）
- 原始 HTML gzip 落盘：解析口径改了只重跑解析，不再打对方的站。

**枚举漂移**：列表默认按更新排序，翻页期间对方增删房源会让条目跨页漂移。对策：房源列表反查出的楼盘
并入楼盘集合；全部详情抓完后用 `--refresh-lists` 再枚举一遍取并集；楼盘页「N 个在租房源」与枚举数对账。

## 5. 同步语义（阶段 3–5）

### 5.1 字段映射

楼盘（`buildings`）：

| 对方 | 本站 | 处理 |
|---|---|---|
| 大厦名称 | `name` | 原样 |
| 区 / 商圈 | `district` / `businessDistrict` | 区用 `import-business-areas.ts` 的 siteId 对照表；商圈按「区内同名」解析（205 个商圈已于 2026-08-06 从该站导入）；坐标反查校验 |
| 地址 | `address` | 原样 |
| lng / lat | `longitude` / `latitude` | BD-09 → GCJ-02 |
| 竣工时间「2024年」 | `completionDate` | 取 `YYYY-01-01`，原文进解析日志 |
| 楼层层数「地上36层，地下3层」 | `totalFloors` | 取地上层数 |
| 建筑面积「300000平米」 | `grossFloorArea` | 数值 |
| 层高「4.5m，净高3.2m」 | `standardFloorHeight` / `netCeilingHeight` | 拆分 |
| 电梯数量（自由文本） | `zoningNote`；能解析出的「客梯 N 部」进 `passengerElevators` | |
| 空调类型 + 空调开放时间 | `airConditioning` | 拼接 |
| 网络 | `network` | 原样 |
| 物业费「39元/平方米/月」 | `propertyFee` | 按该字段结构拆数值与单位 |
| 停车位「约1100个（B3-B5层）」 | `parkingSpaces` | 取数值 |
| 停车费 | `parkingFee` | 原样 |
| 开发商 / 物业公司 | `developer` / `propertyCompany` | 原样 |
| 简介 | `description`（richText） | 段落化 |
| 图集 | `gallery` / `coverImage` | 首张作封面；任务在服务端从源 URL 拉图建 Media（走既有水印管线） |
| 标签「5A甲级」等 | — | **不映射**（模板默认值） |

房源（`listings`）：

| 对方 | 本站 | 处理 |
|---|---|---|
| — | `listingType` / `businessType` | `traditional-office` / `lease` |
| 面积 | `area` | 一位小数 |
| 日单价 | `price`（元/㎡/天）+ 旧列 `rent`/`rentUnit` | 与 2026-08 那轮同口径 |
| 装修 | `decorationStatus` | 对照表在解析阶段按生产已有分布定稿 |
| 可注册 是/否 | `registrationStatus` | |
| 所在楼层「中区」 | `floor` | 原样写分区文本 |
| 朝向 | `spaceDetails.orientation` | |
| 使用率约70% | `spaceDetails.efficiencyRate` | |
| 可容纳工位 40~80 | `spaceDetails.seatMin/seatMax`、`seats` | |
| 是否可分割 | `spaceDetails.isDivisible` | |
| 付款方式「押3付1」 | `paymentTerms` + `costTerms.depositMonths` | |
| 最短租期「24个月」 | `minimumLeaseMonths` | |
| 房源描述 | `description` | 模板套话，原样保留，待运营改写 |
| 图片 | — | **不抓**（拍板 ②）；无图走前台缺省图降级 |
| — | `merchant` | 「官网」(id 1)，与 2026-08 那轮一致 |

### 5.2 写入规则

- **幂等键**：`(dataSource.source='huizuxuanzhi', dataSource.externalId)`，沿用 2026-08 那轮的编号口径
  （楼盘 = 站上楼盘 id，房源 = x-id），旧数据因此原地更新而不是新建一份。
- **新建**：楼盘 `status=draft`；房源 `publicationStatus=draft`、`reviewStatus=not_submitted`。**一律不上架**。
- **已有的源数据**：
  - 房源（易变）：用采集值覆盖采集字段；不动发布 / 审核状态、商户、图片。
  - 楼盘（稳定、可能被运营精修过）：**只填空，不覆盖非空**；图集已有则不动。
- **对方已消失**（详情页 500+「发生错误」，或第二遍枚举仍不在）：房源 `publicationStatus → unpublished`
  （走领域状态机，不直写列；**不删**——`payload.delete` 恒为硬删）；楼盘不自动停用，进人工清单。
- **与 63 个手工楼盘撞名**：名称 + 地址模糊匹配，命中的不新建楼盘，房源挂到既有楼盘上，楼盘本身只填空；
  匹配结果先出报告，人工确认后才执行。
- 每批写入登记 `affectedIds` + 写前快照，可按批次回滚（对齐 OPT-041 的回滚语义：下架而非删除）。

### 5.3 生产写入链路

本机拿不到生产 `DATABASE_URL` / COS 密钥（只在 CloudRun 服务环境变量里），`scripts/*.ts --execute`
的 Local API 路径到不了生产；MCP SQL 直写会绕过钩子、版本、审计，6 万行不可接受。因此：

1. 本地把解析结果切成同步包（NDJSON.gz，每包 ≤ 1,000 行）。slug 在本地生成（`pinyin-pro` 是开发依赖，
   运行时没有）：楼盘「名称拼音-站上id」、房源「标题拼音-huizu-xid」，与 2026-08 那轮同格式。
2. 后台新增入口，持 `data:import` 权限的人上传同步包 → 校验（`unknown` 收口，逐行 `parseHuizuSyncRow`，
   任一行不合格整包拒收——同步包是机器产物，不合格说明解析器有 bug）→ 一包落一条批次 → 入队。
3. CloudRun 上跑**新任务** `run-source-sync`（不复用 `run-supply-import`）。原因（2026-10-06 摸底）：
   - `run-supply-import` 运行中不续租约，超 15 分钟会被 `recoverStaleSupplyImportJobs` 复位重跑；
   - 它把整批 `validRows` 存在一个 jsonb 里、每 20 行全量读写一次批次文档，设计上限 1,000 行；
   - 来源、新建即上架都写死。
   新任务照 `watermark-rebake.ts` 的写法：每次只处理一段（按行数与耗时双上限），游标落库，
   没处理完就给自己续排下一段，保证每次都在租约内结束。
4. 楼盘图片由任务在服务端从源 URL 拉取（CloudRun 与源 OSS 同在上海），本地 `img/b` 只做存档与校验。
   用途按「房源/楼盘实景」（`listing-photo`），会过水印管线；单楼最多 20 张（`protectBuilding` 上限）。
5. 批次存在**新集合** `source-sync-batches`（不扩 `supply-import-batches` 的枚举：那边有三处把
   「不是 buildings」当成 listings 的分支，扩值会误入）。批次记录写前快照，回滚只做两件事：
   已下架的旧房源恢复上架、被覆盖字段的已上架房源恢复原值；新建的草稿不动（本就不可见）。
6. 每次写入都会触发的钩子里，有两个需要处理：前台缓存失效钩子（任务里没有请求上下文，
   每次写入都失败并打一条 warn）→ 加 `req.context` 开关，任务结束后按城市统一失效一次；
   搜索插件每次写都建索引 → 保留（后台搜索要用），仅关注耗时。

**顺带修复**：`buildings.access.read` 是 `() => true`，草稿楼盘可被匿名 `/api/buildings` 读到。
导入 3.6k 草稿后等于公开，与「只导入不上架」矛盾。改为与 `listings` 同口径：员工全读，匿名只读
已发布且启用的楼盘（`getPublicBuildingWhere`）。前台走 Local API，不受影响（已核对无匿名调用方）。

## 6. 前台容量上限（为什么只导入不上架）

前台目录（OPT-068）按「上海约两千条」设计，代码里有三道上限：

- 房源列表扫描封顶 `LISTING_SCAN_CANDIDATE_LIMIT = 5000`，整份进 `unstable_cache`（单条 2MB 硬上限，超限**静默**写不进）。
- 按区筛选时区内楼盘 id 最多取 `PUBLIC_CATALOG_CANDIDATE_LIMIT = 1000`。
- sitemap 单文件，而单文件协议上限 5 万条 URL。

5.7 万条直接上架会导致：列表只能翻到前 5,000 条、计数不对、缓存失效后每个请求冷扫描、sitemap 失效。
**放出前置条件**：另开工作项把房源目录的筛选 / 排序 / 分页 / facet 下推到 SQL，sitemap 分片；
上线后按「每楼盘限量」批量放出（拍板 ⑤）。

## 7. 规模影响（阶段 6 必须实测）

- 行数：楼盘 83 → 约 3.7k，房源约 2.2k → 约 5.9 万（约 25 倍）。草稿不进前台，但后台列表、筛选、
  仪表盘统计、审计日志都会吃到。
- 媒体：楼盘图约 1.8 万张进 COS，每张都过水印管线。
- 待办：「30 天未维护」扫描（`sla-scanner.ts`）目前只有内存实现，生产未接线，导入不会刷出待办；
  **将来接线时必须排除草稿**，否则一夜生成数万条。

## 8. 验收标准

- [ ] 枚举数与站点声称数对齐（差异有解释）；第二遍枚举并集已合入。
- [ ] 随机抽 50 个楼盘 + 50 条房源，与原站逐字段比对，差异全部可解释。
- [ ] 坐标转换抽查：10 个楼盘在高德地图上的落点与地址一致。
- [ ] 本地全量演练：导入耗时、后台楼盘 / 房源列表首屏耗时有数据；前台可见集合**导入前后逐 id 一致**
      （旧数据下架那部分除外）。
- [ ] 生产：来源计数、草稿计数、下架计数与对账报告一致；按批次回滚在本地演练过一次。
- [ ] 浏览器走查：后台打开一个新导入楼盘、一条新导入房源、一条被下架的旧房源；前台确认可见范围未变。

## 9. 风险与决定（用户已知悉并拍板）

- **决定 ⑥（2026-10-06）**：对方 OSS 图床校验 Referer，不带则 403；站内 `/uploads/` 图不设防。
  采集前曾向用户说明「伪造 Referer 属于避开技术管理措施，法律风险上升」，并推荐只抓站内图，
  用户选择伪造 Referer 全抓。实现上只在同步任务的服务端拉图时带对方站点的 Referer
  （`imageRequestHeaders`，仅对对方两个图床主机生效），采集器的 `images` 子命令同口径但默认不跑，
  避免对方图床扛两遍流量。同步包里的图片主机被限定为对方两个图床（防 SSRF）。

- 整库搬运竞品数据存在不正当竞争风险；图片版权风险最高（对方的图本身也是转载）。
- 草稿状态降低了对外暴露，但楼盘图会进 COS 并打上本站水印。
- 放出时大量与对方重复的内容可能被搜索引擎判为采集站。

## 10. 本地验证记录（2026-10-06，`sbh_dev_hzx`，`next dev` :3734）

- 单测：解析器 / 同步行 / 写入规则 / 同步包 共 4 个文件全过；`source-sync-postgres.test.ts`（真库）7 条全过；
  不带库的全量单测 399 文件 5,275 用例全过（导航守卫 4 个文件、`city-partner-notify` 已同步更新登记）。
- 端到端：5 个楼盘 + 3 条房源的真实同步包经 `POST /api/source-sync/upload` 上传：
  - 房源包在楼盘包写完前被 409 `BUILDINGS_PENDING` 拒收；
  - 楼盘包：新建草稿、带 dataSource；首轮图片全部 403（未带 Referer），决定 ⑥ 后重传同一包，
    4 个已有楼盘补上图集（只填空的幂等）、新建 1 个，共 28 张图入库，零错误；
  - 房源包：3 条新建为草稿 / 未提交，挂平台默认商户，标题统一为「楼盘名 面积㎡ 装修」；
  - 匿名 `GET /api/buildings/1777` 404、匿名楼盘列表只剩已发布的 7 个；前台楼盘详情页 404；
    员工能读到草稿与来源字段。
- 浏览器：后台「房源与楼盘 → 外部数据同步」页面渲染、批次表与错误明细展开正常；楼盘编辑页
  基础信息字段值正确、「展示内容」页签 5 张图全部加载；房源编辑页字段值正确；当前 dev server 无服务端错误。
- 本地种子区名是「长宁 / 徐汇 / 黄浦」，生产是「…区」；本地演练前已把本地库这三个区名补上「区」字（只改本地库）。

### 生产侧待人工处理

- 楼盘 16「万科时一区」（2026-08 那轮导入）区标成了长宁区，实际在闵行区。同步对已有楼盘只填空、不改区，需在后台手工改。

