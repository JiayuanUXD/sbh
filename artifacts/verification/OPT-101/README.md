# OPT-101 走查证据（本地 dev，2026-09-17）

环境：主树 `E:\github\sbh`，分支 `fix/opt-101-recruit-form-copy-spacing-119f`，`next dev -p 3717`，
本地库 `postgres`（87 份迁移全部已跑），`MULTI_CITY_ROUTING_ENABLED=true`。

| 文件 | 内容 |
|---|---|
| `00-hangzhou-hero-1440.png` / `-375.png` | Hero 段：min-height 480（≤767 为 400），文案垂直居中 |
| `01-hangzhou-form-1440.png` / `-375.png` | 城市路由表单卡：只剩「第一步 · 必填 / 请留下联系信息」+ 姓名 / 手机号 / 合作身份 / 隐私勾选；无「申请城市」、无引导句、卡下无合规声明 |
| `02-hangzhou-band-to-cta-1440.png` / `-375.png` | 灰底带 → 白底 72px → 「登记找房需求」灰卡（改前白底为 0，灰卡贴灰带） |
| `03-city-partner-form-1440.png` | `/city-partner` 表单卡：「申请城市」选择器保留（唯一城市入口） |
| `probe.json` | 两页 × 两断点的 DOM / 计算样式读数（由 `scripts/verification/opt101-recruit-shots.ts` 生成） |

真实提交（未入库为脚本，手工在 Browser pane 完成）：`/hangzhou` 填「OPT101走查 / 13900001101 / 本地运营团队 / 勾选」
→ `POST /api/city-partner-applications` 201 `{"ok":true,"idempotent":false}` → 进第二步；
psql 核对 `city_partner_applications` id=54 `city_slug=hangzhou` `status=pending`，核对后已 `DELETE`（remaining 0）。
