# MP-108 候选终审修复与复验（2026-09-08）

## 修复范围

本轮针对候选终审发现的两个并发/性能缺口完成最小修复：

1. Mini 列表冷请求不再为列表、总数和 facets 重复扫描同一公开供给；Mini 与 Web 复用带 `asOf` 的单份供给快照，Mini 在内存中完成过滤、分页和 facets 聚合。
2. 收藏 200 条上限改为按 subject 的 PostgreSQL 事务级 advisory lock 串行化；提交后使用未绑定事务的主库读取精确确认本次记录。数据库提交结果不可确认时返回 `mini_user_asset_transaction_unavailable`，不重放写入，也不把另一请求创建的同 key 记录误报为本次成功。

高级模型分别完成供给快照与收藏事务审查。最终结论均为 Critical 0 / Important 0 / Minor 0。真实 PostgreSQL 用例证明“事务已 aborted、适配器 COMMIT fulfilled、资产未落库”时 API 不误报成功；真实 COMMIT Promise rejection 的吞错机制来自已安装 Payload/Drizzle 源码核验，并由单元测试覆盖其可观察语义，未把两类证据混称为同一项真库实测。

## 新增与强化测试

- `tests/mini-listings-scan-cache.test.ts`：覆盖冷请求单次扫描、Mini/Web 并发共享扫描、不同 Mini 筛选复用同一暖快照。
- `tests/mini-user-assets-transaction.test.ts`：覆盖事务初始化、锁、提交/回滚、提交后确认缺失/异常/字段不符及不可确认提交。
- `tests/mini-user-assets-postgres.test.ts`：覆盖 199 条时两个不同目标竞争、同目标幂等、aborted 事务下适配器 fulfilled 的拒绝路径。
- `tests/postgres-test-runner-config.test.ts`：锁定共享 PostgreSQL 测试库按文件串行执行，并确保 CI 复用同一命令。

## 本轮复验结果

| 范围 | 结果 |
| --- | --- |
| 小程序 | 46 files / 938 tests；双 TypeScript 与 `project:check` 通过 |
| Web 普通全量 | 366 files passed、9 skipped；5175 tests passed、44 skipped |
| Web PostgreSQL | `pnpm test:postgres`：9 files / 44 tests，零失败、零跳过 |
| Web 静态门 | typecheck 通过；lint 0 errors / 22 个既有 warnings |
| 迁移门 | 81 migrations；dry-run 0 blocking / 4 个既有 warnings；preflight 0 fail / 1 个既有 warning；drift 通过 |
| production build | Next.js 16.2.10 构建通过；12 条 Mini API 动态路由均进入输出 |
| 数据结算 | 本地 `sbh_dev_mp108_fresh` 保持 81 条迁移；`mp108-favorite-%` 测试标记为 0 |

普通 Web 全量与 PostgreSQL 套件首次并行执行时，共享测试库在高负载下出现多文件 5 秒超时，并留下 2 条带唯一 subject 的本轮收藏测试记录。只读确认无活跃连接后，按该精确 subject 删除 2 条并核验为 0；未广删其他数据。随后新增稳定命令：

```sh
pnpm test:postgres
```

该命令为 `vitest run tests/*-postgres.test.ts --no-file-parallelism`。配置守卫先 RED（脚本缺失），再随 `package.json` 与 `quality.yml` 修复转 GREEN；最终通过该仓库命令重新取得 44/44 真库结果。

本轮未访问或修改 staging、trial、生产数据库、生产 CloudRun 或正式小程序。此前 HTTP/E2E/DevTools 证据绑定旧提交，仅作为已完成链路证据；新冻结候选仍需重新绑定 build-info，并在 staging/trial 阶段采集对应 SHA/revision 的真实证据。
