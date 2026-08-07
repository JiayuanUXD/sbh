# OPT-025 验证证据

验证日期：2026-08-07。服务、构建和测试均在隔离 worktree 中执行；本次仅使用 3718，未停止或修改主工作区 3717。

## 根因与设计基线

设计记录的热态 `/buildings` TTFB 约 1.2s，其中在租面积聚合约 818–834ms，是主要耗时。本次将完整公开楼盘目录缓存为 `public:buildings` 与 `public:listings` 双标签、`revalidate: 300`；区域、等级和分页继续复用同一 DTO。领域事件 tag 是主要即时失效机制；300 秒是 stale-while-revalidate 的重新验证阈值，超过阈值的首个请求可能返回旧值并后台刷新，后续请求获得新值，因此不存在严格五分钟陈旧硬上限。这是用户选择的访问速度优先权衡。

## Node 22 命令与自动化

执行前安全加载主工作区 `.env.local`，且没有输出其中值。首次 Node 22 tests/typecheck/build 使用 `NEXT_PUBLIC_SITE_URL=http://localhost:3718`；这足以构建，但其后用于 production 服务会被 guard 拒绝。最终闭环使用 guard 测试认可的安全占位 `https://sbh.example.com`。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm test -- tests/public-catalog-cache-invalidator.test.ts tests/cache-next-adapter-integration.test.ts tests/f7-4-6-performance-data-equivalence.test.ts tests/buildings-navigation-performance-contract.test.ts'
```

实际：Node `v22.23.2`、pnpm `8.6.1`、4 文件 38/38 通过。缓存失效证据涵盖 listing/building 的类别及具体 tag、`listing.published` 对真实 `next/cache.revalidateTag` 的调用、发布/审核/举报事件覆盖；OPT-025 合同验证固定键 `['search-buildings']`、双标签、300 秒重新验证阈值和页面缓存接入。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm exec tsc --noEmit --pretty false'
```

实际：Node `v22.23.2`、pnpm `8.6.1`、exit 0、无 TypeScript 错误。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm build'
```

实际：Node `v22.23.2`、pnpm `8.6.1`、exit 0；`/buildings` 成功构建为动态路由。隔离环境若不显式给出 `NEXT_PUBLIC_SITE_URL`，构建会在 `/robots.txt` 失败；这被记录为环境限制，不等同代码构建失败。

## 生产 HTTP / TTFB（Node 22）

服务 Ready（79ms）后测量；每项都记录实际 HTTP：

| 请求 | HTTP | TTFB (s) | 总时长 (s) |
| --- | ---: | ---: | ---: |
| `/` 首次 | 500 | 0.194135 | 0.228337 |
| `/buildings` 首次 | 200 | 0.027428 | 0.029420 |
| `/listings` 首次 | 200 | 1.189062 | 1.189952 |
| `/buildings` #2 | 200 | 0.006181 | 0.006987 |
| `/buildings` #3 | 200 | 0.006084 | 0.006803 |
| `/buildings?page=2` | 200 | 0.005814 | 0.006346 |
| `/` 重试 | 200 | 0.594952 | 0.596482 |
| `/?opt025followup=1` | 200 | 0.528642 | 0.530438 |

连续 `/buildings` 命中与 `?page=2` 为约 5.8–6.2ms TTFB，不再稳定承担 818–834ms 聚合。首次 `/buildings` 27.4ms 不被标记为冷缓存基线。

## 首页首次 500：日志与限制

500 的实际 URL 为 `/`，不是 `/buildings`。Node 22 服务端日志显示 `[config-guard]` 拒绝 `NEXT_PUBLIC_SITE_URL=http://localhost:3718`：生产值必须使用 HTTPS，且不得指向 localhost；随后记录 `Error running onInit function`。这证明该 500 来自无效的生产站点 URL 配置，而不是 OPT-025 代码。

同一服务后续首页重试为 200，浏览器 fresh query 也能显示首页；该恢复不用于关闭验收。最终以有效 URL 的 clean production 服务完成下面的首请求闭环。

## 浏览器矩阵

### 原生产服务实际观察

下表是首次生产服务验收时已实际完成的浏览器操作；它不是有效 HTTPS 占位 URL 后的重跑。该服务中浏览器与后续成功的 HTTP 页面均可用，但本次复审前没有按每一次点击单独抓取 HTTP，因此该列明确为“未单独记录”，不会倒填数值。该次浏览器操作后的 console `error` 均为 `[]`。

| 路由 / 操作 | 预期 | 实际 | HTTP（当时记录） | console error |
| --- | --- | --- | --- | --- |
| `/` 点击“找写字楼” | 进入 `/buildings` | 进入 `/buildings`；标题“找写字楼”，共 26 个楼盘、24 张第 1 页卡片和分页 | 未对该点击单独记录；该服务的后续首页请求为 200 | `[]` |
| `/buildings` 点击“黄浦区” | URL 与结果同步 | `/buildings?district=huangpu`；共 2 个楼盘，包含恒积大厦、无分页 | 未对该点击单独记录 | `[]` |
| `/buildings` 点击“下一页” | 页码与结果同步 | `/buildings?page=2`；显示第 25–26 个、共 26 个楼盘、2 张卡片 | 未对该点击单独记录；同服务 HTTP `?page=2` 为 200（TTFB 0.005814s） | `[]` |
| `/listings`，再点击“找楼盘” | 相邻路由与导航正常 | “在租房源”、24 个房源链接；点击后回到 `/buildings` | `/listings` 首次 HTTP 200（TTFB 1.189062s）；返回点击未单独记录 | `[]` |
| `/buildings`，375×812 | 标题、筛选、分页可见且无水平溢出 | 标题、黄浦筛选、下一页、24 张第 1 页卡片可见；`scrollWidth === clientWidth === 375` | 未单独记录 | `[]` |
| `/buildings`，768×1024 | 同上 | 同上；`scrollWidth === clientWidth === 768` | 未单独记录 | `[]` |
| `/buildings`，1440×900 | 同上 | 同上；`scrollWidth === clientWidth === 1440` | 未单独记录 | `[]` |
| `/buildings`，1920×1080 | 同上 | 同上；`scrollWidth === clientWidth === 1920` | 未单独记录 | `[]` |

原服务的浏览器逐路由基础状态为：`/` 后续页面显示首页标题、`/buildings` 为“找写字楼 / 共 26 个楼盘 / 24 张卡片”、`/listings` 为“在租房源 / 24 个链接”；相关 console `error` 均为空。原服务首个 `/` 的 500 和其无效 URL 根因仍如上节所述，不被这批历史操作掩盖。

## 有效 HTTPS 占位 URL 闭环

`tests/config-guard.test.ts` 将 `https://sbh.example.com` 定义为有效的生产 URL，并明确拒绝 HTTP/localhost。安全加载 `.env.local` 后用该无秘密占位值重新在 Node 22.23.2 / pnpm 8.6.1 下构建（exit 0），再使用同一值启动生产服务；浏览仍指向 `http://localhost:3718`。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=https://sbh.example.com \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm build'
```

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=https://sbh.example.com \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm exec next start -p 3718'
```

服务 Ready（99ms）后，三个首请求均为 200：

| 请求 | HTTP | TTFB (s) | 总时长 (s) |
| --- | ---: | ---: | ---: |
| `/` | 200 | 0.846162 | 0.848860 |
| `/buildings` | 200 | 0.018179 | 0.024667 |
| `/listings` | 200 | 1.197365 | 1.201542 |

服务端无 error（仅已有“未提供 email adapter”警告）。以下是这次**有效 HTTPS 配置后实际重跑的最小浏览器复核**，未声称重跑筛选、分页或四档视口：

| 路由 / 操作 | 预期 | 实际 | HTTP | console error |
| --- | --- | --- | --- | --- |
| `/` 加载 | 首页可用 | 首页主标题存在 | 首请求 200（TTFB 0.846162s） | `[]` |
| `/` 点击“找写字楼” | 进入 `/buildings` | URL 为 `/buildings`，显示“找写字楼 / 共 26 个楼盘” | `/buildings` 首请求 200（TTFB 0.018179s） | `[]` |

结合原生产服务中已完成的筛选、分页、相邻页和四视口证据，浏览器验收闭环。所有本次打开标签均已 finalize。

## 未验证项、风险与回滚

- 无验证阻塞项。生产服务的 canonical/OG URL 必须为 HTTPS 非 localhost；本地访问地址仍可以是 `http://localhost:3718`。本次使用项目 guard 测试中已有的 `https://sbh.example.com` 安全占位值。
- 缓存事件漏网时，`revalidate: 300` 仅在超过阈值的首个请求上触发后台刷新；该请求可能返回旧值，后续请求获得新值，因此没有严格 300 秒或五分钟陈旧硬上限。这是设计明确接受的访问速度优先风险。
- 回滚只需恢复 `/buildings` 的直接 `searchBuildings` 调用并删除缓存封装/合同测试；无数据库、迁移或数据恢复。
