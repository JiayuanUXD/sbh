# Task Packet：OPT-089 会员微信扫码登录与绑定

> 状态：**待实施（依赖 OPT-088 合入）**
> 创建日期：2026-09-10
> 母文档：`OPT-088-member-system-design.md` §6.6、§8.3（`/login` 微信按钮、`/login/bind-phone`、`/account` 绑定与解绑）、§11 微信变量、§12.1 `member-wechat-oauth.test.ts`、§13.2、§14
> 分支：`feat/opt-089-member-wechat-<hex>`
> 实施代理读取顺序：同 OPT-088，再加本包

---

## 1. 一句话

外部用户可用微信扫码登录网站；首次扫码必须经短信验证绑定手机号；已登录会员可在账户中心绑定或解绑微信。整个能力受 `WECHAT_LOGIN_ENABLED` 开关控制，默认关闭。

## 2. 范围

- `src/domain/member/wechat-oauth.ts`：授权 URL、state 与 pending 两个签名 cookie 的编解码、`code` 换 token、`userinfo`，网络调用经注入的 `fetch`。
- 路由：`GET /api/member/wechat/start`、`GET /api/member/wechat/callback`、`POST /api/member/wechat/bind`、`POST /api/member/wechat/unbind`。
- 页面：`/login` 的「微信扫码登录」按钮（服务端按开关决定是否渲染）；`/login/bind-phone`；`/account` 的绑定 / 解绑区块与状态展示。
- `config-guard`：开关为 true 时 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 必填。
- `.env.example` 三个变量。
- 单测 `tests/member-wechat-oauth.test.ts`、路由测试补微信分支；`member-access.test.ts` 补 unionid 唯一冲突。

## 3. 非目标

微信公众号网页授权（`snsapi_userinfo`）、小程序登录、微信头像展示、用微信换绑手机号。

## 4. 迁移

无。`wechatUnionId` / `wechatOpenId` / `wechatBoundAt` 三列与唯一索引已在 OPT-088 的 `opt_088_members` 建好。

## 5. 验收标准

- [ ] 开关缺省或 `false`：`/login` 无微信按钮；三个端点 404 `WECHAT_DISABLED`；`/login/bind-phone` 302 `/login`。
- [ ] 开关 `true` 但缺 AppID / Secret：生产启动被 `assertProductionConfig` 拒绝，非生产启动 warn 且端点 503。
- [ ] `start`：`returnTo=/x` 写入签名 cookie 并 302 到微信授权 URL，URL 的 `redirect_uri` 为站点 origin + `/api/member/wechat/callback`；`returnTo=//evil` 与 `returnTo=https://evil` 回落 `/account`。
- [ ] `callback`：state 不匹配、cookie 缺失、签名被改 → 302 `/login?error=wechat_state`，不发会话；mock 微信返回错误 → 302 `/login?error=wechat_exchange`。
- [ ] 首次扫码（mock 返回新 unionid）→ 302 `/login/bind-phone` → 用 fixture 码绑定 → 会员创建、`wechatUnionId` 写入、cookie 落下、302 回 `returnTo`。
- [ ] 二次扫码同 unionid → 直接登录，不进绑定页。
- [ ] mock 无 unionid 只有 openid → 以 openid 作身份键，流程同上。
- [ ] 该 unionid 已绑另一会员时 bind 返回 409 `WECHAT_ALREADY_BOUND`。
- [ ] 已登录会员在 `/account` 点绑定 → 走 start（`returnTo=/account`）→ callback 直接绑定到当前会员，不进绑定页；解绑后三字段清空、`wechatBound=false`。
- [ ] 单测覆盖率：`wechat-oauth.ts` 分支全覆盖；快照断言会员 DTO 不含 unionid / openid。
- [ ] 合入并在控制台配好 `WECHAT_LOGIN_ENABLED=true` 与凭据后，用户真机扫码走通，截图与 `wechatBoundAt` 记录进 `artifacts/verification/OPT-089/`。

## 6. 风险与注意

- 微信回调域名必须与开放平台配置一致，本地无法收到真实回调；本地与 E2E 只用 mock。
- `sbh-wx-pending` 里的 identityKey 是敏感数据，cookie 必须 HttpOnly、10 分钟、绑定成功或失败都立即清除。
- 不要把 AppSecret 传到任何客户端代码或 `NEXT_PUBLIC_*`。
- `access_token` 不落库、不落日志。

## 7. 证据目录

`artifacts/verification/OPT-089/`：mock 流程的路由测试输出、浏览器走查截图、真机扫码验收记录。
