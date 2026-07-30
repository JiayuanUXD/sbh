# FPD-P0 房源与楼盘详情验证证据

## 验证对象

- 分支：`codex/detail-pages-p0-core`
- 验证目标提交：`769a04f`
- 基线：`3271c30`
- 环境：Node.js 22.23.2、pnpm 8.6.1、PostgreSQL
- 独立数据库：`sbh_detail_pages_p0`（不含密码）
- 本地端口：`3727`
- 验证日期：2026-07-31（Asia/Shanghai）

## PostgreSQL 迁移

在专用数据库上显式执行 drop/create，随后从零运行：

```text
pnpm exec payload migrate
pnpm seed
SEED_MEDIA_OFFLINE=1 pnpm seed:media
pnpm migrate:dry-run
pnpm migrate:verify
pnpm migrate:status
```

结果：

- fresh replay：24 个迁移全部成功应用，基础数据和离线媒体数据成功写入。
- `migrate:dry-run`：24 个迁移，0 blocking；2 个 warning 均来自历史 location 枚举类型转换。
- `migrate:verify`：109 checks，0 fail，10 warn；warning 为既有手写迁移缺少 schema JSON，另有 1 个已知约束检查 skip。
- `migrate:status`：24 code / 24 applied / 0 pending。
- 详情字段迁移不再删除 unmanaged legacy `listings.status`；fresh replay 后该字段保留。
- 完整原始输出见 [migration-dry-run.txt](./migration-dry-run.txt)。

回滚说明：所有本次生成迁移均具 `down()`；仅在 PostgreSQL 数据副本验证后回滚。涉及 `DROP` 的回滚仍需单独人工批准。本次数据库为专用可丢弃验证库，未操作共享或生产数据库。

## 静态、测试与构建

所有命令均通过 Node 22 / pnpm 8.6.1 wrapper 执行。

| 命令 | 结果 |
|---|---|
| `pnpm exec payload generate:types` | PASS；无生成漂移 |
| `pnpm exec payload generate:importmap` | PASS；无需更新 import map |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS；0 errors、9 warnings |
| `pnpm test` | PASS；126 files、2204 tests |
| `NEXT_PUBLIC_SITE_URL=http://localhost:3727 pnpm build` | PASS；详情、列表、API、sitemap 路由成功构建 |
| 四文件 Playwright 精确矩阵 | PASS；35/35，52.3s |

Playwright 命令：

```text
PORT=3727 PLAYWRIGHT_BASE_URL=http://localhost:3727 pnpm exec playwright test \
  tests/e2e/detail-pages.spec.ts \
  tests/e2e/inquiry-flow.spec.ts \
  tests/e2e/disabled-supply-not-reachable.spec.ts \
  tests/e2e/f7-3-accessibility.spec.ts
```

## 关键业务结果

- 有效房源：详情返回 200，页面、楼盘聚合、列表和 sitemap 使用一致供给。
- 失效房源：`jingan-published-pending-recheck` 返回 404，不进入公开聚合。
- 无供给楼盘：`empty-building` 保留楼盘正文和咨询入口，不显示最低价或空供给 Tab。
- 价格面议：`jingan-price-on-request-300sqm` 首屏及移动 CTA 均显示“价格面议”，不显示零元。
- 跨单位：楼盘可同时展示元/㎡/天、元/工位/月、元/月分组；单元测试确认不跨完整价格 key 聚合或排序。
- 咨询：两步流程真实浏览器提交成功；API 测试覆盖房源瞬时失效后降级为楼盘级或通用需求，且不创建错误房源关系。
- 可访问性：画廊与咨询弹层覆盖焦点锁定、Esc、焦点归还、原生视频控件双向循环、label、live region 和 44px 触控目标。

四档视口、相邻页面和控制台结果见 [browser-matrix.md](./browser-matrix.md)。

## 未验证项与已知风险

- 未采集真实生产流量下的移动 p75 LCP/INP/CLS；本次仅验证功能、构建和布局。
- Playwright 项目当前只配置 Chromium；未执行 Safari/Firefox 或真实移动设备矩阵。
- 媒体使用离线生成图片和内嵌 MP4 fixture；未验证外部 CDN/真实视频编码兼容性。
- lint 剩余 9 个非阻断 warning，主要为现有原生 `<img>` 性能建议及一个 hook dependency 建议。
- `migrate:status` 完整打印正确状态后会保留 Payload 连接句柄；本次在确认 24/24、0 pending 后终止该本地进程，不影响数据库结果。
