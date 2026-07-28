# CloudBase 部署进度

商办租赁平台（Payload CMS）部署到腾讯云 CloudBase 的进度与待办。

## 目标架构（方案 A）

**CloudRun (Container mode) 跑 Payload + TencentDB for PostgreSQL 存数据 + COS 存媒体**

- Payload 是 Next.js 16 全栈应用 → CloudBase 只能用 CloudRun **Container mode**（需 Dockerfile、监听注入的 `PORT`）
- Payload 需要标准 SQL 连接串（`postgres://host:5432`），CloudBase 内置 PG/MySQL 不提供 → 数据库用独立的 **TencentDB for PostgreSQL** 实例
- CloudRun 容器无状态 → media 存 **腾讯云 COS（S3 兼容）**

## 已完成 ✅（截至 2026-07-24）

| # | 任务 | 说明 |
|---|------|------|
| 1 | DB 适配器 SQLite → PostgreSQL | `@payloadcms/db-postgres`；`payload.config.ts` 按有无 `DATABASE_URL` 自动切 PG/SQLite；`push:false` 禁 dev push（避免拨测表误删卡死） |
| 2 | Media 存储接入 COS(S3) | `@payloadcms/storage-s3`，绑定 `media`，`forcePathStyle:true`（`S3_BUCKET` 未设时 disabled） |
| 3 | 容器化 Dockerfile + PORT | 多阶段**完整镜像**（非 standalone，保留迁移能力）；`ENV PORT=80`+`EXPOSE 80`；启动跑 `payload migrate` 再 `next start` |
| 4 | PG 迁移 + 修 ENUM bug | `src/migrations/20260723_160143_init.ts` 应用到 CloudBase PG；`Listings.listingType` 默认值 `private-office`→`traditional-office`（PG strict ENUM，SQLite 不报） |
| 5 | 首次上线（MCP deploy） | CloudRun 服务 `sbh` 已 Running，100% 流量。域名 `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com`；验证 `/`、`/api/listings`(有种子数据)、`/admin` 均 200 |
| 6 | CI 自动部署 workflow | `.github/workflows/deploy.yml`：push master → `tcb cloudrun deploy` 上传 ZIP 在线构建 + 冒烟测试。已推送（commit `fd5e897`） |
| 7 | CI 首次跑通 | 2026-07-24 跑通（run `30073559226`，`tcb login` + deploy + 冒烟 `GET /api/listings` 200 全绿）。修三个坑：① 3 个 GitHub secret 之前名字填成了 SecretId 的值（全空）→ 重建 `TCB_SECRET_ID`/`TCB_SECRET_KEY`/`TCB_ENV_ID`；② `tcb login` 后 telemetry `Y/n` 提示无 tty 卡 exit 130 → job 设 `CLOUDBASE_CI: '1'`（isYesMode 自动跳过）；③ 灰度部署 `list` 提示 `--force` 不挡 → `printf '\n\n\n' \|` 喂回车选默认"否"（自动切流量） |

**线上资源**：EnvId `sbh-d9gnr8h5ef7e22e30`；PG 实例 `postgres-ilf7zhts`（公网 `sh-postgres-ilf7zhts.sql.tencentcdb.com:26710`，内网 `172.17.0.8:5432`，db `postgres`，role `sbh`）；迁移 `20260723_160143_init` 已应用，种子数据 5 locations/2 buildings/2 listings/4 amenities/1 page。服务级环境变量 `DATABASE_URL`/`PAYLOAD_SECRET`/`NODE_ENV` 已在 CloudRun 配好（不入 git，存 `.env.local`）。

## 待完成 ⏳

### ✅ P0 — 让 CI 首次自动部署跑通（2026-07-24 完成）

- [x] 腾讯云 [CAM](https://console.cloud.tencent.com/cam) 新建子用户（编程访问），拿 SecretId/SecretKey（**勿用主账号**）
- [x] 给子用户绑定预置策略：`QcloudAccessForTCBRole`、`QcloudAccessForTCBRoleInAccessCloudBaseRun`（能 deploy 成功即已绑对）
- [x] 仓库 Settings → Secrets → Actions 加 3 个：`TCB_SECRET_ID`、`TCB_SECRET_KEY`、`TCB_ENV_ID`=`sbh-d9gnr8h5ef7e22e30`（用 `gh secret set` 写入）
- [x] 触发运行确认 `tcb login` + deploy + 冒烟 `GET /api/listings` 200 全绿（run `30073559226`）
- [x] 验收：以后任意 `git push master`（改 `payload-office-platform/`）即自动上线

> 踩坑记录（见上表第 7 行）：secret 值误填为名字、telemetry 交互提示、灰度部署 list 提示，三个都会让 CI 在无 tty 下 exit 130。

### 🟠 P1 — 业务可用
- [x] 首个管理员已存在（`85851205@qq.com`），从 `/admin/login` 登录即可。注：`/admin/create-first-user` 在 users 表非空时会 `notFound()`（白屏是正常行为，不是 bug）
- [ ] 后台 CRUD 一条 listing / 上传一张媒体，重启容器后确认数据与媒体仍在（验 PG + COS 持久化）

### 🟡 P2 — 优化（可选）
- [ ] 流量稳定后把 CloudRun `MinNum` 1→0 省成本（代价：冷启动延迟）
- [ ] 容器接 VPC + PG 内网地址 `172.17.0.8:5432` 替代公网（安全 + 延迟），去掉公网 PG 暴露
- [ ] 真要用媒体上传时再配 COS：当前 `S3_*` 未设，上传走本地；上线前需补 bucket/密钥/endpoint 到服务环境变量

## Git 自动部署（CI）

`push` 到 `master` 即自动部署到 CloudRun 服务 `sbh`。Workflow：[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)。

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
> - `payload-office-platform/.gitattributes` 用 `export-ignore` 把 `artifacts/` 与 `tests/` 挡在包外（**`.dockerignore` 在这一步不生效**——平台是先收包、再在云端 build）。包回到 869 KB。
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

设置完成后,下次 `git push origin master`（改动 `payload-office-platform/`）即触发部署；也可在仓库 Actions 页手动 `Run workflow`。部署日志与冒烟测试（`GET /api/listings` 期望 200）在 Actions 运行记录里查看。

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
