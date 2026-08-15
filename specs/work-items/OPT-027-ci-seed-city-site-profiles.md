# Task Packet：OPT-027 补齐 CI 测试数据基线（城市节点与站点档案）

> 状态：主体已完成，待 CI 终验与合并
> 创建日期：2026-08-15
> 最后更新：2026-08-16
> 交接说明：本文件是跨 agent / 跨 IDE 的交接文档，写给没有前序会话上下文的人。所有结论都标注了取证方式，不要凭本文件的转述下判断，关键处请自行复核。
> §8 的 PR 状态是快照，多半已过期，**以 `gh pr list` 的实时结果为准**。

## 交接 prompt（直接粘给接手的 agent）

```text
接手 OPT-027 的收尾。任务书在 specs/work-items/OPT-027-ci-seed-city-site-profiles.md，
先完整读完它，再读它 §0 指定的规则文件。

主体已完成（e2e 失败从 48 降到 0 待确认），你要做的是收尾与合并，不是重新实现。

1. 先看实时状态，不要信任务书里的快照：
   gh pr list
   gh pr checks 47    # 本工作项
   gh pr checks 46    # 依赖：多城市开启态的 e2e 步骤在这里

2. 合并顺序有依赖：#46 必须先于或同时合并，否则多城市开启态没有验证通道（§5）。

3. 如果 #47 的 e2e 仍有失败，逐个查真实报错再动手，不要假设它们同源——这个任务里
   11 个失败分属三种完全不同的原因（§4）。取证命令：
   gh api repos/JiayuanUXD/sbh/actions/jobs/<jobId>/logs

4. 遵守仓库四条红线（§0）。.githooks/ 会拦你：分支名要合规、提交只用显式
   git add <具体路径>、禁止 --no-verify。逃生舱环境变量存在，但你用之前必须先
   告诉我理由并等我确认。

5. 提交、推送、开 PR、合并之前都要先问我。#45 的合并会真改生产数据，尤其要确认。

6. 汇报时把"验证过的"和"推断的"分开写。本地 typecheck/test 通过不等于问题解决——
   这个任务的真实验证只能来自 CI 的 e2e 作业。没跑过就明说没跑过。

剩余事项清单见 §13。
```

## 0. 先读这些

1. 仓库根 `CLAUDE.md`（分支模型、命名规范、本地闸门、CloudBase 部署坑）
2. `payload-office-platform/CLAUDE.md`（命令与预检顺序、生成物纪律、数据库）
3. `payload-office-platform/.agent/testing.md`（验收铁律）、`.agent/migrations.md`（迁移规则）
4. 非 Claude Code 的 agent 从仓库根 `AGENTS.md` 进入

**四条红线**（违反即回退）：不在 `master` 上写代码；提交只用显式 `git add <具体路径>`，禁用 `git add -A`；数据库只走显式迁移且**迁移文件正文绝不可手改**；未经用户确认不得提交、推送、创建 PR、部署或执行破坏性迁移。

`.githooks/` 已把前三条变成机器强制（`cd payload-office-platform && pnpm setup:hooks` 启用）。逃生舱环境变量存在，但 **agent 使用前必须先向用户说明理由并获得确认**。

## 1. 目标

让 `quality.yml` 的 e2e 作业能在全新 CI 库上跑通。起点是 **48 个用例失败**，根因是测试数据基线缺失，不是被测代码有问题。

## 2. 非目标

- 不把 `pnpm import:geography` 引入 CI（见 §6）
- 不动 `src/app/(frontend)` 的任何运行时逻辑
- 不碰生产数据
- 不在生产开启多城市路由（产品决定：短期不开，但要保持随时可测）

## 3. 根因一：站点档案从未被创建（已解决）

C 端房源详情路由 `src/app/(frontend)/listings/[slug]/page.tsx:37`：

```ts
const city = await resolveCityContext(siteConfig.defaultCity)
if (!city || city.serviceStatus !== 'live') notFound()
```

`serviceStatus` 存放在 `city-site-profiles` 集合。**CI 库里该表 0 行**，于是 `resolveCityContext` 返回 null，每个 C 端详情页都 404。

为什么是 0 行：

| 环节 | 行为 |
|---|---|
| 迁移 `20260813_011000_seed_city_site_profiles` | 播种档案，但要求城市已存在；空库时跳过（该跳过行为见 PR #44） |
| `pnpm seed` | **从不创建站点档案**，且只创建 1 个城市（上海，`immutableCode: 'SH'`） |
| e2e 作业 | migrate（跳过）→ seed（无档案）→ 直接跑测试 |

全新环境里城市是在迁移之后才由 seed 写入，所以**永远没人创建档案**。生产之所以正常，是因为那条迁移执行时上海早已在库。

## 4. 根因二：多城市用例把「开启态」当默认（已解决）

补完数据后失败从 48 降到 11，剩下的分属**三种完全不同的原因**——这是本任务最容易误判的地方，务必注意：

| 失败 | 真实原因 | 与种子数据的关系 |
|---|---|---|
| `multi-city-routing:72`（切换器断言） | `SiteHeader.tsx:33` 只在 `multiCityRoutingEnabled` 为真时渲染 `CitySwitcher` | 无关 |
| `multi-city-isolation:33`、`:48` | 城市前缀路由 `/<city>/listings` 以同一 flag 为前提 | 无关 |
| `multi-city-forms:230` | `/city-partner?city=hangzhou` 同上 | 无关 |
| `geography-admin:203` | 断言过期：`region-management` 导航组实有 5 项（`navigation-config.ts:68`），用例仍断言 4 项 | 无关 |

`MULTI_CITY_ROUTING_ENABLED` 在 e2e 作业里未设置，`getMultiCityRoutingEnabled()`（`site-config.ts:146`）恒为 false。

**关键事实：生产也没开启。** 实测线上首页 `city-switcher__trigger` 出现 0 次；`Dockerfile`、`deploy.yml`、`.env.example` 均无该变量。所以这批用例是**为尚未启用的形态写的，从未在任何环境通过过**。

## 5. 已实施的改法

**PR #47（本工作项）**

1. `scripts/seed.ts` 补 6 个城市节点（仅 city 层级）+ 7 份站点档案，复用迁移导出的 `CITY_SITE_PROFILE_SEEDS`，幂等
2. 多城市用例按 flag 分档：`multi-city-routing:72` 的切换器断言包进 `if (routingEnabled)`；`isolation` 两个、`forms` 一个整体依赖开启态的用例改为 `test.skip(!routingEnabled)`
3. `geography-admin:203` 断言 4 → 5，并补断言「城市站点配置」
4. 去掉本分支新增的两处 `as any`

**PR #46（依赖，必须先于或同时合并）**

`quality.yml` 新增 `Run multi-city E2E (routing enabled)` 步骤：复用同一份构建产物与同一个库，仅以 `MULTI_CITY_ROUTING_ENABLED=true` 重启 server 跑多城市三个 spec。该 flag 由服务端运行时读取、不参与 `next build` 内联，故无需重新构建。

这样主闸门跟随生产（关闭态），多城市能力仍然**随时可测**。

工作流改动放在 #46 而非 #47，是因为两者都改 `quality.yml`，放一起会冲突。

## 6. 为什么不用 `pnpm import:geography`

那是生产用的重型导入（1854 个节点，见 `DEPLOYMENT.md` 的「生产地理数据导入记录」）。测试只需要 7 个城市首页可解析，用生产链路满足夹具需求，CI 时间与复杂度都不划算。

## 7. 验证方式

本地：

```bash
cd payload-office-platform
pnpm generate:types && pnpm payload generate:importmap
pnpm typecheck && pnpm test && pnpm migrate:dry-run && pnpm build
```

**本地绿灯几乎不说明问题**——它们不连库、不跑浏览器。真实验证只能来自 CI 的 e2e 作业。

进度记录：

| 阶段 | e2e 失败 | 耗时 |
|---|---|---|
| 修复前 | 48 | 52m33s |
| 补齐数据后 | 11（120 通过） | 15m52s |
| 按 flag 分档后 | 待 CI 确认 | — |

## 8. 分支与 PR 状态（2026-08-16 快照，以 `gh pr list` 为准）

| PR | 内容 | 状态 |
|---|---|---|
| [#43](https://github.com/JiayuanUXD/sbh/pull/43) | 后台楼盘媒体工作台 + 配套面板 | 已 rebase；**合并前需人工验收四条**，见 §9 |
| [#45](https://github.com/JiayuanUXD/sbh/pull/45) | 上海代码收敛 `LEGACY_LOC_1`→`CITY-SH` | **合并会真改生产数据，需用户再次确认** |
| [#46](https://github.com/JiayuanUXD/sbh/pull/46) | CI 闸门加固 + 多城市开启态 e2e 步骤 | #47 的依赖 |
| [#47](https://github.com/JiayuanUXD/sbh/pull/47) | 本工作项 | 待 CI 终验 |

已合并的 [#44](https://github.com/JiayuanUXD/sbh/pull/44) 修了两个 CI 缺陷：种子迁移打不到空库、`multi-city-forms` 无条件读 `.env.local`。

## 9. #43 合并前的人工验收（尚未执行）

admin React 组件没有单测覆盖，以下四条必须在真实后台点一遍：

- [ ] 已有媒体的楼盘批量上传 → 保存 → 刷新，新图仍在
- [ ] 删除中间一项 → 保存 → 刷新，删对了且无连带丢失
- [ ] 拖拽调序 → 保存 → 刷新，顺序与界面一致
- [ ] 清空配套 → 保存 → 刷新，确实清空

前三条正是该 PR 修复的核心路径（Payload 对有行的 array 会设 `disableFormData`，父路径提交时被跳过；必须走 `addFieldRow`/`removeFieldRow`/`moveFieldRow` 行级 action，**严禁用 `setValue` 往 array 父路径写整个数组**）。

## 10. 容易踩的坑（都已取证）

- **删除 location 极其危险**：指向 `locations` 的 22 个外键**没有一个是 RESTRICT**，全是 `CASCADE` 或 `SET NULL`。删除被引用的城市不会报错，而会静默把 `buildings.city_id` 置空、级联删 `*_rels`。保护只在应用层 `location-delete-guard`，原始 SQL（含迁移）会绕过它。
- **`scripts/seed.ts` 里 `(payload as any)` 共 8 处，其中 6 处是既有代码**（217/969/1281/1294/1321/1332）。批量替换会引入满屏类型报错——那些错来自既有行，不是你的改动。去掉既有 6 处属独立技术债，本工作项只清理了新增的 2 处。
- **e2e 耗时是配置放大**：`workers: 1` + CI `retries: 2` + 每用例 60s，一个失败用例烧 3 分钟。#46 已加 `timeout-minutes: 30` 止血。
- **`payload-types.ts` 是生成物但仍被 git 跟踪**；本地缺 COS 配置重生成会静默删掉 `Media.prefix`。提交前 `grep -c "prefix" src/payload-types.ts` 必须是 2。
- **改 collection 会触发 pre-commit 的迁移检查**；纯注释/UI 改动属误报，用逃生舱前须获用户确认。

## 11. 对接手方的期望

写下来是因为这些不是格式要求，而是这轮调查里真实付出过代价的地方：

**先复核再采信。** 本文件是转述。这轮有过两次真实误判：其一，我一度断言"补了档案六城仍会 404、所以缺口比想象的大得多"，那句对 7 城路由那簇成立，但对占大头的 detail 那簇是错的；其二，我把剩余 11 个失败**整体归因于 flag**，逐个查完才发现 `geography-admin:203` 其实是断言过期，与 flag 毫无关系。**承重结论必须自己跑一遍取证命令。**

**别假设同源。** 一批失败看起来像一个原因，往往不是。这个任务里 11 个失败分属三种原因。

**遇到与文档不符，以你查到的为准**，并明确告诉用户哪里对不上，不要默默按文档做。

**范围守住。** 任何扩大先跟用户确认。

**分清"验证过"与"推断"。** 本地 `typecheck` + `test` 全绿在这个任务里几乎不说明问题。唯一有效的验证是 CI 的 e2e 作业。

**别绕闸门。** `.githooks/` 拦你的时候通常是对的。确实是误报时，先向用户说明理由、拿到确认再用逃生舱，并把理由写进提交信息。

## 12. 已解决的历史疑问

> 这批 e2e 用例期望的多城市能力在 CI 里从未通过过，是"写好了但从未验证"还是"曾在有数据的环境验证过、只是 CI 没配"？

**答案：前者。** 生产未开启多城市路由（实测线上 `city-switcher__trigger` 出现 0 次），CI 也未设该 flag，所以这些用例在任何环境都没通过过。产品决定是短期不开、但保持随时可测，故采用 §5 的双档方案。

## 13. 剩余事项

- [ ] #47 的 e2e 终验（预期全绿；若仍有失败，按 §11「别假设同源」逐个查）
- [ ] #46 先于或同时合并（否则多城市开启态无验证通道）
- [ ] #43 的四条人工验收（§9）
- [ ] #45 合并前的生产数据变更确认
- [ ] `scripts/seed.ts` 既有 6 处 `as any` 的技术债（独立立项）
- [ ] 多城市路由何时在生产开启（产品决定，决定后需同步 `Dockerfile` / CloudRun 环境变量）
