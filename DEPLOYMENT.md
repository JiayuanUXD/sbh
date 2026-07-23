# CloudBase 部署进度

商办租赁平台（Payload CMS）部署到腾讯云 CloudBase 的进度与待办。

## 目标架构（方案 A）

**CloudRun (Container mode) 跑 Payload + TencentDB for PostgreSQL 存数据 + COS 存媒体**

- Payload 是 Next.js 16 全栈应用 → CloudBase 只能用 CloudRun **Container mode**（需 Dockerfile、监听注入的 `PORT`）
- Payload 需要标准 SQL 连接串（`postgres://host:5432`），CloudBase 内置 PG/MySQL 不提供 → 数据库用独立的 **TencentDB for PostgreSQL** 实例
- CloudRun 容器无状态 → media 存 **腾讯云 COS（S3 兼容）**

## 已完成 ✅

| # | 任务 | 说明 |
|---|------|------|
| 1 | DB 适配器 SQLite → PostgreSQL | `@payloadcms/db-postgres`，`payload.config.ts` 用 `postgresAdapter` + `process.env.DATABASE_URL` |
| 2 | Media 存储接入 COS(S3) | `@payloadcms/storage-s3`，plugins 绑定 `media`，`forcePathStyle:true` |
| 3 | 容器化 Dockerfile + PORT | `next.config.mjs` 加 `output:'standalone'`；多阶段 Dockerfile；`.dockerignore`；`start` 读 `PORT` |
| 4 | 本地构建验证 | `tsc --noEmit` + `pnpm build` 通过；首页改 `force-dynamic` 避免构建期连库；standalone 产物生成 |

对应提交：`83656e0 feat: adapt Payload platform for CloudBase CloudRun deployment`

## 待完成 ⏳

### 前置条件（用户/终端侧）
- [ ] 交互式终端执行 `claude mcp add cloudbase -- npx @cloudbase/cloudbase-mcp@latest`，重启 Claude Code（在 `~/App/sbh` 启动），使 CloudBase MCP 工具可用
- [ ] MCP `auth` 设备码登录，`envQuery(action=list)` 确认 CloudBase EnvId
- [ ] 开通 **TencentDB for PostgreSQL** 实例，拿连接串（host/port/db/user/password，允许 CloudRun 访问）
- [ ] 开通 **COS 存储桶**，拿 bucket / region / S3 endpoint / SecretId / SecretKey
- [ ] ⚠️ TencentDB PG 与 COS 为付费资源，非 CloudBase 免费额度内

### 任务 #5 — 部署到 CloudRun
- [ ] 把真实凭证填入 `.env.local`（`DATABASE_URL` / `S3_*`）
- [ ] 本地连真库跑 `pnpm dev`，验证 `/admin` 建管理员、`/api` 读接口、上传图片落 COS
- [ ] MCP `manageCloudRun(action="deploy")`，Container mode，`targetPath` 绝对路径：
  - `OpenAccessTypes:["PUBLIC"]`，`Cpu:0.5, Mem:1, MinNum:1, MaxNum:5`
  - 注入环境变量：`PAYLOAD_SECRET`、`DATABASE_URL`、全部 `S3_*`
- [ ] `queryCloudRun(action="detail")` 确认状态 Ready、拿服务域名
- [ ] 访问 `<域名>/admin` 建首个管理员，CRUD 一条 listing，上传媒体验证持久化（重启容器后仍在）
- [ ] 部署失败查 `queryCloudRun(action="getDeployLog")`

### 任务 #6 — 更新 README
- [ ] 记录 CloudBase EnvId、CloudRun 服务域名、DB/COS 资源、环境变量清单、重新部署命令

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
| `payload-office-platform/next.config.mjs` | `output:'standalone'` |
| `payload-office-platform/Dockerfile` / `.dockerignore` | Container mode |
| `payload-office-platform/.env.example` | 环境变量模板 |
| `payload-office-platform/src/app/(frontend)/page.tsx` | 首页动态渲染 + fallback |

## 参考

- 完整计划：`~/.claude/plans/shimmering-bouncing-floyd.md`
- CloudBase skill：`~/.claude/skills/cloudbase/`（CloudRun 部署见 `references/cloudrun-development/`）
