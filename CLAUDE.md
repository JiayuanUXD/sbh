# 项目宪章（CLAUDE.md）

本文件每次会话自动加载，只放**非显而易见的常驻约束**。代码结构、git 历史、已记录在 DEPLOYMENT.md 的细节不在此重复。

## 这是什么项目

商办租赁平台（对标 executivecentre.com.cn / shangban.58.com / soolou.com/sh）。单体仓库：

- `payload-office-platform/` — 应用本体（Next.js 16 + Payload 3.86 单体）。含 C 端公开站 `(frontend)`、后台 `(payload)/admin`、API。详见 `payload-office-platform/CLAUDE.md`。
- `.github/workflows/` — `deploy.yml`（发布到 CloudRun，由 `quality.yml` 在 master 上成功后自动接力并全量切流，见下）、`quality.yml`（质量闸门）。
- `specs/work-items/` — 工作项（`OPT-0xx-*.md`），即 Agent 文档里说的 Task Packet。
- `artifacts/verification/` — 验证证据目录（按工作项编号分目录）。长日志、截图存这里，别粘进对话或 PR 正文。
- `docs/geography-code-convention.md` — 七城地理数据 `immutableCode` / `slug` 的唯一权威命名规范。改地理数据前必读。
- `TODOS.md`、`DEPLOYMENT.md`、`scripts/cloudrun-release.sh`、本宪章。

## 任务上下文路由

领域规则拆在 `payload-office-platform/.agent/`，**不会自动加载**，按任务显式读取：

| 任务类型 | 读取 |
|---|---|
| 任何应用内任务 | `payload-office-platform/AGENTS.md` + `.agent/core.md` |
| 后台页面 / Collection / Hook / Custom View | `.agent/backend.md` |
| C 端页面 / 组件 / 公开查询 / SEO / 咨询 | `.agent/frontend.md` |
| 楼盘 / 房源 / 商户关系 / 有效供给 | `.agent/supply.md` |
| 登录 / 角色 / 菜单 / 数据或字段权限 | `.agent/permissions.md` |
| 字段 / 索引 / 约束 / 生产数据变化 | `.agent/migrations.md` |
| 测试 / 浏览器验收 / 完成声明 | `.agent/testing.md` |

只在任务实际跨域时组合读取。用 `rg` 在 `src/` 定位，不要整份读大文件。

## 多 agent 入口（别再复制一份规则）

本仓库同时被 Claude Code 与其它 agent（Antigravity / Gemini CLI / Codex 等）使用。**规则只写在 `CLAUDE.md` 与 `.agent/`，入口文件只放指针**：

| 文件 | 角色 |
|---|---|
| `CLAUDE.md`（本文件）、`payload-office-platform/CLAUDE.md` | **唯一事实源**。Claude Code 自动加载；其它 agent 经入口文件显式读取 |
| `AGENTS.md`（根）、`payload-office-platform/AGENTS.md` | 通用入口 + 领域路由，只放指针和四条红线摘要 |

**不要新建 `GEMINI.md` / `.cursorrules` 等第二套规则文档**——同义文档一多必然漂移（真实教训：`.agent/` 说本地 SQLite、代码已 fail-fast 只认 PG，冲突长期无人发现）。需要给某个 harness 特供配置时，让它指向既有文件即可（如 Gemini CLI 在 `.gemini/settings.json` 里把上下文文件名指到 `AGENTS.md`）。

例外：只有真正 harness 专属的内容才分开放，比如本文件末尾的 Skill routing 仅对 Claude Code 有效。

## 分支模型

- **不要在 `master` 上直接写代码**——先开分支。（合并到 `master` 会直接上线，见下面「合并到 master 即上线」。）
- **永远从最新 master 开分支**，别基于旧基线（真实教训：`opt` / `codex` 基于旧提交，与 master 分叉后合并才发现惊喜）。
- 历史实施计划 / PRD 已移除，**以代码为唯一事实源**（collection 配置、`src/domain`、`src/lib/frontend`、`src/migrations`、测试）。

### 分支命名

```
<类型>/<kebab 短描述>-<4~8 位随机 hex>
```

- **类型**：`feat` `fix` `refactor` `perf` `docs` `chore` `ci` `data`，与提交信息的类型保持一致。agent 自建分支可用 `claude` / `antigravity` / `codex` / `cursor` 作前缀，但**合入前建议改成类型前缀**。
- **短描述**：2–4 个英文 kebab 词；有工作项编号时以编号打头（`opt-022-...`），一眼对得上 `specs/work-items/`。
- **随机后缀**：4–8 位 hex，专治多 agent / 多 worktree 并发同题时的重名与相互覆盖。
- **禁止裸名**：`opt`、`codex`、`tmp`、`test` 这类无类型无描述无后缀的分支名。

```bash
cd payload-office-platform && pnpm branch:new feat multi city search
```

该命令先 `git fetch`，再基于 `origin/master` 创建 `feat/multi-city-search-<hex>`，顺带把"从最新 master 开分支"一起做掉。手工创建也可以，但要自己保证符合规范——`.githooks/pre-commit` 会校验：**新分支不合规直接拦**（此时改名成本最低），已有提交的老分支只警告。

例：`feat/opt-022-dashboard-perf-a3f1`、`fix/header-cta-portal-7b2c`、`ci/deploy-follow-redirect-1d4e`。

## 合并到 master 即上线（别把 PR 当草稿箱）

**闸门通过后自动全量切流。** `quality.yml` 在 `master` 上整体成功 → `deploy.yml`
经 `workflow_run` 接力 → 直接 promote：

| 怎么做 | 结果 |
|---|---|
| 合并到 `master`（改动命中 `quality.yml` 的 paths） | 构建 → 10% 灰度 → 冒烟 → **全量切流**（失败 rollback） |
| 合并到 `master`（只动 `specs/`、根级 md 等 paths 外文件） | 闸门不跑，因此不部署 |
| `workflow_dispatch`、`promote` 勾上 | 同上，用于重发某个历史 ref |
| `workflow_dispatch`、`promote` 不勾 | 只出 GRAY 版本，0% 流量，线上不变 |

```bash
gh workflow run deploy.yml -f promote=true --ref master
```

推论：**没准备好上线的东西就别合**。想先合着攒一批再发，这条链路不支持——
要么留在分支，要么接受它进生产。闸门红了不会发（job 自己判 `workflow_run.conclusion`）。

> 沿革：2026-08-18 `6e3861b` 曾把触发改成手动，因为当时自动触发一律 `promote=false`，
> 每次合并白造一个 0% 流量、没人用的版本；2026-08-26 改回自动**并带 promote**——
> 浪费来自「构建了却不用」，不是来自「自动」。
>
> 这几行有过前科：2026-08-18 改了 workflow 没改文档，四处文档错了七天，
> 期间误导过判断。**改发布链路时，`CLAUDE.md`、`AGENTS.md`、`DEPLOYMENT.md`
> 与 `deploy.yml` 头部注释要一起改**；`tests/production-deploy-config.test.ts`
> 已加守卫（2026-08-26 随触发方式反向重写），四处任一再声称「只能手动 /
> 合并什么都不发生」就会红。

## CloudBase 部署事实

- EnvId `sbh-d9gnr8h5ef7e22e30`，CloudRun 服务名 `sbh`，域名 `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com`。
- 生产 DB：TencentDB for PostgreSQL（共享库，**`push: false`，只走显式迁移**）。媒体：腾讯云 COS（S3 兼容）。
- CI 三连坑（已在 `.github/workflows/deploy.yml` 修复，别再踩）：
  1. `tcb login` 遥测提示 → job 级 `env: CLOUDBASE_CI=1` 让 `isYesMode()` 自动确认。
  2. 灰度部署 `list` 提示 → `printf '\n\n\n' | tcb ... cloudrun deploy` 喂回车选默认"否"。`--force` 压不住 list 型提示，CI 无 tty 会 exit 130。
  3. GitHub secrets 要用 `TCB_SECRET_ID` / `TCB_SECRET_KEY` / `TCB_ENV_ID` 三个名字，别把 SecretId 当成一个 secret 名。
- 容器与部署机制坑（改 Dockerfile / 部署链路前先看）：
  - **CloudRun 服务 Port=80**，Dockerfile 必须 `ENV PORT=80`；本地 `pnpm dev` 才是 3717，别对齐错。
  - **`patches/` 必须复制进 Dockerfile 的 `deps` 阶段**（`pnpm patchedDependencies` 打了 `@arco-design/web-react`，缺目录 `pnpm install --frozen-lockfile` 直接失败）。真实教训：提交 `19acfe2`。
  - `tcb cloudrun deploy` 上传的是**本地目录 ZIP**（不是 git clone），ZIP 打包器**忽略 `.dockerignore`**；无害（`docker build` 仍按 `.dockerignore` 过滤上下文），但别据此以为 `.next/` 没被上传。
  - `tcb cloudrun deploy` **没有 `--env-vars`**，服务级环境变量（`DATABASE_URL` / `PAYLOAD_SECRET` / `NODE_ENV`）跨代码部署保留，CI 不重传，只能在控制台 / MCP 改。
- 部署细节见 `DEPLOYMENT.md`。

## 本地闸门（机器强制，对所有 IDE 生效）

`.githooks/` 里的 git hook 把下面几条从"文档建议"变成"提交/推送时真的过不去"，任何 agent、任何 IDE、包括手工操作都一样：

| 时机 | 拦截 |
|---|---|
| pre-commit | 在 `master` 上提交 / 暂存了 `public/prd/*.md` 的删除 / `payload-types.ts` 丢了 `Media.prefix` / 改了 collection 却没带迁移 / 新分支名不合命名规范；`payload.config` 变了但 `importMap.js` 没变、老分支名不合规范则只警告 |
| pre-push | 涉及应用目录时跑 `typecheck` + `test`（`build`/迁移/E2E 留给 CI） |

- 启用（每个克隆一次即可，worktree 共享）：`cd payload-office-platform && pnpm setup:hooks`。
- 每条检查都有环境变量逃生舱（见脚本内注释），**但禁止用 `--no-verify` 整体绕过**。
- 逃生舱是给人用的：agent 要用之前必须先向用户说明理由并获得确认。

## 工作树纪律

- 仓库里有**已搁置的 demo PRD 文档删除**（`payload-office-platform/public/prd/*.md` 显示为 ` D`）。这是用户有意搁置的，**别恢复、别提交它们**。提交只用**显式 `git add <具体路径>`**，禁用 `git add -A` / `git add .` / `git commit -am`。

## 文档语言

所有说明文档、CLAUDE.md、计划/规格、提交信息里的中文描述用**简体中文**。

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
