# OPT-088 验证证据清单与验收总结

本目录存放 OPT-088「会员基座 + 短信 / 密码登录 + 前台登录入口 + 收藏同步」的全部技术与浏览器验收证据。

---

## 1. 迁移与数据结构证据

- **`migrate-dry-run.txt`**：Task 3 生成的两条迁移文件的 `pnpm migrate:dry-run` 执行输出：
  - `20260911_073600_opt_088_members.ts`：创建 `members`、`members_sessions`、`member_sms_codes`、`member_favorites` 表及唯一索引。
  - `20260911_073601_opt_088_grant_ops_member_codes.ts`：为 OPS 角色增量授予 `members` 菜单码与 `member:manage` 操作码。
- **`pg-structure.txt`**：本地 PostgreSQL（`sbh_dev_opt088`）上执行 `\d members`、`\d member_sms_codes`、`\d member_favorites`、`\d members_sessions` 的 DDL 与索引输出。

---

## 2. 闸门与自动化测试证据

- **`gates.txt`**：Task 12 综合闸门执行摘要：
  - `pnpm generate:types && pnpm payload generate:importmap`（`importMap.js` 无漂移）
  - `pnpm typecheck`：0 errors
  - `pnpm lint`：0 errors
  - `pnpm test`：372 个测试文件全部通过（4942 个用例通过，0 个失败）
  - `pnpm migrate:dry-run`：通过
  - `pnpm build`：Next.js 生产构建通过
- **`e2e-member-auth.txt`**：Playwright E2E 自动化测试套件 `tests/e2e/member-auth.spec.ts` 完整执行证据（15/15 passed）。

---

## 3. 浏览器多断点走查截图（`screens/`，共 37 张）

依据《OPT-088 会员体系总设计》§12.3 规范，在 4 种视口断点（移动端 `375x812`、平板端 `768x1024`、桌面端 `1440x900`、超宽屏 `1920x1080`）下采集的实测渲染截图：

| 序号 | 截图文件名 | 场景与说明 |
|:---:|---|---|
| 01 | `01-home-unlogged-{375,768,1440,1920}.png` | 未登录态前台首页：顶栏右侧展示「登录」按钮，各断点布局自适应无变形 |
| 02 | `02-drawer-unlogged-{375,768}.png` | 未登录态移动端/平板抽屉：抽屉内包含登录入口与主要导航项 |
| 03 | `03-login-sms-tab-{375,768,1440,1920}.png` | 登录页短信验证码登录 Tab：手机号、验证码、协议勾选框与「员工入口」引导 |
| 04 | `04-login-password-tab-{375,768,1440,1920}.png` | 登录页密码登录 Tab：账号密码输入框、「忘记密码」跳转链接 |
| 05 | `05-login-reset-{375,768,1440,1920}.png` | 重置密码页（`/login/reset`）：手机号、验证码、新密码输入框及安全提示 |
| 06 | `06-home-logged-{375,768,1440,1920}.png` | 登录态前台首页：顶栏展示会员头像及昵称/脱敏手机号下拉菜单 |
| 07 | `07-drawer-logged-{375,768}.png` | 登录态移动端/平板抽屉：包含会员状态、个人中心、我的收藏与退出入口 |
| 08 | `08-account-{375,768,1440,1920}.png` | 会员账号设置中心（`/account`）：个人资料、密码管理等面板 |
| 09 | `09-account-favorites-{375,768,1440,1920}.png` | 会员收藏中心（`/account/favorites`）：跨设备收藏列表与移除操作 |
| 10 | `10-admin-members-list-light.png` | Payload 后台会员列表页（浅色主题）：ADM 视图，展示手机号、状态、创建时间等 |
| 11 | `11-admin-members-list-dark.png` | Payload 后台会员列表页（深色主题）：ADM 视图 |
| 12 | `12-admin-member-detail.png` | Payload 后台会员详情页（ADM 视图）：会员详细信息面板 |
| 13 | `13-admin-members-ops-masked.png` | OPS 员工视图会员列表：手机号正确展示为脱敏格式（`138****9999`） |
| 14 | `14-admin-members-brk-denied.png` | BRK 角色越权直接访问 `/admin/collections/members` 得到 403 / 404 无权限拒绝页面 |

---

## 4. 三重铁证与网络请求抓包（`payloads/`，共 3 份）

实测抓取的完整 HTTP 请求报文、响应状态码与响应体：

- **`01-login-sms.json`**（三重铁证之一）：
  - 端点：`POST /api/member/login/sms`
  - 载荷：`{ "phone": "13800008888", "code": "123456", "consent": { "accepted": true, "policyVersion": "MVP-R2" } }`
  - 响应：`200 OK`，带安全 Cookie `Set-Cookie: sbh-member-token=...; Path=/; HttpOnly; SameSite=Lax`。
- **`02-set-password.json`**（三重铁证之二）：
  - 端点：`POST /api/member/password`
  - 载荷：`{ "phone": "13800009999", "code": "123456", "newPassword": "Member1234!" }`
  - 响应：`200 OK`，密码成功重置。
- **`03-login-password.json`**（三重铁证之三）：
  - 端点：`POST /api/member/login/password`
  - 载荷：`{ "phone": "13800009999", "password": "Member1234!" }`
  - 响应：`200 OK`，凭新密码成功登录。

---

## 5. 随附取证脚本

- **`verify-browser-opt088.spec.ts`**：可在本工程下通过 Playwright 独立重现并生成上述 37 张截图与 3 份 JSON 载荷的自动化取证脚本。
  - 运行方法：
    ```bash
    cd payload-office-platform
    npx playwright test ../artifacts/verification/OPT-088/verify-browser-opt088.spec.ts
    ```

