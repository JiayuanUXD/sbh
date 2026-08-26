# CloudBase 部署进度

商办租赁平台（Payload CMS）部署到腾讯云 CloudBase 的进度与待办。

## 目标架构（方案 A）

**CloudRun (Container mode) 跑 Payload + TencentDB for PostgreSQL 存数据 + COS 存媒体**

- Payload 是 Next.js 16 全栈应用 → CloudBase 只能用 CloudRun **Container mode**（需 Dockerfile、监听注入的 `PORT`）
- Payload 需要标准 SQL 连接串（`postgres://host:5432`），CloudBase 内置 PG/MySQL 不提供 → 数据库用独立的 **TencentDB for PostgreSQL** 实例
- CloudRun 容器无状态 → media 存 **腾讯云 COS（S3 兼容）**

## 已完成 ✅（截至 2026-08-07）

| # | 任务 | 说明 |
|---|------|------|
| 1 | DB 适配器 SQLite → PostgreSQL | `@payloadcms/db-postgres`；`payload.config.ts` 按有无 `DATABASE_URL` 自动切 PG/SQLite；`push:false` 禁 dev push（避免拨测表误删卡死） |
| 2 | Media 存储接入 COS(S3) | `@payloadcms/storage-s3`，绑定 `media`，`forcePathStyle:true`（`S3_BUCKET` 未设时 disabled） |
| 3 | 容器化 Dockerfile + PORT | 多阶段**完整镜像**（非 standalone，保留迁移能力）；`ENV PORT=80`+`EXPOSE 80`；启动跑 `payload migrate` 再 `next start` |
| 4 | PG 迁移 + 修 ENUM bug | `src/migrations/20260723_160143_init.ts` 应用到 CloudBase PG；`Listings.listingType` 默认值 `private-office`→`traditional-office`（PG strict ENUM，SQLite 不报） |
| 5 | 首次上线（MCP deploy） | CloudRun 服务 `sbh` 已 Running，100% 流量。域名 `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com`；验证 `/`、`/api/listings`(有种子数据)、`/admin` 均 200 |
| 6 | CI 部署 workflow | `.github/workflows/deploy.yml`：`tcb cloudrun deploy` 上传 ZIP 在线构建 + 冒烟测试。已推送（commit `fd5e897`）。**注：当时是 push master 自动触发；2026-08-18 的 `6e3861b` 曾改为手动，2026-08-26 又改回自动并带 promote** |
| 7 | CI 首次跑通 | 2026-07-24 跑通（run `30073559226`，`tcb login` + deploy + 冒烟 `GET /api/listings` 200 全绿）。修三个坑：① 3 个 GitHub secret 之前名字填成了 SecretId 的值（全空）→ 重建 `TCB_SECRET_ID`/`TCB_SECRET_KEY`/`TCB_ENV_ID`；② `tcb login` 后 telemetry `Y/n` 提示无 tty 卡 exit 130 → job 设 `CLOUDBASE_CI: '1'`（isYesMode 自动跳过）；③ 灰度部署 `list` 提示 `--force` 不挡 → `printf '\n\n\n' \|` 喂回车选默认"否"（自动切流量） |

**线上资源**：EnvId `sbh-d9gnr8h5ef7e22e30`；PG 实例 `postgres-ilf7zhts`（公网 `sh-postgres-ilf7zhts.sql.tencentcdb.com:26710`，内网 `172.17.0.8:5432`，db `postgres`，role `sbh`）；迁移 `20260723_160143_init` 已应用，种子数据 5 locations/2 buildings/2 listings/4 amenities/1 page。服务级环境变量 `DATABASE_URL`/`PAYLOAD_SECRET`/`NODE_ENV` 已在 CloudRun 配好（不入 git，存 `.env.local`）。

## 待完成 ⏳

### ✅ P0 — 让 CI 首次部署跑通（2026-07-24 完成；当时的自动触发已于 2026-08-18 移除）

- [x] 腾讯云 [CAM](https://console.cloud.tencent.com/cam) 新建子用户（编程访问），拿 SecretId/SecretKey（**勿用主账号**）
- [x] 给子用户绑定预置策略：`QcloudAccessForTCBRole`、`QcloudAccessForTCBRoleInAccessCloudBaseRun`（能 deploy 成功即已绑对）
- [x] 仓库 Settings → Secrets → Actions 加 3 个：`TCB_SECRET_ID`、`TCB_SECRET_KEY`、`TCB_ENV_ID`=`sbh-d9gnr8h5ef7e22e30`（用 `gh secret set` 写入）
- [x] 触发运行确认 `tcb login` + deploy + 冒烟 `GET /api/listings` 200 全绿（run `30073559226`）
- [x] 验收：`git push master`（改 `payload-office-platform/`）即自动上线 —— **此结论已于 2026-08-18 作废**，见 `6e3861b`：自动触发被移除，发布改为手动

> 踩坑记录（见上表第 7 行）：secret 值误填为名字、telemetry 交互提示、灰度部署 list 提示，三个都会让 CI 在无 tty 下 exit 130。

### 🟠 P1 — 业务可用
- [x] 首个管理员已存在（`85851205@qq.com`），从 `/admin/login` 登录即可。注：`/admin/create-first-user` 在 users 表非空时会 `notFound()`（白屏是正常行为，不是 bug）
- [x] 后台 CRUD listing / 上传媒体，重启容器后数据与媒体仍在（PG + COS 持久化已验证）

### 🟡 P2 — 优化（可选）
- [ ] 流量稳定后把 CloudRun `MinNum` 1→0 省成本（代价：冷启动延迟）
- [ ] 容器接 VPC + PG 内网地址 `172.17.0.8:5432` 替代公网（安全 + 延迟），去掉公网 PG 暴露

> **当前状态（2026-08-07）**：生产**强制 COS 存媒体**（`config-guard` 校验，缺 `COS_*` 拒绝启动；CI e2e 豁免）。首页 hero 背景视频已迁到 COS 媒体库（`/api/media/file/hero-bg.mp4?prefix=media`），不再打包进部署包，包体积 2.51MB → 1.02MB。

## 发布（CI）

**合并到 `master` 即上线。** Workflow：
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。`quality.yml` 在
`master` 上整体成功后经 `workflow_run` 接力，自动全量切流。

| 怎么做 | 结果 |
|---|---|
| 合并到 `master`，改动命中 `quality.yml` 的 `paths` | 构建 → 切 10% 灰度 → 冒烟（`/api/health` + `/`）→ **全量切流**；失败则 rollback |
| 合并到 `master`，改动全在 `paths` 之外（`specs/`、根级 md 等） | 闸门不跑，因此不部署 |
| 闸门红 | 不部署（job 自己判 `workflow_run.conclusion == 'success'`） |
| Actions 手动触发，`promote` 勾上 | 同第一行，用于重发某个历史 ref |
| Actions 手动触发，`promote` 不勾 | 构建并提交一个 GRAY 版本，**0% 流量**，线上保持当前版本 |

```bash
gh workflow run deploy.yml -f promote=true --ref master
```

> **触发方式的沿革（两次反向，别把中间那版的理由套到现在）**
>
> `6e3861b`（2026-08-18）把自动触发砍掉，理由是当时自动触发一律 `promote=false`：
> 每次合并都构建一个 0% 流量、永远没人用的 GRAY 版本——白烧约 8 分钟平台构建和一个
> CloudRun 版本号，真要发布时同一个 commit 还得再构建一遍。`sbh-096` 就是这样一个
> 「为没人用而构建」的版本，而它在镜像推送阶段挂掉了。
>
> 2026-08-26 改回自动，但**带 `promote`**。上一版的浪费来自「构建了却不用」，
> 不来自「自动」；每次构建都真的上线，那笔浪费就不存在了。顺带找回了
> 「master 上能不能构建成功」的常态信号。
>
> 代价：合并即进生产，没有「先合着攒一批」这个中间态。要攒就留在分支上。
>
> `tests/production-deploy-config.test.ts` 锁住了 workflow_run 触发、job 判
> conclusion、自动路径 promote、checkout 钉 head_sha 这四条，以及四处文档不得
> 再声称「只能手动」（该守卫已于 2026-08-26 随触发方式一并反向重写）。

> ⚠️ **代码包体积是这条通道的命门**。CI 把 `payload-office-platform/` 打成 ZIP 传到腾讯云 COS，跨境吞吐下体积直接决定成败：
>
> | 包体积 | 结果 |
> |---|---|
> | 297 KB（`255f82b` 及之前） | ✅ 连续 4 次部署，52s–1m12s |
> | 7.64 MB（`e0159fe` merge 起） | ❌ `curl: (28) timed out after 180002 ms with 0 bytes received`，5 次重试全挂 |
>
> 2026-07-27 的连续部署失败就是这么来的：`payload-office-platform/artifacts/verification/` 里 31 个视觉回归 PNG 把包撑到 6.5 MB。**当时误判成「GitHub 托管 Runner 上传通道不可用、需换大陆自托管 Runner」——不成立**，同一 Runner 同一 COS 端点在 297 KB 时代跑得好好的。
>
> 现在的防线（2026-07-28）：
> - `payload-office-platform/.gitattributes` 用 `export-ignore` 把 `tests/` 与 `src/migrations/*.json` 挡在包外（**`.dockerignore` 在这一步不生效**——平台是先收包、再在云端 build）。包回到 869 KB。历史视觉回归 `artifacts/` 目录已整体删除，不再需要排除。
> - deploy 步骤有 3 MB 硬阈值，超了立刻失败并提示，而不是耗 15 分钟超时才暴露。
> - `--max-time` 从 180s 提到 600s，给跨境传输留余量。
>
> 再遇到上传超时，**先看日志里打印的「代码包体积」**，别急着怀疑 Runner。自托管 Runner 仍是值得做的长期优化（跨境延迟客观存在），但不是这次的阻塞项。CI 不通时的正式发布路径见上面的[本地发布](#本地发布ci-上传通道不可用时的正式路径)。

机制：GitHub Actions 用 CloudBase CLI（`tcb`）上传 `payload-office-platform/` 的 ZIP 到云端，平台在线 `docker build` 并发布新版本（与 MCP `manageCloudRun(deploy)` 同一底层）。CI 端不装依赖、不构建。服务级环境变量（`DATABASE_URL`/`PAYLOAD_SECRET`/`NODE_ENV`）在控制台/MCP 配好后由服务保留，代码部署不清空，无需每次重传。

### 一次性设置（在仓库 Settings → Secrets and variables → Actions → New repository secret）

需要 3 个 secret，对应一个腾讯云 CAM 子账号（**不要**用主账号）：

| Secret | 来源 |
|--------|------|
| `TCB_SECRET_ID` | 腾讯云 [CAM](https://console.cloud.tencent.com/cam) 新建子用户 → API 密钥 → SecretId |
| `TCB_SECRET_KEY` | 同上 → SecretKey |
| `TCB_ENV_ID` | `sbh-d9gnr8h5ef7e22e30` |

子账号需绑定 CAM 预置策略：
- `QcloudAccessForTCBRole`（云开发访问云资源）
- `QcloudAccessForTCBRoleInAccessCloudBaseRun`（云托管访问 VPC/CVM）

设置完成后，合并到 `master` 即会在闸门通过后自动发布；也可在 Actions 页 `Run workflow`（或 `gh workflow run deploy.yml -f promote=true --ref master`）重发某个 ref，见上面「发布（CI）」。部署日志与冒烟测试（`GET /api/listings` 期望 200）在 Actions 运行记录里查看。

## 本地发布（CI 上传通道不可用时的正式路径）

> **现状（2026-07-27）**：GitHub 托管 Runner 上传代码包到 CloudBase 会连续 5 次 180 秒超时且**收到 0 字节**，CI 的 deploy 阶段因此必失败（quality 质量门是通过的）。同一个包从本地网络 2.4 秒传完。在换成中国大陆/腾讯云内的自托管 Runner 之前，**生产发布走本地脚本**。

脚本：[`scripts/cloudrun-release.sh`](scripts/cloudrun-release.sh)。前置条件是本机 `tcb` CLI 已登录（`tcb login`）。

```bash
./scripts/cloudrun-release.sh release
```

`release` 按与 CI 相同的发布纪律串起全流程：打包上传 → 建灰度版本（**0% 流量**）→ 等状态 `normal` → 切 10% 灰度 → 冒烟 → 全量 → 复验，任一步失败立即 `traffic rollback`。也可以分步执行 `status` / `deploy` / `canary <pct>` / `smoke` / `promote` / `rollback`。

脚本里固化了几个踩过的坑，改动前先读注释：

- **打包必须用 `git -C "$REPO_ROOT"`**。在子目录里执行 `git archive HEAD:payload-office-platform`，路径会被相对解析，静默产出 22 字节的**空 zip**。脚本因此在上传前强制校验包大小与 Dockerfile 是否存在。
- **环境变量不能通过管控面 API 改**。`UpdateCloudRunServer` 的 `Items` 接受 `{Key:"EnvParams",Value:...}` 且不报错，但平台会**静默忽略**——环境变量走 SDK 的 AES-256-CBC 加密通道。改 `DATABASE_URL` / `PAYLOAD_SECRET` 请到 CloudBase 控制台操作。
- **不用 `set -u`**。macOS 自带 bash 3.2 展开空数组 `${arr[@]}` 会直接报错，而 `UploadHeaders` 目前就是空数组。
- `tcb` CLI 的 stdout 混有 spinner 输出，取 JSON 必须 `sed -n '/^{/,$p'`。

## ⚠️ 未决：生产库有 6 条迁移在仓库里不存在（schema 漂移）

**发现时间**：2026-08-10，双落地页部署后核对生产 `payload_migrations` 时。

生产库已应用 43 条迁移，master 只有 37 个迁移文件。以下 6 条**在生产已应用，但 `git cat-file` 确认不在 master、`git log --all` 确认不在本仓库任何分支**：

```
20260805_063954
20260805_082216_add_listings_data_source
20260809_180000_import_huizuxuanzhi_shared_offices
20260809_183000_remove_shared_office_source_branding
20260809_184000_attach_shared_office_building_covers
20260809_190000_complete_shared_office_images
```

**这不是数据-only 漂移，含 schema 变更。** 生产 `listings` 表存在仓库完全没有声明的字段组（`grep -rn dataSource src/` 为空）：

| 生产列 | 类型 |
|---|---|
| `data_source_external_id` | varchar |
| `data_source_source` | USER-DEFINED（自定义枚举） |
| `data_source_source_url` | varchar |
| `data_source_synced_at` | timestamptz |

**日常无害**：`push: false` 下 Payload 不碰未声明的列，应用也不读它们。当前生产 70 座楼盘 / 2211 条房源正常服务。

**真正的风险有两条**：

1. **无法从 master 重建这个库。** 新建 staging、灾备重建或任何"从零跑迁移"的环境，都会缺这 6 条迁移的 schema 与数据（含惠租选址的共享办公导入数据）。重建出来的环境与生产不等价。
2. **一旦有人对生产开了 dev pushSchema，那 4 个未声明的列会被判为多余而删掉**，连带其中的导入数据。本文档开头已警告禁用 dev push，这条漂移让该警告的后果变严重。

### 已定位情况（2026-08-10 排查结果）

**2 条可直接恢复** —— 在远端分支 `origin/feat/import-huizuxuanzhi` 上完好存在（含配套 `.json`）：

```
payload-office-platform/src/migrations/20260805_063954.ts / .json
payload-office-platform/src/migrations/20260805_082216_add_listings_data_source.ts / .json
```

这两条正是 `listings` 那 4 个 `data_source_*` 列的来源。该分支**从未合入 master**，但生产被从它部署过。

**4 条暂未找到** —— 已搜遍全部 28 个远端分支、全部本地分支、`git fsck --lost-found` 的 18 个悬空提交、以及现存 stash，均无：

```
20260809_180000_import_huizuxuanzhi_shared_offices
20260809_183000_remove_shared_office_source_branding
20260809_184000_attach_shared_office_building_covers
20260809_190000_complete_shared_office_images
```

它们只在生产 `payload_migrations` 里留了名字。按时间戳（2026-08-09）推断是在某台机器的未提交工作区里直接跑的。

**为什么没有直接把漂移"修掉"**：那 4 条含共享办公房源的数据导入逻辑，无法从生产 schema 反推；照现状手写"追平迁移"等于伪造迁移历史，还拿不回导入逻辑。这需要执行者提供原始文件。

**恢复清单**（按顺序做）：

1. **先合 `feat/import-huizuxuanzhi`**（或只把那 2 个迁移 cherry-pick 到 master）。这一步能立刻消掉 2/6 的漂移，且是本仓库内可自足完成的。合并前在全新空库上验证能从零重放。
2. 向 2026-08-09 执行共享办公导入的人索取剩下 4 个 `.ts` + `.json`，**不要改文件名与内容**（时间戳决定执行顺序）。
3. 在一个**全新空库**上跑 `pnpm payload migrate`，验证 43 条能从零重放到与生产一致的 schema。
4. `pnpm migrate:status` 确认目标环境 0 pending 后再合并；生产已应用过这些名字，合并后不会重复执行。
5. 若确认那 4 个文件永久丢失：由 DBA 导出生产 schema，人工编写一次性对齐迁移，并在本节记录该决定与差异清单。

**在恢复完成前**：不要新建从 master 重建的环境并假设它与生产等价；不要对生产启用 dev pushSchema。

## 迁移部署前置检查：notifications 唯一索引的锁风险

迁移 `20260809_183327_supply_submission_notification_unique` 在**共享的 `notifications` 表**上建唯一索引：

```sql
CREATE UNIQUE INDEX "eventId_recipient_type_idx" ON "notifications" ("event_id","recipient_id","type");
```

它没有用 `CONCURRENTLY`，而且**不可能**用：Payload 把每个 `migration.up()` 包在一个事务里（`payload/dist/database/migrations/migrate.js`：`initTransaction` → `up()` → `commitTransaction`），而 PostgreSQL 不允许在事务块内执行 `CREATE INDEX CONCURRENTLY`。该迁移是生成物（有配套 `.json` snapshot），按本仓库约束**正文不可手改**。

后果：索引构建期间该表持 SHARE 锁，**阻塞所有通知写入**。`notifications` 是全平台通知共用表（审核驳回 / 线索分配 / SLA 超时 / 待办等），不只是投放申请。

**部署前必做**：先量表大小再决定走哪条路。

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM notifications;"
```

- **行数较小（万级以内）**：构建是毫秒级，直接随 `payload migrate` 上，无需特殊处理。
- **行数较大**：走受控路径，不要让迁移在业务高峰期在线建索引。先在业务低峰用 `CREATE UNIQUE INDEX CONCURRENTLY` 手工建好（不在事务内），确认 `duplicate (event_id, recipient_id, type)` 为零后，再把该迁移标记为已应用，避免它重复建索引而失败。此路径必须由 DBA 走审阅过的变更单。

另外 `20260809_180000_..._duplicates_preflight` 与本迁移是**两个独立事务**：预检通过后、索引建成前若有新的重复通知写入，索引创建会失败（安全失败、无数据丢失，但会断部署）。高风险窗口内可先暂停通知队列（`PAYLOAD_DISABLE_JOB_AUTORUN=1`）。

## 生产地理数据导入记录（2026-08-12 完成）

七城（上海、南京、杭州、苏州、无锡、宁波、嘉兴）地理数据已导入生产 TencentDB，**新建 1854 节点、沿用存量 38、冲突 0、失败 0**。种子在 `payload-office-platform/seed/geography/*.json`，导入口径见 `docs/geography-code-convention.md`。

分两波执行，因为生产此前**只有上海**（19 个行政区、206 个商圈，且一条地铁都没有）：

| 波次 | 范围 | 结果 |
|---|---|---|
| Wave 1 | 六城全量 + 上海地铁（`--only metro`） | 新建 1448，沿用 1，冲突 0 |
| Wave 2 | 上海行政区与商圈 | 新建 6，沿用存量 37，跳过 421（Wave 1 已导），冲突 0 |

逐城明细：杭州 299、苏州 171、无锡 95、宁波 201、嘉兴 18（无地铁）、南京 249、上海 421。

**这次导入最该记住的坑**：上海存量区域代码有三套命名法并存（`LEGACY_LOC_n`、`SH-XXXQU`、`SH-XXX`）。种子里写了 **37 个 `legacyCodes` 别名**让导入器认领存量节点（不改名、不改码、不改 slug）。**不带别名直接导入会新建约 500 个垃圾节点**——第三个上海城市、挂着 18/13 个楼盘的静安与浦东重复行政区、陆家嘴（7 楼盘）与南京西路（11 楼盘）重复商圈——**且全程不报错**。今后任何存量城市的二次导入，先确认别名覆盖完整再 `--apply`。

Wave 1 时 `CITY-SH` 触发多命中告警：别名同时命中 `LEGACY_LOC_1`（id=1，启用，挂 71 楼盘）与 `SH`（id=6，停用），脚本按声明顺序取首个，人工核对正确。Wave 2 未认领的 189 条存量 = 3 条停用重复行政区空壳 + 186 条种子未覆盖的生产自有商圈（206−20 被认领），数字自洽。

全程用 CloudBase MCP 只读查询做验收，未用 SQL 直接写库。导入脚本护栏：dry-run 默认、冲突默认跳过、`--update-existing` 才更新，绝不静默覆盖。

## 关键文件

| 文件 | 作用 |
|------|------|
| `scripts/cloudrun-release.sh` | 本地发布（灰度→冒烟→全量→回滚），CI 上传不通时的正式路径 |
| `payload-office-platform/src/payload.config.ts` | DB 适配器 + S3 插件（核心） |
| `payload-office-platform/package.json` | 依赖、`start` 读 `PORT` |
| `payload-office-platform/next.config.ts` | turbopack root + images 远程白名单 + 生产安全响应头（OPT-019，无 standalone，用完整镜像） |
| `payload-office-platform/Dockerfile` / `.dockerignore` | Container mode |
| `payload-office-platform/.env.example` | 环境变量模板 |
| `payload-office-platform/src/app/(frontend)/page.tsx` | 首页动态渲染 + fallback |

## 参考

- 完整计划：`~/.claude/plans/shimmering-bouncing-floyd.md`
- CloudBase skill：`~/.claude/skills/cloudbase/`（CloudRun 部署见 `references/cloudrun-development/`）
