# 交接文档：委托找房 / 投放房源 双落地页

> **给接手者（Codex 或其他 agent）**：这份文档是唯一入口。读完本文后，你需要的一切都在这里或它指向的文件里。**不需要**、也拿不到之前那个会话的上下文。
>
> **最后更新**：Task 4 收尾中（见 §3 状态表，表里的状态是权威）。

---

## 1. 一句话现状

在 git worktree 里按一份 12 任务的实施计划做两个 C 端落地页，Task 1–3 已完成并提交，Task 4 收尾中，Task 5–12 未开始。所有需求、代码、验证命令都已在计划文档里写死，**照做即可，不需要重新设计**。

---

## 2. 先读这三个文件（按顺序）

| 顺序 | 文件 | 作用 |
|---|---|---|
| 1 | `docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md` | PRD v2。**为什么**这么做、字段来自对标站截图的哪一处、哪些是刻意不做的 |
| 2 | `docs/superpowers/plans/2026-08-09-entrust-supply-pages.md` | 实施计划。12 个任务，每个任务给了**完整代码**与**逐条验证命令**。顶部有进度表与复选框 |
| 3 | `.superpowers/sdd/2026-08-09-entrust-supply-pages/progress.md` | 执行台账。已完成任务的 commit 范围、裁定过的争议、以及**已知延期的 minor 问题** |

任务文本已逐个抽成独立 brief：`.superpowers/sdd/2026-08-09-entrust-supply-pages/task-<N>-brief.md`（1–4 已生成，5–12 可用下面命令再抽，或直接读计划里对应的 `## Task N` 段）。已完成任务的实现者报告在同目录 `task-<N>-report.md`。

抽 brief 的命令（可选，纯便利）：

```bash
bash "C:/Users/Administrator/.claude/plugins/cache/superpowers-dev/superpowers/6.2.0/skills/subagent-driven-development/scripts/task-brief" docs/superpowers/plans/2026-08-09-entrust-supply-pages.md 5
```

---

## 3. 任务状态（权威）

| 任务 | 状态 | commit | 备注 |
|---|---|---|---|
| Task 1 导航与页脚 | ✅ 完成 | `3b29379` | review 通过 |
| Task 2 投放房源纯函数 | ✅ 完成 | `73d30fc` | 含 1 轮修复（控制字符正则），19/19 |
| Task 3 集合 + 权限 + 迁移 | ✅ 完成 | `5836f1c` | 迁移 `20260809_142444_supply_submissions_and_entrust_source`，2418 单测全绿 |
| Task 4 `/api/supply-submissions` | 🔄 代码已写，**烟测与提交未完成** | — | 见 §4 |
| Task 5 entrust 来源 + 无姓名兜底 | ⬜ 未开始 | | |
| Task 6 落地页骨架组件与样式 | ⬜ 未开始 | | |
| Task 7 `/entrust` 页 | ⬜ 未开始 | | 依赖 5、6 |
| Task 8 `/publish` 页 | ⬜ 未开始 | | 依赖 4、6 |
| Task 9 站内通知 | ⬜ 未开始 | | 依赖 3 |
| Task 10 埋点 | ⬜ 未开始 | | 依赖 7、8 |
| Task 11 sitemap | ⬜ 未开始 | | 依赖 7、8 |
| Task 12 E2E 与整体验证 | ⬜ 未开始 | | 最后做 |

分支：`claude/delegated-search-listing-pages-7eeeef`（从 `master` 开出）。工作树路径：`E:\github\sbh\.claude\worktrees\delegated-search-listing-pages-7eeeef`。**尚未推送远端、尚未开 PR**。

---

## 4. Task 4 的确切断点

`git status` 应该能看到（若中断时未提交）：

- 已写好：`payload-office-platform/src/app/api/supply-submissions/route.ts`
- 已写好：`payload-office-platform/src/lib/rate-limit-config.ts`（追加了 `SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG`）

**未完成**：四条 curl 烟测 + 提交。补做步骤见计划 `## Task 4` 的 Step 4–5。烟测 payload 里隐私政策版本用 `MVP-R1`。

注意：限流是**每 IP 每分钟 3 次**，四条烟测里有 3 条 POST 正好到阈值。若第 3 条 POST 返回 429 而非预期的 422，**等一分钟重跑那一条**，不要改代码或放宽限流。

如果这些改动已经被提交了，`git log --oneline -3` 会显示 `feat(supply): 新增 /api/supply-submissions 公开提交端点` 之类的提交——那就直接从 Task 5 开始。

---

## 5. 环境事实（非显而易见，务必先读）

这些是上一个会话搭好的，**不要重做，也不要"顺手修正"**：

1. **`payload-office-platform/.env.local` 已存在**（被 gitignore）：
   - `DATABASE_URL` 指向本树**独立**库 `sbh_dev_entrust`（localhost:5432），不是主树的库、不是生产 TencentDB。
   - `PORT=3719`。**绝不要用 3717**——那是主工作树的 dev 端口，抢了会让两边 API 静默打到对方服务上（这个坑真实发生过，导致 E2E 假失败）。
   - 含 5 个**占位** `COS_*` 变量（非真实凭据）。原因见下条。
2. **占位 COS 变量是刻意的，别删**。缺 COS 配置时 `pnpm generate:types` 会**静默删掉 `Media.prefix` 两行**（已实测复现）。而 `src/payload-types.ts` 在本分支**是被 git 跟踪的**（`.gitignore` 里虽列了它，但对已跟踪文件无效）。
   - **硬规则**：任何时候提交 `payload-types.ts` 之前，跑 `grep -c "prefix" src/payload-types.ts`，**必须是 2**。是 0 就说明 COS 占位配置丢了，先补回再重生成，**不要手改生成物**。
   - `cos-config.ts` 的格式校验很严：`COS_BUCKET` 要 `name-APPID` 形式、`COS_REGION` 要 `ap-*`、`COS_ENDPOINT` 要 `https://cos.<region>.myqcloud.com`、五个变量要么全给要么全不给。
3. **迁移已全部应用**（33/33，含本次新迁移），`supply_submissions` 表已存在，可直接写数据。
4. **`node_modules` 已装好**（`pnpm install` 跑过）。包管理器是 **pnpm**，不要用 npm/yarn。
5. **`next dev` 会污染生成物 `payload-office-platform/next-env.d.ts`**（把 `./.next/types/routes.d.ts` 改成 `./.next/dev/types/routes.d.ts`）。**提交前必须** `git checkout payload-office-platform/next-env.d.ts`，别把 dev 变体提交进去。

---

## 6. 硬约束（违反会出事，不是风格偏好）

- **提交只用显式 `git add <具体路径>`。禁用 `git add -A` / `git add .` / `git commit -am`。**
- **`payload-office-platform/public/prd/*.md` 处于已删除状态，是用户有意搁置的。绝不要恢复、绝不要提交它们。**（用 `git add -A` 就会误恢复，这是上一条存在的原因）
- **不要提交 `.env.local`。**
- **迁移必须 `pnpm payload migrate:create <name>` 生成，`src/migrations/*.ts` 与 `*.json` 正文绝不可手改。** 本地/CI/生产统一 PostgreSQL 且 `push: false`，只走显式迁移。
- **不要连生产 TencentDB。**
- 纯逻辑严格 TDD：先写失败测试 → 跑红 → 实现 → 跑绿 → 提交。
- C 端只用 `(frontend)/styles.css` 既有 CSS 变量（`--ink --muted --line --paper --cream --gold --deep --green`），**不引新 UI 库、不引入对标站的红色**。
- 所有中文注释与文案用**简体中文**。
- C 端 Server Component 读数据只走 Local API（`getPayload()`），不调 REST `/api/*`。
- 不在 `master` 上写代码。

---

## 7. 执行期已裁定的两处「计划自身缺陷」（别退回原样）

计划文档已修正，但如果你看到旧的引用要知道原因：

1. **控制字符正则**（commit `3d254cf`）。计划原文那一行含**字面控制字节**（0x00/0x1F），转写时会静默丢失，导致 `source.path` 的控制字符过滤失效——文本 diff 上完全看不出来。已改为转义写法 `/[\x00-\x1F\x7F]/` 并补上 DEL，且 Task 2 已加回归测试锁定。**任何新写的字符类都用转义，不要嵌字面控制字节。**
2. **操作权限编码命名**（commit `db97ded`）。原写 `supply-submission:read`，违反 `permission-codes.ts` 的既有约定 `/^[a-z_]+:[a-z_]+$/`（39 个现存 OPERATION_CODES 域名部分都不含连字符，`tests/permission-codes.test.ts` 有检查）。已统一改为 **`supply_submission:read` / `:manage` / `:convert`**。
   - **但** MENU 编码与 collection slug 仍是 kebab-case 的 **`supply-submissions`**（MENU 跟 admin 路由命名，无此约束）。这两套命名并存是刻意的，别"统一"它。
   - Task 9 的通知 hook 要按 `supply_submission:read` 反查角色，字段名是 `Roles.operationPermissions`（不是 `operations`）。

---

## 8. 已知延期的 minor 问题（不阻塞，但合并前要有个结论）

来自 Task 1–3 的 review，完整列表在台账里：

- **`supply-submissions` 未加入 `payload.config.ts` 的 `auditFieldsPlugin.excludedCollections`**，而形态完全相同的 `information-corrections` 是被排除的（都是匿名前台提交，`createdBy`/`lastModifiedBy` 恒空）。字段惰性无功能影响，但与项目自身惯例不一致。**建议**：合并前补上排除。
- **`handledAt` 不在 protect hook 的 `IMMUTABLE_FIELDS` 里**，有 `supply_submission:manage` 权限者可经 API 直接改写（`admin.readOnly` 只挡后台 UI）。影响很小（只有授权管理者能 update），但字段描述写的是"状态流转到终态时自动写入"。
- 生成的 `migrations/index.ts` 新条目缺尾随逗号（生成物，不手改，纯观感）。
- `SiteFooter` 的营销 tagline 仍含「服务式办公室」字样（pre-existing；房源类型本身仍存在，只是不再占导航位，不是 bug）。

---

## 9. 三个待用户决策的占位（不要自己编数据）

计划把它们集中到了 `src/lib/frontend/landing-config.ts` 一个文件，改起来是几行：

1. **`ENTRUST_STATS` 三个数字背书**。对标站是「150+万套 / 1000+人 / 30分钟」，本站**不能抄这个量级**。计划里先填了保守口径（`全城覆盖` / `1对1` / `2小时响应`）。上线前需要用户给真实可辩护的值，或换维度（如"覆盖 X 个商圈"）。
2. **品牌背书短标签**。对标站是「阿里巴巴旗下商办平台」，本站占位为「上海中高端办公租赁平台」。品牌名固定 `商办租赁`，**不得出现"阿里"字样**。
3. **投放房源审单归哪个角色**。现有角色体系里没有明显对应的；计划的做法是新增操作码后由管理员持有，是否新建「供给运营」角色待定。

另外两条计划已按 PRD §13 建议定稿、不必再问：路由用 `/entrust` + `/publish`；不做短信验证码；不做 PRD §4.6 的"提交成功后可选补充需求表单"。

---

## 10. 建议的执行方式

计划的每个任务自带完整代码与验证命令，Codex 可以直接顺序执行。两点建议：

1. **一个任务一次提交，跑完该任务的验证命令再提交**。计划里每个任务的最后一个 Step 就是提交命令与提交信息。
2. **每个任务做完后自查 spec 符合度**：对照 brief 逐条确认"要求的都做了、没做要求之外的"。上一个会话是每任务派一个独立 reviewer 做这件事，抓到了 2 个真问题（其中 1 个是安全相关的静默失效）——如果你有能力起子 agent 做独立 review，值得保留这个环节；没有的话至少做一次冷眼自查。

全量验证（Task 12 会做，中途也可随时跑）：

```bash
cd payload-office-platform && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

```bash
cd payload-office-platform && pnpm migrate:status
```

注意 `pnpm migrate:status` 单次可能跑 3 分钟以上（tsx 加载 payload.config 很慢），别以为它卡死了。

收尾（Task 12 Step 5–6）：推分支 + 开 draft PR。PR body 里要注明 §9 的三个占位待用户确认。

---

## 11. 台账怎么记

继续往 `.superpowers/sdd/2026-08-09-entrust-supply-pages/progress.md` 追加行，格式沿用：

```
Task <N>: complete (commits <base7>..<head7>, review clean)
Task <N>: minor (deferred): <一句话>
```

台账的价值是**跨会话/跨压缩存活**：它记的 commit 在 git 里都能查到，比任何 agent 的记忆可靠。接手后先信台账和 `git log`，别信任何人的回忆（包括这份文档里与台账冲突的部分——以台账为准）。
