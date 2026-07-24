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

## 关键文件

| 文件 | 作用 |
|------|------|
| `payload-office-platform/src/payload.config.ts` | DB 适配器 + S3 插件（核心） |
| `payload-office-platform/package.json` | 依赖、`start` 读 `PORT` |
| `payload-office-platform/next.config.mjs` | turbopack root + images 远程白名单（无 standalone，用完整镜像） |
| `payload-office-platform/Dockerfile` / `.dockerignore` | Container mode |
| `payload-office-platform/.env.example` | 环境变量模板 |
| `payload-office-platform/src/app/(frontend)/page.tsx` | 首页动态渲染 + fallback |

## 参考

- 完整计划：`~/.claude/plans/shimmering-bouncing-floyd.md`
- CloudBase skill：`~/.claude/skills/cloudbase/`（CloudRun 部署见 `references/cloudrun-development/`）
