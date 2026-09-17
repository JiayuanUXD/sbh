# OPT-102 走查证据（本地 dev，2026-09-17）

环境：主树 `E:\github\sbh`，分支 `refactor/opt-102-buildings-form-two-tabs-d94f`，`next dev -p 3717`，
本地库 `postgres`，夹具账号 `e2e-adm@example.com`，楼盘 id=1（南京西路高端商务中心）。

| 文件 | 内容 |
|---|---|
| `01-buildings-tab-basic-1440.png` / `-375.png` | 「基础信息」tab 整页：五个分节、基本信息 3 列、其余 4 列、group 去框同轴、版本号只读展示态 |
| `02-buildings-tab-display-1440.png` / `-375.png` | 「展示内容」tab 整页：媒体工作台、配套芯片、摘要 / 富文本、SEO 组 |
| `probe.json` | 两 tab × 两断点的 DOM / 计算样式读数（由 `scripts/verification/opt102-buildings-form-shots.ts` 生成，取证前整页滚动触发 RenderIfInViewport） |

未入库为脚本、手工在 Browser pane 完成的两项：
- 保存三步铁证：「推荐排序」0→1 → `PATCH /api/buildings/1?depth=0` 200（请求体含全量字段）→ toast「更新成功」→ 强刷回显 1 / API 回 1 / version 59→60 → 改回 0（version 61）。
- 数据来源分节：手工楼盘不渲染标题与 group；临时 `PATCH dataSource.source=manual-import` 后标题 + 4 列 row 出现；已 PATCH 还原为 null（version 63）。
- 新旧字段集合比对：`SCHEMA_FIELDS_IDENTICAL`（71 = 71，一次性脚本，未入库）。
