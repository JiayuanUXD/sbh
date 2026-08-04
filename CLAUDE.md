# 项目宪章（CLAUDE.md）

本文件每次会话自动加载，只放**非显而易见的常驻约束**。代码结构、git 历史、已记录在 DEPLOYMENT.md 的细节不在此重复。

## 这是什么项目

商办租赁平台（对标 executivecentre.com.cn / shangban.58.com / soolou.com/sh）。单体仓库，两个层面：

- `payload-office-platform/` — 应用本体（Next.js 16 + Payload 3.86 单体）。含 C 端公开站 `(frontend)`、后台 `(payload)/admin`、API。
- 仓库根 — `.github/workflows/`（CI 部署）、`docs/`、`DEPLOYMENT.md`、本宪章。

详见应用级 `payload-office-platform/CLAUDE.md`。

## 分支模型

- 默认分支 `master` 触发 CI 自动部署到 CloudBase CloudRun。**不要在 `master` 上直接写代码**——先开 `feat/*` 分支。
- C 端公开站在建，分支 `feat/c-end-public-site`，计划见 `docs/superpowers/plans/2026-07-24-c-end-public-site.md`，规格见 `docs/superpowers/specs/2026-07-24-c-end-public-site-design.md`。

## CloudBase 部署事实

- EnvId `sbh-d9gnr8h5ef7e22e30`，CloudRun 服务名 `sbh`，域名 `https://sbh-286300-10-1253925058.sh.run.tcloudbase.com`。
- 生产 DB：TencentDB for PostgreSQL（共享库，**`push: false`，只走显式迁移**）。媒体：腾讯云 COS（S3 兼容）。
- CI 三连坑（已在 `.github/workflows/deploy.yml` 修复，别再踩）：
  1. `tcb login` 遥测提示 → job 级 `env: CLOUDBASE_CI=1` 让 `isYesMode()` 自动确认。
  2. 灰度部署 `list` 提示 → `printf '\n\n\n' | tcb ... cloudrun deploy` 喂回车选默认"否"。
  3. GitHub secrets 要用 `TCB_SECRET_ID` / `TCB_SECRET_KEY` / `TCB_ENV_ID` 三个名字，别把 SecretId 当成一个 secret 名。
- 部署细节见 `DEPLOYMENT.md`。

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
