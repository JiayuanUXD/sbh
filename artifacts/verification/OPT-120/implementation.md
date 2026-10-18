# OPT-120 实现与自动化验证

- 日期：2026-10-17；分支：`codex/building-auto-slug-b7e41a`；应用目录：`E:\github\sbh\payload-office-platform`。
- 实现：`ensureBuildingSlug` 挂在 Buildings 的 `beforeValidate`，先于 required 校验补齐标识。复用拼音与去重工具，查询带 `overrideAccess: true`、`trash: true` 和原 `req`，覆盖各发布状态并继承请求事务。
- 新建留空时生成拼音、冲突依次追加序号；符号名称使用 `building` 基名；更新保留原地址，显式自定义值保留。名称缺失交给原 required 校验。
- 表单：slug 保留 required/unique/API 输出，使用 `admin.disabled` 撤下手填框；名称旁复用 `ListingSlugBadge`；窄屏沿用房源图标内边距。

## 修改路径

- `payload-office-platform/src/domain/supply/building-slug.ts`（新增）。
- `payload-office-platform/src/collections/Buildings.ts`。
- `payload-office-platform/src/components/admin/ListingSlugBadge.tsx`（仅注释）。
- `payload-office-platform/src/app/(payload)/custom.scss`。
- `payload-office-platform/tests/building-slug.test.ts`（新增 19 条测试）。
- `payload-office-platform/tests/building-form-layout.test.ts`（新增 1 条契约；原 `any` 结构改为显式类型）。
- `payload-office-platform/src/app/(payload)/admin/importMap.js`（生成器将已有图标 import/映射提前至楼盘首次使用位置，未手工编辑）。
- `src/payload-types.ts` 已重新生成，不受 Git 跟踪；`prefix` 出现 2 次。

## 实际命令与结果

以下命令均在应用目录执行，输出保存到本目录对应日志。

| 阶段 | 命令 | 结果与证据 |
|---|---|---|
| 基线 | `pnpm exec vitest run tests/building.test.ts tests/building-protect.test.ts tests/building-form-layout.test.ts tests/listing-protect.test.ts tests/listing-form-layout.test.ts` | 退出 0；5 文件、74 测试通过；`baseline.log` |
| 先红 | `pnpm exec vitest run tests/building-slug.test.ts tests/building-form-layout.test.ts` | 退出 1；15 失败、14 通过；失败为 slug 缺失/未保留和表单 disabled 缺失，非模块导入错误；`red.log` |
| 后绿 | `pnpm exec vitest run tests/building-slug.test.ts tests/building-form-layout.test.ts tests/building-protect.test.ts tests/building.test.ts tests/listing-protect.test.ts tests/listing-form-layout.test.ts` | 退出 0；6 文件、94 测试通过；`green.log` |
| 类型生成 | `pnpm generate:types` | 退出 0；`generate-types.log` |
| 组件映射 | `pnpm payload generate:importmap` | 退出 0；`generate-importmap.log`；既有 dev 生成器已完成顺序更新，本次命令提示无新增 import |
| 类型检查 | `pnpm typecheck` | 退出 0，无类型错误；`typecheck.log` |
| lint | `pnpm lint` | 退出 0；0 错误、37 条未涉及文件的既有警告；`lint.log` |
| 全量单测 | `pnpm test` | 退出 1；475 文件通过、1 文件失败；6511 测试通过、1 失败；`unit-tests.log` |
| 失败复现 | `pnpm exec vitest run tests/staging-cloudrun-package.test.ts` | 退出 1；同一测试报 `spawnSync tar ENOENT`；`staging-test-diagnostic.log` |
| 环境修正后定向复验 | `$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH; pnpm exec vitest run tests/staging-cloudrun-package.test.ts` | 退出 0；该文件 31 测试全部通过；`staging-test-path-fix.log` |
| 补充检查 | `git diff --check`；对新增 hook 和楼盘两份测试搜索 `any`/类型忽略 | 退出 0，无空白错误；未发现 `any` 或类型忽略 |

全量唯一失败来自当前测试子进程 PATH 缺少 `tar`。确认 Git 自带 tar 存在后，只修改定向测试子进程 PATH 即恢复；未修改系统环境或仓库配置。依主代理要求，不重复全量运行，保留首轮结果与失败用例定向通过证据。首次后绿尝试中，表单契约遍历命中了嵌套“认证名称”的同名字段，修正为取首个楼盘名称后通过；生产组件绑定位置正确。

## 风险与交接

- 同时新建同名记录仍由既有数据库唯一约束兜底；未增加分布式分配或冲突自动重试，符合已确认范围。
- 当前命令使用 Node 24.14.0 / pnpm 8.6.1；pnpm 提示仓库要求 Node 22.x，以上结果均为当前实际运行证据。
- 未变更数据库 schema，未产生空迁移，未执行数据库迁移、提交、推送、PR 或部署；未修改 `.env*` 和既有 `next-env.d.ts`。
- 本代理未执行构建或数据库专属测试；真实浏览器验收、独立审查和最终验证报告由主代理负责。
