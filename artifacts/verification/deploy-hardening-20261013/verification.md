# 连接池满故障加固 验证记录（2026-10-13）

## 背景

生产两次出现「首页正常、图片和其它页面挂死」（sbh-223 / 226 旧代码，与 OPT-046 同一指纹）。
冒烟的 `/api/health` 打到坏掉的稳定版本，run 38364936280 三次尝试都在第 1 个请求 15s 超时后
整步中断（`bash -e` 下 `code=$(curl ...)` 随 curl 退出 28 一起失败）并回滚到故障版本；
最终由用户在控制台手动把流量切到 227（`10e5d20`）恢复。

## deploy.yml 冒烟 / 全量后验证（`run-smoke-scenarios.sh`，假服务 `fake-health-server.py`）

| 场景 | 改前 | 改后 |
|---|---|---|
| 冒烟第 1 个请求超时 | exit 28（2s 内整步中断） | exit 0，通过 |
| 冒烟时服务全部超时 | — | exit 1，网络层失败超过 5 次判失败 |
| 冒烟全部正常 | — | exit 0 |
| 全量后验证第 1 个请求超时 | exit 28 | exit 0，通过 |
| 全量后版本号不符 | — | exit 1，照常判失败 |
| 全量后服务全部超时 | — | exit 1 |

## 部署包按容器方式复现（本地 PG，57,552 条房源的放大数据）

照 Dockerfile 构建部署包，用 Dockerfile 里原样的 CMD 经 `sh`（dash）启动：

- 启动到 `Ready`：8.4s（改前同环境 16.7s）。迁移完成与「交给 pnpm start」同一秒，不再空等 5s。
- `next-server` 进程环境里有 `DB_STATEMENT_TIMEOUT_MS=30000`；迁移步骤命令里不带（守卫测试钉住）。
- `/api/health` 整次请求只执行 1 条 `select $1`，返回新提交的 version。
- 另一会话 `LOCK TABLE listings IN ACCESS EXCLUSIVE MODE` 持锁 45s 时请求未缓存的房源列表页：
  30.04s 返回 500，PG 日志 `canceling statement due to statement timeout`；锁释放后下一请求 200。
- 80 个并发未缓存请求下，应用连接峰值 20（改前上限 10）。
- 首页、房源 / 楼盘目录、两类详情页均 200。

## 仓库内检查

`pnpm typecheck` 通过；`pnpm lint` 0 error（35 项既有 warning）；`pnpm test` 440 文件 / 5985 用例全过。
守卫反向验证：去掉冒烟里一处 `|| true`，`冒烟与全量后验证不会因单次网络层失败直接中断步骤` 按预期变红。
