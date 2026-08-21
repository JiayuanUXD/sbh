# Task Packet：OPT-041 后台批量导入楼盘 / 房源

> 状态：**设计定稿，待排期**
> 创建日期：2026-08-21
> 来源：用户需求「后台增加批量导入楼盘/房源」，经 brainstorming 逐项定稿
> 编号说明：OPT-038 已被城市招募页改版预留，040 已占用，故取 041

---

## 1. 一句话

给后台加两个批量导入入口（楼盘 / 房源），把运营手工整理的 Excel/CSV 变成库里的主数据；
难点不在字段搬运，在**文本 → 关系的解析**、**重复导入的幂等**和**直接上架带来的止血能力**。

## 2. 定稿决策（brainstorming 逐条确认，实现时不要重新讨论）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 数据来源是**运营手工整理的 Excel/CSV**，不是抓取、不是外部提交 | 脏在关系字段（"浦东"、楼盘别名错别字），不脏在数字 |
| D2 | **两套独立模板 / 两个入口**：楼盘导入、房源导入 | 房源的楼盘列必须命中已有楼盘；匹配不到即错误行，**不自动建楼盘**——楼盘是不可物理删除的主数据，错别字会撑出重复楼盘 |
| D3 | **两阶段「预检 → 确认执行」，只导通过行** | 几百行的手工表一次全对不可能；全或无会退化成"改一个错重传一次"的死循环 |
| D4 | 楼盘导入后 `status=published`；**房源导入后也直接上架** | 用户明确要求。风险与补偿见 §3 |
| D5 | 关系解析：**规范化精确匹配 + 别名表，绝不模糊自动采用** | 猜错写进的是主数据关系，事后清理成本极高 |
| D6 | 幂等键 = 模板里的**「编号」列**，落到 `dataSource.(source, externalId)`，有则更新无则新建 | 运营重传整张表结果稳定；自动指纹去重会把"同层同面积两间房"误判为重复（`SupplySubmissions` 幂等键当年踩过同类坑） |
| D7 | **预检同步 + 写入走 Jobs Queue** | Payload `create` 跑完整 hook 链，200 行 20~60s，逼近 CloudRun 请求超时；Jobs Queue 已在 `autoRun`，基础设施现成 |
| D8 | 别名表做成**后台可维护的集合** | 运营自己加别名才能收敛，写死在代码里要发版 |
| D9 | 批次的 `validRows` 快照**完成 7 天后清空**，其余字段永久保留 | 省空间；stats / rowErrors / affectedIds 才是复盘要用的 |

### 已否决的方案（别再捡回来）

- **匹配不到楼盘就自动建草稿楼盘**：会产生"星展银行大厦"/"星展大厦"两条重复主数据。
- **模糊匹配 + 置信度自动采用**：同上，且错误静默。编辑距离只用来生成**给人看的候选建议**。
- **一步到位上传即写**：运营在按下上传前完全不知道会发生什么，而这里写的是直接上架的主数据。
- **导入图片**：媒体走既有 `ListingMediaManager`，导入链路一律不碰 `mediaItems` / `gallery` / `coverImage`。

## 3. 「直接上架」的风险与补偿（D4）

房源直接上架 = 一张手工 Excel 直连前台，绕过了 `.agent/supply.md` 12 条有效供给谓词里
**唯一挡人为错误的那道人工闸门**（审核）。用户已确认接受。实现必须带两个不挡路的补偿：

1. **预检报告顶部红条**，确认按钮上方写明：`确认后 N 套房源将立即对外可见`。
2. **按批次一键下架**：把本批 `affectedIds` 的 `publicationStatus` 打回下架
   （**不是删除**——AGENTS.md 禁止物理删除已引用主数据）。出事三十秒止血。

注意 `adminAutoPublish`（`src/domain/review/admin-auto-publish-hook.ts`）：管理员保存即发布。
导入以 ADM/OPS 身份走 Local API，落地状态必须**显式设定**而不是依赖该 hook 的副作用，
否则 OPS 与 ADM 两种操作者会导出两种状态。

## 4. 架构

### 4.1 视图

| 视图 | 路径 | 对象 |
|---|---|---|
| 楼盘批量导入 | `/import/buildings` | `Buildings` |
| 房源批量导入 | `/import/listings` | `Listings` |

按 `/geography/*` 的既有做法注册（`payload.config.ts` 的 `admin.components.views`，
一个组件按 pathname 解析模式，列表视图 `exact: true`）。入口挂 `AdminNavigation` 的供给分组。

### 4.2 引擎分层（四个互不知情的单元）

```
解析层  parse-workbook.ts    xlsx/csv → RawRow[]        纯 IO，不懂业务
规范层  normalize.ts         去空格/全半角/繁简/单位     纯函数
匹配层  resolve-refs.ts      文本 → Location/Building ID 纯函数 + 注入查询
校验层  row-schema.ts        RawRow → ValidRow|RowError  纯函数（Zod）
写入层  import-task.ts       ValidRow[] → Local API      唯一碰库的地方
```

`normalize` / `resolve-refs` / `row-schema` 全是纯函数，严格 TDD（对齐
`src/domain/supply-submission/schema.ts` 的既有做法）。写入层用 Payload Local API，测试跑真库。

外部输入（上传文件）以 `unknown` 进入，由 schema 收口——不得用 `any` / `as any`。

### 4.3 数据流

```
① 上传 .xlsx/.csv
      ↓ POST /api/bulk-import/preflight  (multipart，同步)
② 解析 → 规范化 → 关系解析 → 校验        全程不写业务表
      ↓
③ 落一条 SupplyImportBatches (status=preflight)，存 validRows + rowErrors
      ↓
④ 报告页：「共 217 行，183 行可导入，34 行有问题」
   ⚠️ 红条：确认后 183 套房源将立即对外可见
   [下载错误表.xlsx] [取消] [确认导入]
      ↓ POST /api/bulk-import/batches/:id/execute
⑤ 复核权限 + 城市范围 → status=queued → 入队
      ↓
⑥ Task 分片写入（每批 20 行），更新 processed/created/updated/failed
   页面轮询 GET /api/bulk-import/batches/:id
      ↓
⑦ 完成：结果卡片 + [批量下架本批房源]
```

第 ③ 步把预检结果落库是关键：确认执行时**不重新上传文件**，杜绝"传的和确认的不是同一份"。

## 5. 数据模型变更

### 5.1 新集合 `SupplyImportBatches`（供给导入批次）

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | select | `buildings` \| `listings` |
| `status` | select | `preflight` \| `queued` \| `running` \| `completed` \| `failed` |
| `operator` | relationship(users) | readOnly，服务端写 |
| `city` | relationship(locations) | readOnly，OPS 越权校验锚点 |
| `fileName` / `rowCount` | text / number | 溯源 |
| `validRows` | json | 预检通过的规范化行；**完成 7 天后清空** |
| `rowErrors` | json | 行号 + 原值 + 错误原因 + 候选建议 |
| `stats` | group | `processed` / `created` / `updated` / `failed` |
| `affectedIds` | json | 本批产生或更新的 ID —— 回滚锚点 |

批次记录**不物理删除**（AGENTS.md 第 4 条：不得物理删除业务历史）。

### 5.2 新集合 `LocationAliases`（地理别名）

`normalizedAlias` + `kind`(`city`/`district`/`business_area`/`metro_station`) 组合唯一
→ `location` 关系。运营遇到一次"浦东"手工加一条，下次自动认识。
首次导入预计补几十条，之后趋近零维护。

别名只影响**导入解析**，不参与前台查询与 SEO。

### 5.3 既有集合改动（各需一份迁移，见 `.agent/migrations.md`）

- `Listings.dataSource.source` 枚举增 `manual-import`（现仅 `huizuxuanzhi`）。
- `Buildings` 新增 `dataSource` 组，与 `Listings` **同构**（`source` / `externalId` / `syncedAt` / `sourceUrl`），
  含同样的 `admin.condition`（无值时不显示，手工新建楼盘不需要维护）。
- 两者各加 `(dataSource.source, dataSource.externalId)` **局部唯一索引**
  （`WHERE dataSource_source IS NOT NULL`）——幂等的数据库兜底，不靠应用层自觉。

### 5.4 slug

`Buildings.slug` / `Listings.slug` 均 required + unique。导入时由
`slugify()`（`src/domain/shared/slug.ts`，pinyin-pro）从名称/标题生成，
冲突则追加数字后缀直至唯一。**模板里没有 slug 列**——运营编不出 `jing-an-zhong-xin`。

## 6. 匹配与错误语义（D5 / D6）

- 地理字段：规范化（去空格、全半角、繁简、`上海市`→`上海`、`区`后缀）后精确匹配名称 → 查别名表。
  都不中即错误行，错误原因附**编辑距离前 3 的候选建议**：`区域"浦东"无法识别，是否指：浦东新区？`
  建议只给人看，系统绝不自动采用。
- 楼盘列：接受**楼盘编号或楼盘 slug**；页面提供「楼盘对照表导出」。
  名称匹配作兜底，命中多个同名楼盘 → 报错要求改填编号消歧，**不猜**。
- 幂等：`(manual-import, 编号)` 命中则 `update`，否则 `create`。
  编号在同一次导入内必须唯一，重复即错误行。
- 城市与区域的从属关系必须校验一致（区域 `parent` 不是所填城市 → 错误行），
  命名口径以 `docs/geography-code-convention.md` 为准。

## 7. 权限与审计

- 仅 **ADM + OPS**（角色码见 `.agent/permissions.md`）。
- OPS 只能导入**授权城市**内的对象，服务端**逐行**校验；越权行判为错误行，
  **不静默跳过**——静默跳过会让运营以为导进去了。
- 权限在 endpoint 内执行；Custom View 的守卫只改善体验，直接打 API 无权必须 403。
- 批量导入属 `.agent/permissions.md` 的「高风险操作」：每次 execute 与每次批量下架
  各写一条 `AuditLogs`，含请求 ID、操作者、批次 ID、type、created/updated 数、`affectedIds`。

## 8. 错误处理

| 层 | 失败时 |
|---|---|
| 文件 | 非 xlsx/csv、超 5MB、超 1000 行、表头缺必需列 → 整个预检失败，一行不解析 |
| 行 | 错误行不阻塞其它行，进 `rowErrors`；可下载成带「错误原因」列的 xlsx |
| 写入 | 单行 create 抛错 → 记 `failed`，Job 继续，**不回滚已成功的行**（与"只导通过行"一致） |
| Job 崩溃 | 批次停在 `running`，参照 `recoverStaleCityPartnerNotificationJobs` 做超时恢复；页面显示「已中断，已导入 N 条」，`affectedIds` 仍可回滚 |

## 9. 测试（见 `.agent/testing.md`）

**纯函数层（Vitest，先写测试）**
- 规范化：全半角、繁简、`上海市`/`上海`、面积单位带 `㎡`、租金带 `元/㎡/天`
- 别名命中 / 未命中 / 候选建议排序
- 楼盘同名消歧报错、编号在批内重复报错
- 必填缺失、数值越界、区域与城市从属不一致
- OPS 越权行判错

**写入层（真库）**
- 幂等：同一批跑两次 → 第一次 created 183 / updated 0，第二次 created 0 / updated 183
- 局部唯一索引真的拦住并发重复写入
- 落地状态：楼盘 `published`、房源上架，且 ADM 与 OPS 两种操作者结果一致
- 审计落库

**E2E（Playwright）**
上传 → 预检报告（含红条与错误表下载）→ 确认 → 轮询完成 → 前台能查到该房源
→ 一键下架 → 前台查不到。这条链路同时验证 D4 与 §3 的止血能力。

## 10. 明确非目标

- 不导入图片 / 平面图。
- 不做交互式列映射编辑器（模板列名固定）。
- 不做抓取式增量同步（那是另一条链路，`huizuxuanzhi` 来源保持不动）。
- 不改 `SupplySubmissions` 投放申请链路。
- 不给 MGR / BRK / CSR 开放导入。
