# OPT-094 本地走查记录（2026-09-12）

环境：worktree `E:\wt-094`，分支 `feat/opt-094-header-phone-nav-c2e7`，`next dev -p 3726`，本地 PG 已 `payload migrate` 到本迁移。

## 后台

| 操作 | 结果 |
|---|---|
| 站点设置 → 导航 → 顶栏功能，全站客服电话填 `call me` → 保存 | `POST /api/globals/site-settings` **400**；toast「下面的字段是无效的： 导航 > 顶栏功能 > 全站客服电话」；字段红字「只能填数字、+、横线、空格、括号，且至少 7 位数字」 |
| 改填 `400-820-1234` → 保存 | 200，回读 `{memberEntryVisible:false, servicePhoneVisible:true, servicePhone:'400-820-1234'}` |
| 城市站点配置 → 上海 → 基础与状态，本城客服电话填 `021 6888 8888` → 保存 | 200，回读 `servicePhone:'021 6888 8888'` |

迁移后（两处都没配之前）`/shanghai` 顶栏动作区只有汉堡：登录入口已随 `member_entry_visible DEFAULT false` 消失，电话入口未出现。

## 前台

| 路由 / 视口 | 结果 | 证据 |
|---|---|---|
| `/shanghai` 1440 | `<a href="tel:02168888888" class="service-phone" aria-label="拨打客服电话 021 6888 8888">`，图标 + 号码；首屏透明头下为白色，滚动后为 `--ink` | `header-desktop-transparent.png`、`header-desktop-solid.png` |
| `/hangzhou` 1440 | 无本城覆盖 → `tel:4008201234`、`400-820-1234` | `header-desktop-hangzhou.png` |
| `/` | 跟随默认城市（上海）→ `021 6888 8888` | curl |
| `/shanghai` 375 | 顶栏只图标，触控区 44×44，`.service-phone__number` `display:none`，aria-label 仍带号码 | `header-mobile.png` |
| 抽屉 | 第一行「客服电话 021 6888 8888」，`href="tel:02168888888"`，无登录 / 注册区，下接主导航 | `drawer-mobile.png` |
| 开关 | `memberEntryVisible:true, servicePhoneVisible:false` → `/shanghai` 有 `member-login`、无 `service-phone`；改回 → 反之。均即时生效（站点设置 afterChange 失效缓存） | 页内 fetch |

E2E：`PLAYWRIGHT_BASE_URL=http://localhost:3726 playwright test tests/e2e/member-auth.spec.ts -g "顶栏登录入口默认关闭"` → 1 passed。
验证码登录那条需要 `SMS_PROVIDER=fixture` 的服务器，本地未跑，留给 CI。

## 闸门

`typecheck` 干净；`lint` 0 error（34 条既有 warning）；`test` 379 files / 5037 passed；`migrate:dry-run` 本迁移 `up/down/json` 齐全、无禁用模式（4 条 warning 为既有迁移）。
