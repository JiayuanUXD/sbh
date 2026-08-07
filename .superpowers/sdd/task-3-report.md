# OPT-025 Task 3 — 静态、生产构建、性能与浏览器验收

## 原验证记录（已由本次 follow-up 更正）

首次验收曾在 Node 24 环境中得到 typecheck、构建和 `/buildings` 缓存命中证据，但证据表将一个 500 错误地同时称作“`/buildings` warmup”与“首页 warmup”。该描述不可采信，已由以下 Node 22 follow-up 以明确 URL、HTTP 状态和服务端日志替换。旧记录中的筛选、分页、四档视口与 `/listings` 浏览器功能观察保留为历史证据。

## Follow-up：Node 22 自动化与构建

所有以下命令在 `payload-office-platform` 内执行；先安全加载主工作区 `.env.local`，不输出任何变量值，再显式设置本地验收 URL：

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm test -- tests/public-catalog-cache-invalidator.test.ts tests/cache-next-adapter-integration.test.ts tests/f7-4-6-performance-data-equivalence.test.ts tests/buildings-navigation-performance-contract.test.ts'
```

实际版本：Node `v22.23.2`、pnpm `8.6.1`；结果：4 个文件、38/38 测试通过。覆盖内容包括：

- `buildings-navigation-performance-contract`：楼盘缓存同时依赖 `public:buildings`、`public:listings`，重验证为 300 秒，页面不再直接创建搜索上下文。
- `public-catalog-cache-invalidator`：房源/楼盘事件的类别 tag 与具体 tag、缺失 ID 的安全处理、所有关注事件的覆盖。
- `cache-next-adapter-integration`：真实 `next/cache.revalidateTag` 接线及 `listing.published` 失效路径。
- `f7-4-6-performance-data-equivalence`：缓存 tag、发布/审核/举报事件覆盖，以及前台消费者的数据等价守护。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm exec tsc --noEmit --pretty false'
```

结果：Node `v22.23.2`、pnpm `8.6.1`；exit 0、无 TypeScript 错误。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=http://localhost:3718 \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm build'
```

结果：Node `v22.23.2`、pnpm `8.6.1`；exit 0。Next 编译、TypeScript、数据收集和静态页生成均完成，`/buildings` 在路由清单中为动态 server-rendered 路由；未出现 Node engine 警告。

`NEXT_PUBLIC_SITE_URL` 是生产必需配置：在隔离 worktree 未显式提供时，构建会在 `/robots.txt` 失败。这是环境配置限制，不是 OPT-025 代码失败；本次没有把该失败计入上述绿色构建。

## Follow-up：Node 22 生产 HTTP 与服务端日志

确认 3718 空闲后，使用上述 Node 22 产物启动生产服务；3717 从未停止或修改。Ready 日志为 Next `✓ Ready in 79ms`，随后才开始请求目标路由。首次目标请求和后续连续请求如下：

| 请求 | HTTP | TTFB (s) | 总时长 (s) | 实际观察 |
| --- | ---: | ---: | ---: | --- |
| `/` 首次 | 500 | 0.194135 | 0.228337 | 服务器日志记录 config guard 失败，见下节 |
| `/buildings` 首次 | 200 | 0.027428 | 0.029420 | 目标页正常 |
| `/listings` 首次 | 200 | 1.189062 | 1.189952 | 相邻页正常 |
| `/buildings` #2 | 200 | 0.006181 | 0.006987 | 缓存命中 |
| `/buildings` #3 | 200 | 0.006084 | 0.006803 | 缓存命中 |
| `/buildings?page=2` | 200 | 0.005814 | 0.006346 | 复用同一缓存结果 |
| `/` 重试 | 200 | 0.594952 | 0.596482 | 同一服务后续响应恢复 |
| `/?opt025followup=1` | 200 | 0.528642 | 0.530438 | 强制新 URL 的后续首页响应 |

`/buildings` 两次连续命中与 `?page=2` 为约 5.8–6.2ms TTFB，仍不稳定承担设计基线 818–834ms 的聚合耗时。首次 `/buildings` 的 27.4ms 不能标记为新的冷缓存基线，因此没有伪造冷/热阈值结论。

服务端首次 `/` 的日志明确为：`[config-guard]` 拒绝 `NEXT_PUBLIC_SITE_URL=http://localhost:3718`，理由是生产配置要求 HTTPS 且不得指向 localhost；随后 Payload 记录 `Error running onInit function`。这解释了首次 `/` 的 500：它是无效验收配置的结果，而不是 OPT-025 代码故障。

## Follow-up：浏览器逐路由

浏览器复测与 HTTP 测量使用同一 Node 22 服务。浏览器在此前标签释放后需重新连接；本次创建的三个标签最终均已 finalize。

| 路由 | HTTP 结果 | 页面结果 | console `error` |
| --- | --- | --- | --- |
| `/` | 首次 500；后续 `/` 和唯一 query URL 均 200 | 后续 fresh query 页面显示首页标题“汇聚高端商务空间，赋能企业卓越成长” | `[]` |
| `/buildings` | 首次 200 | 标题“找写字楼”、共 26 个楼盘、24 张第 1 页卡片 | `[]` |
| `/listings` | 首次 200 | 标题“在租房源”、24 个房源链接 | `[]` |

完整浏览器矩阵见 `artifacts/verification/OPT-025/README.md`：它逐行区分原生产服务的实际首页跳转、黄浦筛选（`district=huangpu` / 2 项）、分页（`page=2` / 25–26 共 26 / 2 卡）、`/listings`（24 链接）及四视口无水平溢出，和有效 HTTPS URL 后实际重跑的最小首页→楼盘复核；每行记录预期、实际、可用 HTTP 和 console error，未把未重跑项目记作新结果。

## Follow-up：有效生产 URL 闭环

`tests/config-guard.test.ts` 明确以 `https://sbh.example.com` 作为有效生产 URL，并断言 HTTP 与 localhost 都应被拒绝。因此以该文档化的非秘密占位值重新构建并启动 Node 22 服务，同时仍通过 `http://localhost:3718` 访问本地服务器：

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=https://sbh.example.com \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm --version && pnpm build'
```

结果：Node `v22.23.2`、pnpm `8.6.1`、exit 0；Next 完成编译、TypeScript、数据收集和静态页生成，`/buildings` 路由构建成功。

```sh
set -a; source /Users/liujiayuan/App/sbh/payload-office-platform/.env.local; set +a
NEXT_PUBLIC_SITE_URL=https://sbh.example.com \
  npx --yes --package=node@22 --package=pnpm@8.6.1 --call 'node --version && pnpm exec next start -p 3718'
```

实际服务版本为 Node `v22.23.2`；监听地址仍是 `http://localhost:3718`。

在服务 `✓ Ready in 99ms` 后，三个**首个**目标请求均为 200：

| 请求 | HTTP | TTFB (s) | 总时长 (s) |
| --- | ---: | ---: | ---: |
| `/` | 200 | 0.846162 | 0.848860 |
| `/buildings` | 200 | 0.018179 | 0.024667 |
| `/listings` | 200 | 1.197365 | 1.201542 |

服务端日志没有 error；仅有已知的“未提供 email adapter，邮件将写入控制台”警告。最小浏览器复核在同一服务上：首页主标题存在，点击“找写字楼”后 URL 为 `/buildings`、显示“共 26 个楼盘”；点击前后 console `error` 均为 `[]`。本次标签已 finalize；筛选、分页、相邻页和四视口采用 README 中明确标识的原生产服务实际观察。

## 文件变更、自审与限制

- 更新 `artifacts/verification/OPT-025/README.md`：以 Node 22 命令、focused 测试、明确 URL 的 HTTP/日志和逐路由浏览器结果替换矛盾的 warmup 描述，并添加有效 HTTPS 占位 URL 的闭环证据。
- 更新 `specs/work-items/OPT-025-buildings-navigation-performance.md`：有效配置下的三个首请求、首页→楼盘浏览器复核均通过后，任务状态改为“已完成”。
- 本文件仅保留 OPT-025 原验证更正及本次 follow-up，不含其他任务的历史内容。
- 本次没有修改生产代码或合同测试，没有数据写入、迁移、git add、commit 或 push。
- 验收结束后只终止本次启动的 3718 进程，并确认端口释放。

## 结论

缓存实现的 focused 自动化、Node 22 typecheck、Node 22 production build、`/buildings` 命中性能、首页/目标页/相邻页首请求，以及首页→楼盘浏览器复核均有绿色证据。`http://localhost:3718` 是访问地址，不是可用于生产 canonical/OG 配置的站点 URL；使用 guard 认可的 `https://sbh.example.com` 占位值后验收闭环，任务完成。
