# Task Packet：OPT-094 顶栏登录入口改开关、新增客服电话（按城市）

> 状态：**已实施，待合并**
> 创建日期：2026-09-12
> 来源：用户要求首页顶部导航去掉登录入口、增加客服电话入口，支持后台配置、不同城市不同号码

---

## 1. 一句话

顶栏右侧动作区的「登录 / 会员」入口改由「站点设置 → 导航」里的开关控制（本次默认关），
同处新增「客服电话」入口：全站默认号 + 各城市可覆盖，桌面端「图标 + 号码」、移动端图标、抽屉里平铺一行，点击拨号。

## 2. 设计裁定（2026-09-12 与用户确认）

| 问题 | 裁定 |
|---|---|
| 登录入口怎么「去掉」 | 不硬删，做成开关。关掉后桌面「登录」按钮、已登录头像菜单、抽屉「登录 / 注册」一起不渲染；`/login`、`/account` 与接口原样保留 |
| 城市没配号码 | 全站默认号 + 城市覆盖；两处都空不显示入口 |
| 展示形态 | 桌面：电话图标 + 号码文本，`tel:` 链接；移动顶栏：只放图标；抽屉：平铺一行「客服电话 400-xxx-xxxx」 |
| 平台入口 `/`、未开城页 | 顶栏在 `/` 上本就按默认城市渲染（城市切换器、logo 链接同此），号码跟随同一口径：默认城市有覆盖用覆盖，否则全站默认；未开城页没配覆盖就是全站默认 |

## 3. 做法

| 层 | 改动 |
|---|---|
| `src/globals/SiteSettings.ts` 导航 tab | 新增「顶栏功能」区：`memberEntryVisible`（checkbox，默认 **false**）、`servicePhoneVisible`（checkbox，默认 true）、`servicePhone`（text，宽松校验） |
| `src/collections/CitySiteProfiles.ts` 基础与状态 tab | `servicePhone`（text，同校验），留空用全站默认 |
| 迁移 | `site_settings` 加 3 列，`city_site_profiles` 加 1 列 |
| `src/lib/frontend/service-phone.ts`（新） | 纯函数：`normalizeServicePhone(raw) → { display, href } \| null`（`tel:` 去掉分隔符）、`isValidServicePhone` |
| `src/lib/frontend/site-settings(-view).ts` | `SiteSettingsView` 加 `memberEntryVisible`（`=== true`，NULL 视为关）、`servicePhone`（`servicePhoneVisible !== false` 且号码合法才非 null） |
| `src/domain/city-site-profile/public-contract.ts` + `city-context.ts` | `PublicCitySiteProfile` / `PublicCityOption` 加 `servicePhone: string \| null` |
| `SiteHeader` / `SiteNav` | `brand` 加 `memberEntryVisible`、`servicePhone`；号码取值 = 当前城市覆盖 → 全站默认；`MemberMenu` 三处渲染受开关控制；新增 `ServicePhoneLink`（desktop / compact / drawer 三种形态） |
| 样式 | `styles/member.css` 末尾新增 `.service-phone*`；断点跟顶栏自己的 1024（`.member-menu-slot` / `.site-menu-toggle` 同此）：≥1024 图标 + 号码，之下只图标；透明头下变白 |

空值语义：登录开关 NULL（迁移后存量行）= 关，正好是本次要的效果，不需要运营操作；电话开关 NULL = 开。

## 4. 验收

- [x] 单测：`normalizeServicePhone`（`tests/service-phone.test.ts`）
- [x] 单测：开关空值语义与取值顺序（`tests/header-features.test.ts`）；`PublicCityOption.servicePhone` 映射（`city-context-resolver.test.ts` 期望值更新）
- [x] 单测：SiteHeader 在（开关 × 号码）组合下的渲染（`tests/site-header-features.test.ts`）；水合测试改为默认无 `member-login`
- [x] E2E：`member-auth.spec.ts` 验顶栏账号菜单前先打开开关、结束后关回；新增「默认关、打开后出现」用例（本地单跑通过）
- [x] 后台：站点设置填 `call me` → 400 + 字段红字「只能填数字、+、横线、空格、括号，且至少 7 位数字」；填 `400-820-1234` 保存成功；城市站点配置填 `021 6888 8888` 保存成功
- [x] 本地浏览器：`/shanghai` 顶栏 `tel:02168888888`、`/hangzhou` 回落 `tel:4008201234`；375 宽只图标（44px 触控区，aria-label 带号码）；抽屉第一行「客服电话 021 6888 8888」；开关切换立即生效（登录入口出现 / 电话消失）
- [x] `typecheck` 干净 / `lint` 0 error / `test` 5037 passed / `migrate:dry-run` 本迁移无禁用模式

证据：`artifacts/verification/OPT-094/`。

## 5. 不在本项内

服务时间文案、微信 / 在线客服入口。
