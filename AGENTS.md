# Agent 入口（通用）

本文件是各类编码 agent（Antigravity / Gemini CLI / Codex / Cursor 等）的入口。**它只放指针，不放规则**——规则只写一处，避免多份同义文档互相漂移。

## 先读这两份

1. [`CLAUDE.md`](./CLAUDE.md) —— 仓库级常驻约束：项目是什么、仓库地图、分支模型、CloudBase 部署与 CI 坑、工作树纪律、文档语言。**开工前必读全文。**
2. [`payload-office-platform/CLAUDE.md`](./payload-office-platform/CLAUDE.md) —— 应用级常驻约束：技术栈、命令与预检顺序、生成物纪律、数据库、并行 worktree 纪律、路由分组。

文件名叫 `CLAUDE.md` 只是历史原因（Claude Code 会自动加载它们）；内容与具体 agent 无关，对所有 agent 同等生效。

## 再按任务读

领域规则拆在 [`payload-office-platform/.agent/`](./payload-office-platform/.agent/)，路由表见 `CLAUDE.md` 的「任务上下文路由」一节，入口说明见 [`payload-office-platform/AGENTS.md`](./payload-office-platform/AGENTS.md)。只读任务实际涉及的文件，不要整目录加载。

## 四条红线（完整表述见 `CLAUDE.md`）

即使你只读了本文件，以下四条也不能违反。**前三条已由 `.githooks/` 机器强制**（`cd payload-office-platform && pnpm setup:hooks` 启用），违反时提交/推送会直接失败；禁止用 `--no-verify` 绕过，逃生舱环境变量需先获得用户确认。

- **不在 `master` 上直接写代码**（合并到 `master` 会在闸门通过后自动全量上线，没准备好就别合，见 `CLAUDE.md`）。先从最新 `origin/master` 开分支，命名为 `<类型>/<kebab 描述>-<4~8位随机hex>`（如 `feat/opt-022-dashboard-perf-a3f1`）；可用 `cd payload-office-platform && pnpm branch:new feat <描述>` 自动生成。
- **提交只用显式 `git add <具体路径>`**，禁用 `git add -A` / `git add .` / `git commit -am`；仓库里有用户有意搁置的删除（`payload-office-platform/public/prd/*.md`），别恢复也别提交它们。
- **数据库只走显式迁移**（`push: false`），改 collection 后用 `payload migrate:create` 生成迁移，**迁移文件正文绝不可手改**。
- **未经用户确认不得提交、推送、创建 PR、部署或执行破坏性迁移。**

## 说明文档语言

一律简体中文（含提交信息里的中文描述）。
