# Task Packet：OPT-045 批量导入补齐「导入即可上架」的字段与前提

> 状态：**已实施**（2026-08-24，7 个提交；生产数据变更与验收未做，见 §11）
> 创建日期：2026-08-23
> 来源：OPT-041 合并后的本地验收（2026-08-23）+ 用户提出「导入的楼盘/房源要能直接上架」
> 编号说明：OPT-042 / OPT-043 归 PR #83（跨实例缓存失效 / 事件消费链路未接线），
> OPT-044 是 C 端表单 requestId 生命周期，故取 045

---

## 1. 一句话

OPT-041 的导入链路本身是通的，但两张模板（楼盘 8 列、房源 9 列）覆盖不到
「导入完就能被用户找到」所需的字段与前提——**导入的房源要么根本不可见（缺商户），
要么用户一点筛选就消失（缺等级/竣工年代/地铁），要么压根导不进来（出售类）**。

## 2. 现状与证据

以下全部来自 2026-08-23 的本地全链路验收（本地 PG + dev server，master `b636ec6`）
与同日一次生产只读核查。

### 2.1 链路本身是通的，先说清楚

| 环节 | 实测 |
|---|---|
| 楼盘导入（批次 #1） | `completed`，3/3 新建，0 失败，8 秒。城市 / 行政区 / 商圈全解析正确，**含「徐汇」简称**（→ 行政区 id 7），别名解析可用 |
| 房源预检（批次 #3） | 总行 4 / 通过 3 / 失败 1，红条「确认后 3 套房源将立即对外可见」 |
| 房源导入 | `completed`，3/3 新建，0 失败。`listings.merchant` 自动继承楼盘商户，**D10 生效** |
| 前台可见 | 三条详情页全 200，列表页 11 → 14，**不需要等 TTL** |
| 一键下架 | 二次确认 → 三条详情页**立刻 404**，列表页回到 11 |

一键下架只改 `publication_status`（→ `unpublished`），`review_status` 与
`supply_visibility_hold` 原样不动，楼盘仍 `published/active`。两条轴独立，与代码注释一致。
顺带验证了 PR #83 的硬失效与 OPT-041 D11 的缓存接线在这条链路上都真实生效。

**所以本工作项不是修 bug，是补覆盖面。**

### 2.2 缺口一：商户是硬门槛，而导入路径不走已有的默认商户机制

有效供给 §8 要求 `listings.merchant` 非空（`supply-adapter.ts:749` / `:834` 的
`JOIN merchants m ON m.id = l.merchant_id` 是 INNER JOIN，NULL 直接排除）。
房源模板没有商户列，走 D10「继承楼盘当前生效的商户」——但**楼盘模板也没有商户列**，
新导入的楼盘一条 `building-merchant-relations` 都没有，于是
「先导楼盘、再导房源」第二步全线报 `NO_SUPPLY_MERCHANT_RELATION`。

OPT-041 规格已记录该连带影响并标注「本期接受」，本工作项即翻掉那条妥协。

**关键：项目里已经有默认商户机制，只是导入没用上。**
`src/domain/supply/default-merchant.ts` 定义了默认供给商户「官网」，并已接进两处
`defaultValue`：`Listings.merchant`（新建房源预选）与
`BuildingMerchantRelations.merchant`（新建关系预选）。手工录入早就不用真去挑商户。
`resolve-merchant.ts` 只认楼盘的生效关系，查不到就判错误行，**从不回落**。

手工补这一步的真实成本（实测三个楼盘）：`building-merchant-relations` 集合
**不在导航配置里**（`navigation-config.ts` 里没有这个叶子，任何角色包括 ADM 都看不到），
只能直敲 URL；每个楼盘一条，每条走「搜楼盘 → 搜商户 → 日期选择器点日期（带时间列）→ 保存」，
三个楼盘约 18 次点击，且没有任何批量入口。

### 2.3 缺口二：导入的楼盘一碰筛选就消失

OPT-036 给楼盘列表加了六个筛选维度，其中**等级 / 竣工年代 / 最近地铁**三个在
`buildings` 表里都有列（`grade` / `completion_date` / `nearest_metro_id`），
而楼盘模板一个都不覆盖。导入的三个楼盘这三列**全是 null**。实测：

| 查询 | 结果楼盘数 | 新导的三个在不在 |
|---|---|---|
| `/shanghai/buildings` | 10 | 在 |
| `?grade=grade-a` | 4 | **不在** |
| `?grade=super-grade-a` | 1 | **不在** |

不是 404，是「怎么筛不到」——比 404 更难被当成缺陷报上来。

### 2.4 缺口三：出售类房源压根导不进来

`normalize.ts:parseRent` 认得总价写法并解析成 `rmb-total`，但写入层的
`LEGACY_RENT_UNITS` 只映射三个租赁单位（`rmb-sqm-day` / `rmb-month` / `rmb-seat-month`），
碰到 `rmb-total` 让该行失败。预检期即拦下，实测报错原文：

> 租金列不支持总价写法（如"80万"），请改用元/㎡/天、元/月或元/工位/月这三种单价写法

文案对「租金填错」是可操作的，对**真正的出售房源是死路**——出售房源没有月租，改不出来。
`listings` 已有完整价格结构（`price_amount` / `price_currency` / `price_period` /
`price_unit`）与 `sale_terms_*`（产权年限 / 满五唯一 / 车位 / 税费承担），
`price_unit` 枚举里本来就有 `rmb-sqm-total`（单价）与 `rmb-total`（总价）。
**是导入没接这条路径，不是数据模型不支持。**

`buildings` 表则**没有任何价格字段**（只有 `total_floors` 与
`verification_info_price_verified_at`）。

### 2.5 缺口四：详情页有三格是空的，且零图片

导入房源的详情页渲染正常，价格也对（`5.5 元/㎡/天`，换算出 `46,200 元/月 · 280 ㎡`）。
但「关键规格」八格里三格显示「—」：**工位数**（模板没有，共享办公尤其致命）、
**楼盘等级**、**交通**。页面 `<img>` 数量 = **0**，连封面位都没有
（「不导入图片 / 平面图」是 OPT-041 的明确非目标，本工作项**不推翻**该非目标）。

### 2.6 生产实况（2026-08-23 只读核查，用户授权的一次性查询）

```
商户：仅 2 个
  id=1   官网                   CHANNEL  active  valid  过期 2099-12-31  服务城市：仅上海
  id=31  共享办公房源合作渠道     CHANNEL  active  valid  过期 2036-08-09  服务城市：仅上海
房源：总 2213 / 有商户 2210 / 已上架且无商户 0
楼盘商户关系：48 条
```

三条推论：

1. **外部供给方 = 0 是事实**，不是估计：两个商户都是 `CHANNEL` 渠道类型，没有外部业主或中介。
2. **「官网」完全合格**（active + 资质有效 + 2099 年过期），回落到它零资质风险。
3. **存量干净**：已上架且无商户的房源是 0 条，加回落不与任何存量冲突，不需要回填。

## 3. 商户门槛：为什么保留而不是删掉（用户已裁定）

用户提出「初期只有我们自己录入，商户是否可以去掉，或不作为发布门槛」。核查后的事实：

- **商户对终端用户完全不可见**：`src/components/frontend/` 与 `src/lib/frontend/`
  里零个 `merchant` 引用，public-catalog 的 DTO 契约里也没有。它是纯内部控制字段。
- **它的真实作用是一个合规批量下架开关**：`merchant-stop-listings.ts` 在商户停用时
  把其名下所有房源翻成 `reviewStatus=pending` 冻结，`protectMerchantStop` 停用前
  强制先看影响面板，恢复不自动解冻；§9/§10 负责资质过期、服务城市不覆盖时自动撤下。
- 这套开关的价值随外部供给方数量线性变化，当前 ≈ 0，成本 = 100% 摩擦。**用户判断成立。**

**裁定（用户 2026-08-23）：不删功能、不摘 §8，改为让导入回落到默认商户。**

理由：摘 §8 要改 canonical TS 精筛 + `supply-adapter.ts:749` / `:834` 两处 SQL 共三处，
该文件自己的注释就在警告「两处 SQL 只改了一处」的漂移风险；且将来接入外部供给方时，
「没有商户的存量房源」得先回填才能把门槛加回来。回落方案改动集中在一处解析逻辑，
门槛一条不动，合规开关全部保留。

## 4. 范围（用户裁定）

1. **楼盘模板补列**：供给商户编号、等级、竣工年份、最近地铁
2. **房源模板补可选商户列**（留空 → 继承楼盘 → 再回落默认商户）
3. **批次级默认值**：导入向导加一步「本批默认值」，行内留空即用批次默认
4. **单价 / 可售路径**：房源支持出售写法 + `sale_terms_*` 四项（D5）；**楼盘新增单值在售单价字段**（D1，涉及迁移）
5. **默认商户回落 + §10 校验**（见 §5.1）
6. **平台自营商户体系**：`isPlatformDefault` 字段（D2）+ 七城各建一个（D3）
7. **三个游离集合收编进导航**（D4）

明确不在范围：图片 / 平面图导入（沿用 OPT-041 非目标）、交互式列映射编辑器、
抓取式增量同步、`SupplySubmissions` 投放申请链路。

## 5. 需要改什么

### 5.1 默认商户回落，且必须校验 §10

`resolve-merchant.ts` 在楼盘无生效关系时回落到默认商户，与后台表单同一套判定
（复用 `resolveDefaultSupplyMerchant`，**不另写一份**）。

**但回落必须自己校验 §10（服务城市覆盖楼盘城市），不能沿用后台表单的将就。**
`default-merchant.ts` 只挑「启用 + 资质有效」，注释明说服务城市那条「由前台精筛 §10 兜底」——
后台表单可以这样，因为运营会当场看到房源不出现；**导入不行**，一次几百条，没人逐条去前台核。

不校验的后果是把 404 换个地方发生：房源写成 `published`、`merchant` 也填上了，
前台照样看不见，只是原因码从 §8 变成 §10。这正是 OPT-041 终审 D10 踩过那个坑的翻版。

默认商户不覆盖该楼盘城市时**判错误行**，文案要可操作，例如：
「默认商户『官网-杭州』未覆盖杭州，请先在商户管理里补服务城市」。

### 5.2 平台自营商户按城市分别建（用户裁定）

用户裁定：**按城市分别建平台自营商户**（而不是把「官网」的服务城市扩到七城），
这样商户停用级联能按城市粒度止血。

连带事项：

- 生产现有 `官网`（id=1，服务城市仅上海）需要处理——改名为「官网-上海」还是保留原名
  作为上海的那一个，需要确认；**2210 条存量房源指向 id=1，改名不影响外键，只影响展示**。
- 其余六城各建一个平台自营商户，服务城市对应各自城市。
- **不要用名称匹配来识别它们**：`default-merchant.ts` 现在按名称解析，注释里自己承认
  「商户表没有稳定业务码（只有 name / type）」。七个名字靠约定同步只会更脆。
  建议给 `Merchants` 加一个显式标识字段（如 `isPlatformDefault: boolean`），
  解析条件改成「isPlatformDefault + active + 资质有效 + serviceCities 含该城市」。
  **已裁定为 D2**（见 §7）。

### 5.3 楼盘模板补列的落库口径

- 等级 → `buildings.grade`（取值 `grade-a` / `super-grade-a` / `creative-park` / `serviced-office`，
  模板里用中文标签，走与 `装修` 同一套 `buildLabelToValue` 映射）
- 竣工年份 → `buildings.completion_date`
- 最近地铁 → `buildings.nearest_metro_id`（走 `resolveLocation` 的地铁解析）
- 供给商户编号 → 建 `building-merchant-relations`，`effectiveFrom` 取导入时点

### 5.4 出售 / 单价

- **房源侧**：接通 `price_amount` / `price_currency` / `price_period` / `price_unit`
  四件套，让 `rmb-sqm-total`（单价）与 `rmb-total`（总价）能落库；
  `sale_terms_*` 四项一并进模板（D5）。
  注意 OPT-041 当初拒绝映射 `rmb-total` 的理由是「期间/单位口径不明确，猜错会让前台
  价格错一个数量级」——本工作项要把那个口径**定下来**，不是绕过它。
- **楼盘侧**：`buildings` 表新增价格字段（用户裁定：新加字段，不做派生展示）。
  **这是本工作项唯一涉及迁移的部分**，已裁定为**单值**在售单价（D1，见 §7）。

### 5.5 顺带修正的文档漂移

`src/domain/supply/default-merchant.ts` 的文件头注释已过期且现在会误导：它写着
「前台有效供给判的是 `listing-merchant-relations` 里的关系记录，**不是**
`listings.merchant` 这个字段」——那张表已被 OPT-034 删除，`listings.merchant` 现在
就是唯一真相。`Listings.ts:707` 的注释已订正，这个文件没跟上。本工作项顺手改掉。

## 6. 需要改什么（清单）

- [x] `building-row.ts`：`BUILDING_COLUMNS` 8 → 13 列与各自校验
- [x] `listing-row.ts`：`LISTING_COLUMNS` 9 → 15 列（商户列 + 售价 + 出售条款四项）
- [x] `resolve-merchant.ts`：默认商户回落 + §10 校验 + 按名称解析商户
- [x] `default-merchant.ts`：改按 `isPlatformDefault` 解析（D2）+ 订正过期头注释（§5.5）
- [x] `normalize.ts`：`parseSalePrice`（总价/单价）+ `parseUnitPrice`
- [x] `import-task.ts`：结构化价格四件套 + `businessType` + `saleTerms` + 商户三级解析
- [x] `Merchants.ts`：`isPlatformDefault`（D2）
- [x] `Buildings.ts`：`saleUnitPrice` 单值（D1）
- [x] `20260824_110612_opt045_import_publishable_fields`（幂等写法，见下方订正）
- [x] `BulkImportViewClient.tsx` + `batch-defaults.ts`：批次级默认值
- [x] `navigation-config.ts`：收编三个集合（D4）
- [x] 各层测试（3683 passed，本工作项新增 52 条）+ `tests/e2e/sale-channel.spec.ts`
- [x] seed / roles 工厂补平台自营商户与 `data:import`（§9 两条坑）
- [ ] **生产数据变更：七城各建一个平台自营商户**（D3）；生产 `官网`(id=1) 补
      `isPlatformDefault`。见 §11 上线清单——**未做**

### 6.1 一处与 §7/§9 原文的冲突，已按 D1 处理

§9 写「迁移正文不可手改：`migrate:create` 生成后原样提交」，而 §7 D1 要求
「沿用 `20260810_003111` 的幂等写法（`to_regtype` 守卫 + `ADD COLUMN IF NOT EXISTS`）」
——两条直接打架。

按 D1 执行（改成幂等），依据：
1. `.agent/migrations.md` 里**没有**「正文不可手改」这条通则，真实规则是
   **破坏性迁移的批准绑定文件 SHA-256**，改内容会让指纹失效。本迁移是新生成的
   非破坏性 `ADD COLUMN`，不在批准清单里。
2. PR #86 与 OPT-048 都有同样的先例（把 `up()` 改成幂等）。
3. D1 自己写明了理由：生产 schema 与迁移链存在历史分叉，裸 DDL 会像 `sbh-104` 那样炸。

已核对生产：`is_platform_default` / `sale_unit_price` / 索引三样都不存在，
本迁移会真正执行、不是空转。

### 6.2 §4「楼盘模板补供给商户**编号**」改为按**名称**

两张模板在同一个向导里，一张填名称一张填编号会互相打架。统一按名称解析
（规范化复用 `normalizeAliasText`，与地理别名同口径；重名判错误行）。
用户 2026-08-24 裁定房源侧填名称，楼盘侧随之统一。

## 7. 已裁定（用户 2026-08-23）

原「待裁定」五条已全部拍板，逐条落到上面的章节里，此处保留决定与理由。

### D1 `buildings` 价格字段：**单值**

新增一个「在售单价」单值字段，**不做 min/max 区间**，也不做「在售房源单价区间」的派生展示。
这是本工作项**唯一涉及迁移**的部分。

> 迁移注意：写这条迁移前先读 PR #86 的教训——生产库与迁移链存在历史分叉，
> `migrate:create` 只对着 `src/migrations/*.json` 快照 diff，生成的裸 DDL 可能对空库正确、
> 对生产必炸。新迁移应沿用 `20260810_003111` / `20260821_161534` 的幂等写法
>（`to_regtype` 守卫 + `ADD COLUMN IF NOT EXISTS`），并在**模拟生产形态的库**上实跑验证，
> 不能只验空库。

### D2 平台自营商户的识别：**新增 `isPlatformDefault` 字段**

给 `Merchants` 加一个显式布尔字段，解析条件为
「`isPlatformDefault` + `status=active` + 资质有效 + `serviceCities` 含该楼盘城市」。

**不再按名称约定解析。** `default-merchant.ts` 现在按名称找「官网」，其注释自己就承认
「商户表没有稳定业务码（只有 name / type）」——一个名字尚可将就，D3 之后会有七个，
靠约定同步必然漂。

### D3 平台自营商户：**按城市分别建**

七个城市各建一个平台自营商户，`serviceCities` 对应各自城市。
**不把「官网」的服务城市扩到七城。**

理由：停用级联能按城市粒度止血——停掉杭州的平台自营商户，只冻结杭州导入的房源，
不影响上海。这正是商户体系保留下来的那个合规开关的价值所在（见 §3）。

生产现有 `官网`（id=1，服务城市仅上海）**保留原名不改**，直接当作上海的那一个，
补上 `isPlatformDefault=true` 即可。2210 条存量房源指向 id=1，不受影响。

### D4 `building-merchant-relations` 进导航 —— 连带修「集合」兜底区块

要补进导航。但实施时注意：**这不是「样式没写好」，是三个集合根本不在导航配置里。**

实测 `navigation-config.ts` 里这三个都没有：

| 集合 | 中文名 | 建议归属 |
|---|---|---|
| `supply-import-batches` | 导入批次 | 房源运营组，`requiredOperationCode: 'data:import'` |
| `location-aliases` | 地理别名 | 区域管理组 |
| `building-merchant-relations` | 楼盘商户关系 | 商户合作组 |

后台左下角那个挤成一团、与上面九个分组风格明显不一致的「集合 / 导入批次 / 地理别名」区块，
是**未被自定义导航收编的集合的兜底渲染**——它长得不一样，是因为它根本不走自定义导航那套。

**正确修法是把三个集合收编进正常分组，让兜底区块自然消失**，而不是去调那块 CSS。
佐证：OPT-041 加两个批量导入入口时就是显式写进 `navigation-config.ts` 的（还带
`requiredOperationCode` 注释），本仓库的既定做法就是「所有入口显式收编」，这三个是漏了。

### D5 `sale_terms_*` **进**房源模板

产权年限 / 满五唯一 / 车位 / 税费承担四项进模板，与 D1 的出售单价配套。

## 8. 验收

- 一份只填必填列的楼盘表 + 一份只填必填列的房源表，**中间不做任何后台操作**，
  导入完成后前台能搜到、点得进；
- 在楼盘列表页任选一个筛选维度（等级 / 竣工年代 / 地铁），新导入的楼盘**不消失**；
- 出售类房源能导入，详情页价格展示正确（单价与总价两种写法都验）；
- 默认商户不覆盖楼盘城市时，预检**判错误行**并给出可操作文案，而不是导入成功后前台隐身；
- 停用某城市的平台自营商户 → 该城市导入的房源被冻结，**其它城市不受影响**（D3 的核心验收点）；
- 后台导航里不再出现「集合」兜底区块，三个集合各自在正常分组里（D4）；
- 不得回归：`pnpm test` 全绿、`verify:leasable-area` 与 `verify:unique-violation` 通过。

## 9. 坑

- **加 `buildings` 价格字段的迁移，别只在空库上验。** 2026-08-23 的生产部署
  （`sbh-104`）就是栽在这上面：`20260821_161534` 用裸 `CREATE TYPE` 建
  `enum_buildings_data_source_source`，而生产早就有这个类型（`huizuxuanzhi` 那套采集导入
  的 schema 与数据从未走过迁移链），迁移失败 → 容器启动命令
  `migrate-locked.ts && pnpm start` 的 `&&` 短路 → 端口没人监听 → `deploy_failed`。
  本地与 CI 全绿完全不能推出生产跑得通。修复见 PR #86，写法沿用
  `20260810_003111`（那是同一类分叉的第一次补账，当时只补了 listings，漏了 buildings）。
  **D1 的新迁移必须用同样的幂等写法，并在模拟生产形态的库上实跑。**

- **别只看「导入成功」就宣布完成**：OPT-041 D10 的教训是房源 `published` 了但前台 404。
  验收必须以「前台能搜到」为准，不是以批次状态为准。
- **默认商户回落一定要校验 §10**，理由见 §5.1。这是本工作项最容易被省掉、
  省掉之后症状又最像「没坏」的一条。
- **迁移正文不可手改**：`payload migrate:create` 生成后原样提交（仓库根 CLAUDE.md）。
- **改 collection 必须带迁移**，`.githooks/pre-commit` 会拦。
- **本地库没有平台自营商户**：本地 seed 里只有「静安置业」「浦东商办代理」，
  没有「官网」，所以 `resolveDefaultSupplyMerchant` 在本地一直返回 null、预选空转。
  实施时要同步给 `src/test/factory/` 与 seed 补上，否则本地验收测不到回落路径。
- **seed 会覆盖内置角色权限**：`scripts/seed.ts` 的角色 update 分支无条件写入
  `BUILTIN_ROLES`，而 `src/test/factory/roles.ts` 里没有 `data:import`——
  先迁移再 seed 会擦掉 OPS 的导入权限（2026-08-23 实测）。这条与本工作项无关但同域，
  实施时顺手修掉可省一次踩坑。

## 11. 上线清单（**未做，验收前必须完成**）

### 11.1 出售频道已随本工作项打开

`NEXT_PUBLIC_SALE_CHANNEL_ENABLED` 由 ff07d21 引入并默认关闭
（「出售功能需要更长的验证周期」，用开关把代码上线与用户可见解耦）。
用户 2026-08-24 裁定打开，已改 `Dockerfile` 的 **builder 与 runner 两个阶段**
+ CI + `.env.example`。

**这是本工作项之外的产品变更，连带上线五处**：`/sale` 与 `/[city]/sale` 两个
公开页、sitemap 出售条目、后台租售类型与出售信息字段组、`mark_sold` 发布动作。

⚠️ 生产的 `NEXT_PUBLIC_*` 一律烤在 Dockerfile 里、**不走 CloudRun 服务级环境变量**
（`tcb deploy` 不传 `--env-vars`）。构建期内联，所以**必须重新部署一次**才生效，
改 CloudRun 控制台没用。

出售频道此前**一条 e2e 都没有**（关着时恒 404），已补
`tests/e2e/sale-channel.spec.ts` 并挂进 CI 的多城市那一趟。

### 11.2 生产数据变更（D3，尚未执行）

七城各建一个平台自营商户，缺任何一个城市，**该城市的导入回落会判错误行**
（`NO_PLATFORM_DEFAULT_MERCHANT`），文案会指向「去商户管理补」。

| 操作 | 说明 |
|---|---|
| `官网`（id=1） | **保留原名**，仅补 `isPlatformDefault=true`。2210 条存量房源指向它，改名不影响外键 |
| 其余六城 | 各建一个，`serviceCities` 对应各自城市、`status=active`、`qualificationStatus=valid`、`qualificationExpiresAt` 取远期 |

每个都必须满足「`isPlatformDefault` + 启用 + 资质有效 + `serviceCities` 含该城市」
四条，缺一条解析不到——尤其**别漏勾服务城市**，那是最容易漏且症状最像「没坏」的一条。

### 11.3 部署顺序

1. 合并 → 手动触发 `deploy.yml` 并勾 `promote`（构建期内联出售开关要靠这次构建）
2. 容器启动自跑迁移（`migrate-locked.ts`，幂等）
3. 做 §11.2 的数据变更
4. 再走 §8 验收

**顺序不能颠倒**：数据变更依赖 `is_platform_default` 列存在，而该列由第 2 步的迁移建出。

## 10. 相关

- `specs/work-items/OPT-041-supply-bulk-import.md` §10 明确非目标、§11 D10 / D11 定稿
- `payload-office-platform/.agent/supply.md`「完整谓词」§8 / §9 / §10
- `src/domain/supply/merchant-stop-listings.ts`：商户停用级联，本工作项保留的合规开关
- PR #83（供给缓存硬失效）：本次验收顺带验证其在导入 / 下架链路上真实生效
