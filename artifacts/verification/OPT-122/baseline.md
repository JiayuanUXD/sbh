# OPT-122 Batch 0 基线

- 日期：2026-10-19 23:18（本地）
- 工作树：`E:\wt-opt122`
- 分支：`feat/opt-122-site-search-6912`
- 基线提交：`4af9531d`（origin/master）
- Node：v22.22.2；pnpm：8.6.1
- 环境：`PORT=3721`；`DATABASE_URL` 指向本机 `localhost:5432/sbh_dev_opt122`（新建，空库）；`NEXT_PUBLIC_SITE_URL=http://localhost:3721`；COS 未配置（走本地磁盘）

## 命令与结果

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm install` | 通过（1m 2s） | 4890 个文件完整性校验通过 |
| `pnpm generate:types` | 通过 | 写入 `src/payload-types.ts`（gitignored） |
| `pnpm payload generate:importmap` | 通过 | 无新增 import |
| `pnpm typecheck` | **0 error** | — |
| `pnpm lint` | **0 error / 37 warning** | 均为既有的 `no-img-element`（卡片裸 `<img>`）与 `no-html-link-for-pages`（LoginForm 的 `/admin/login/`），与 OPT-122 无关 |
| `pnpm test` | **6555 passed / 1 failed** | 失败：`tests/staging-cloudrun-package.test.ts` 超时 5000ms；本机 tmpdir 在 C 盘、仓库在 E 盘的历史环境问题，主树同样失败，判定为既有失败 |

## 结论

- 基线干净：除 `staging-cloudrun-package` 的既有超时外全绿。
- `sbh_dev_opt122` 尚未跑迁移与 seed；进入 Batch 3（真库查询）前执行 `pnpm exec payload migrate` 与 `pnpm seed`，不触碰主树 `postgres` 库与生产库。
- 工作树内 `specs/work-items/OPT-122-*.md` 是从主树复制的参考副本（untracked），正式文档仍在 `docs/opt-122-site-search-a7c3` 分支上。
