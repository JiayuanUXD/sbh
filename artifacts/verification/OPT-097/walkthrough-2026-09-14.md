# OPT-097 页脚 ICP 备案号 — 走查记录（2026-09-14）

分支 `feat/opt-097-footer-icp-record-a26d`（基于 `origin/master` 73f1643），工作树 `E:\wt-097`，
dev `next dev -p 3729`（Turbopack），任务库 `sbh_dev_097`（从夹具库 `postgres` 克隆，补齐 OPT-096 迁移后再生成本迁移）。

截图由 Playwright（`@playwright/test` chromium，1440×900 / 375×812，DPR 2）直出，DOM 判据在同一脚本
（`capture.mjs`）里读取；面板（`mcp__Claude_Browser__*`）走查另做一遍，文案一律以 `innerText` 核对。

## 闸门

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 0 错 |
| `pnpm lint` | 0 error，35 warning（全部是既有 `@next/next/no-img-element`，master 基线同数） |
| `pnpm test` | 384 文件 / 5097 用例全过（含新增 `tests/opt097-icp-record.test.ts` 10 条） |
| `pnpm migrate:dry-run` | `20260914_034003_opt_097_icp_record`：up/down/json 齐，no forbidden patterns（报告里 4 条 warning 属历史迁移 locations 改列类型） |
| `pnpm build` | Compiled successfully in 20.6s，exit 0 |
| `pnpm exec playwright test tests/e2e/footer-icp-record.spec.ts` | 2/2 passed（24.3s，dev server 复用） |

迁移 DDL 只有一句：`ALTER TABLE "site_settings" ADD COLUMN "icp_record_number" varchar;`，可空、无默认、无回填。

## 后台（`/admin/globals/site-settings` → 「页脚」tab）

| # | 动作 | 实测 | 证据 |
|---|---|---|---|
| 1 | 「ICP 备案号」填 `abc` → 保存 | `POST /api/globals/site-settings` → **400**；字段红框；字段级红字「格式应为「沪ICP备2026037944号」（省份简称 + ICP备/证 + 数字 + 号，可带 -序号）」；Toast「下面的字段是无效的：页脚 > ICP 备案号」；tab 标签出现错误计数 1 | `admin-invalid-400-1440.png` |
| 2 | 改成 `沪ICP备2026037944号` → 保存 | 200 +「更新成功」；响应体 `"icpRecordNumber":"沪ICP备2026037944号"` | 面板 `read_network_requests` 22028.435 |
| 3 | 强刷重进「页脚」tab | 输入框回显 `沪ICP备2026037944号`；tab 上的错误计数消失（#2 保存成功后它曾残留，是保存前的客户端状态，刷新即清） | `admin-footer-tab-1440.png` |
| 4 | 深色主题 | 面板走查全程在深色主题下做（后台默认深色），输入框底色跟主题，无残留白底；Playwright 出图是浅色主题，两套都看过 | 面板截图（会话内） |

## C 端

| # | 路由 / 视口 | 实测 | 证据 |
|---|---|---|---|
| 5 | `/` 1440 | 底栏子节点顺序 `SPAN:© 2026 商办租赁平台` → `A:沪ICP备2026037944号` → `SPAN:上海 · 商务办公租赁` → `A:员工入口`；`href="https://beian.miit.gov.cn/"`、`target="_blank"`、`rel="noopener noreferrer"`；链接字色 `rgb(110,110,115)` 与底栏同色，`text-decoration: none` | `footer-bar-1440.png` |
| 6 | `/shanghai` 375 | 同一顺序；`scrollWidth 375 == innerWidth 375`，无横向溢出；备案号与版权在同一行（x 143–268） | `footer-bar-375.png` |
| 7 | 后台清空字段（API `icpRecordNumber: null`）→ `/` | `.site-footer__icp` 0 个；整页 HTML 不含 `beian.miit.gov.cn`；底栏文案回到三段 | 面板 JS 判据 |
| 8 | 后台填回 `沪ICP备2026037944号` → `/` | 链接恢复，href 正确 | 面板 JS 判据 |

控制台唯一 error 是 #1 故意触发的那次 400，无其它报错。

## 备注

- 走查截图里的圆形「N」是 Next dev 角标（`nextjs-portal`），生产没有；`capture.mjs` 出图前把它隐藏了。
- 面板末尾一次 `screenshot` 纯白，是面板未合成帧（已知情形），DOM 判据在同一批次里已取到，不影响结论。
- 任务库上本迁移已应用（`pnpm exec payload migrate`），走查后库里留的是合法值 `沪ICP备2026037944号`。
