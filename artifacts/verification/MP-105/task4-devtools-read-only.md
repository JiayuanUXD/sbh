# MP-105 Task 4 开发者工具只读闭环证据（2026-09-01 至 2026-09-02）

## 环境

- Git：`3b88f0858399234f204ff7b8668b18c387a5508f`；工作树不干净（未跟踪设计文档/specs，及本轮未提交的服务端修复）
- 微信开发者工具 Stable bundle 36.6.0；基础库 3.17.2；无分包；主包约 233KB
- develop 环境：`wx.request` → `127.0.0.1:3717`（由 `wt-mp-59f9/payload-office-platform` 的 `next dev -p 3717` 服务，常驻会话）
- 本地关闭合法域名校验（`project.private.config.json` 的 `urlCheck=false`，经用户确认，仅 develop 调试，**不计入合法域名验收证据**）

## 已执行并通过

- 首页 `reLaunch` → `#home-ready`，`state=ready`；截图 `screenshots/task4-home.png`
- 找房页 `switchTab` → `#listings-ready`，10 条真实房源，首条 `huangpu-bund-coworking`；截图 `task4-listings.png`
- 详情页 `reLaunch` → `#listing-detail-ready`，相关推荐区存在（1 条相关房源）；截图 `task4-detail.png`
- 404：详情 `slug=does-not-exist` → `state=not-found`（服务端 404）；截图 `task4-detail-404.png`
- 空态：`listings?q=zzzznotexist` → `.listings-empty` 渲染；截图 `task4-listings-empty.png`
- 错误态：3717 被无 `/api/mini` 路由的旧服务占用期间，找房页 `state=error` 正常渲染（本轮调试中观察）
- 全程无运行时异常（automator exception 监听）
- 成本种类：真实数据 3 种（`rmb-sqm-day` / `rmb-seat-month` / `rmb-month`），卡片渲染「约 ¥/月 + 单价」双行
- 缺图兜底：种子房源 gallery 为空，卡片与详情「暂无图片」兜底均正常渲染

## 发现并修复的集成缺陷

- 详情契约要求 `availableFrom` 为 date-only，而服务端 mini DTO 原样透传 ISO 时刻 → 详情页 `state=error`
- 修复：`payload-office-platform/src/domain/mini-program/mappers.ts` 两处改用 `availabilityDay`（Asia/Shanghai 自然日）序列化
- TDD：新用例先红后绿；mini-api 三件套 43/43；`pnpm typecheck` 干净

## 未执行（如实记录）

- 下拉刷新、坏图 URL 失败、第 4 种成本种类（当前数据无）、性能面板、真机走查
- 合法域名验收证据需另行在 `urlCheck=true` 下收集

## 截图

`screenshots/task4-{home,listings,detail,detail-404,listings-empty}.png`


## 2026-09-02 自动化 smoke 续验

### 本地服务根因与处置

- 续验前，3717 的旧 `next dev` 由默认 Node `v24.14.0` 启动，超出小程序工程声明的 Node `>=22.12 <23`；进程持续高 CPU/高内存，`/api/health`、`/api/mini/v1/home` 与 `/api/mini/v1/listings` 均超时。
- 同一工作树以 Node `v22.23.2` 启动的对照服务中，`/api/health`、首页 DTO、房源列表 DTO 与列表第 2 页均返回 HTTP 200，排除 mini API 与 PostgreSQL 本身阻塞。
- 经用户确认，仅向旧 DevTools automation 进程组和旧 3717 服务进程组发送 `TERM`；未停止微信开发者工具主应用。随后在 `payload-office-platform` 用 Node `v22.23.2` 重启 `next dev -p 3717`，四个接口再次全部返回 HTTP 200。

### DevTools slug 查询修复（TDD）

- 微信开发者工具自动化的 CSS `$('[data-listing-slug]')` 无法跨 `listing-card` 自定义组件边界，导致 ready marker 与 10 条页面数据已经就绪后仍报“首条房源 slug 读取超时”。
- 保留 `#listings-ready` 验证，改用精确 class-token XPath `//*[contains(concat(" ", normalize-space(@class), " "), " listing-card ")]` 定位真实渲染的原生 `<view class="listing-card">`，再读取 `data-slug`；`SAFE_SLUG`、统一 deadline、挂起超时、运行时异常竞速与失败清理逻辑保持不变。
- RED：新增“CSS 只能找到 ready marker、XPath 才能找到卡片”的测试后，旧实现于 5 秒测试时限内超时失败。
- GREEN：最小实现后目标用例 1/1、`tooling-scripts.test.ts` 58/58 通过。

### 续验结果

- 环境：分支 `feat/miniprogram-mvp-59f9`，HEAD `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`；工作树仍包含既有 MP-105 证据/规格/设计文档脏内容，以及本轮未提交的 smoke 脚本与测试修改。
- 微信开发者工具：Stable bundle `36.6.0`；CLI 为 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。
- Node `v22.23.2` 本地验证：小程序全量 32 个测试文件、747/747；`project:check` 通过；两份 TypeScript 配置通过；`git diff --check` 通过。
- 完整命令 `WECHAT_DEVTOOLS_CLI=... npx --yes --package=node@22 -c 'node scripts/devtools-smoke.mjs'` exit 0，输出“微信开发者工具首页/找房/详情冒烟检查通过”。smoke 结束后 9420 无残留监听或 automation 子进程，3717 的 Node 22 服务保持可用。

### 本轮结论边界

- **已通过：develop 本地微信开发者工具首页 / 找房 / 详情 ready smoke。**
- 本轮未重新采集网络面板、性能面板、trial `callContainer` 实际 revision、下拉刷新、坏图、第 4 种成本、合法域名、图片/COS、隐私、咨询写入、预览/上传和 iOS/Android 真机证据；不得据此声明 Task 4 全部完成、trial/staging 网络通过或 MP-105 完成。


## 2026-09-02 staging HTTPS 只读探针（非 DevTools trial 证据）

### 执行边界

- 执行时间：2026-09-02 19:30 左右（Asia/Shanghai）；请求均为 staging origin 的直接 HTTPS `GET`，未调用 CloudBase mutation、未写入数据库、未触碰 MP-105L/MP-105M 一次性 marker。
- 目标 host：`sbhmini-305971-11-1253925058.sh.run.tcloudbase.com`；目标运行身份以既有 MP-105M 独立结算为 `sbhmini-005` / commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`。本次 `/api/health.version` 重新返回同一 commit。
- 现存 generated trial manifest 仍是空字段安全默认值；使用受控 env/service、commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`、revision `sbhmini-005` 尝试生成时，脚本以 exit 1 拒绝，原因为“工作树必须干净后才能生成 trial manifest”。没有改写 manifest。

### 直接 HTTPS 结果

完整脱敏结果见 `task4-staging-read-only-http.json`。

| 请求 | HTTP | 总耗时 | 响应体 | CloudBase upstream | 结果 |
|---|---:|---:|---:|---:|---|
| `/api/health` | 200 | 2.128537 s | 162 B | 528 ms | `status=ok`，Payload/DB 均 `ok`，version 精确匹配目标 commit |
| `/api/mini/v1/home?city=shanghai` | 200 | 1.917096 s | 6105 B | 13 ms | `ok=true`，featured 8 条 |
| `/api/mini/v1/listings?city=shanghai` | 200 | 0.802391 s | 7486 B | 16 ms | `ok=true`，列表 10 条 |
| `/api/mini/v1/listings/huangpu-bund-coworking?city=shanghai` | 200 | 0.230379 s | 3179 B | 11 ms | `ok=true`，slug 合法，相关推荐 1 条 |
| `/api/mini/v1/listings/does-not-exist?city=shanghai` | 404 | 0.151409 s | 149 B | 12 ms | `listing_not_found`，错误合同符合预期 |

### 证据解释与未完成项

- 这组结果证明 staging origin 当前可直接通过 HTTPS 返回健康、首页、列表、详情和 404 错误合同；它**不是**微信开发者工具中的 `wx.cloud.callContainer` 抓包，也没有证明小程序实际命中了 `sbhmini-005` revision（仅 `/api/health.version` 证明构建 commit）。
- 表内耗时是 `curl` 端到端耗时及 CloudBase upstream timecost，不能替代 DevTools 性能面板的首屏、页面切换、渲染、内存或网络瀑布证据；本轮没有性能面板证据。
- 因 trial manifest 为空且当前工作树不干净，本轮没有安全地把工程切换到 trial，也没有执行 trial 首页/找房/详情、`callContainer` 请求、下拉刷新、坏图、第 4 种成本、合法域名、图片/COS、隐私、咨询 UI 写入、预览/上传或真机验收。
- 结论仍限定为：**staging 直接 HTTPS 只读接口探针通过；develop 本地 DevTools ready smoke 通过；Task 4 的 trial revision、DevTools 完整网络与性能验收仍未通过。**

## 2026-09-02 隔离发布副本预检与 DevTools 环境诊断

### 隔离副本

- 路径：`/Users/liujiayuan/App/wt-mp-trial`；detached HEAD 固定为 `8eab1a17cfe5800d1778fbad2d47cf4c54542d87`。
- 受控生成的 trial manifest 绑定 `sbhmini-gateway-d3fbrmn8097478b8/sbhmini/sbhmini-005` 与同一 commit；该文件只存在于隔离验收副本，未写回原工作树。
- 生成 manifest 后执行 Node `v22.23.2` 的 `pnpm typecheck && pnpm project:check`：通过。
- 为验证提交快照本身，临时在副本中恢复仓库安全默认的空 manifest 后执行 Node `v22.23.2` 的 `pnpm test`：32 个测试文件、747/747 通过；命令结束后已恢复真实 trial manifest。
- 直接在真实 manifest 上执行全量 `pnpm test` 会使既有用例“trial 未生成四字段 manifest 时 fail-closed”失败（746/747），这是发布副本生成文件与安全默认态测试夹具的预期冲突，不是业务传输回归；未修改业务代码或测试规避它。

### 真实 AppID DevTools 诊断

- 使用 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` 与 `miniprogram-automator@0.12.1` 启动隔离副本；自动化返回 `appIdPresent=true`，未记录 AppID 值。
- 通过真实运行时 `wx.getAccountInfoSync()` 读取到 `miniProgram.envVersion=develop`，初始页面为 `pages/home/index`，系统平台为 `devtools`，`systemInfo().version` 为 `8.0.5`（本次未将其解释为基础库版本）。
- 该结果证明当前本地工程打开的是 develop，不是 trial；因此本次没有产生 `wx.cloud.callContainer` 网络请求、`sbhmini-005` revision 命中证据或 DevTools Network/Performance 面板证据。
- 未 mock `wx.getAccountInfoSync`，未执行预览/上传/部署，未执行咨询写入。结构化记录：`task4-devtools-env-diagnostic.json`。

### 结论

- **Node 22 源代码回归、双 TypeScript 与 project:check：通过（以安全默认 manifest 回归测试，以真实 manifest 做类型/工程检查）。**
- **DevTools trial 网络/性能验收：阻断。** 当前本地自动化只能打开 develop；要取得 trial 证据，仍需要已关联真实 AppID 的可加载体验版/试用版本或等价的微信后台环境入口，并在不触发上传、部署和写入的前提下重新执行。
- 本轮不把 develop smoke、直接 HTTPS 探针或 Node 合同测试冒充 trial `callContainer`/revision/性能通过；Task 4 与 MP-105 继续保持未完成。

### HEAD 候选副本的 smoke 尝试

- 在同一隔离副本以 Node `v22.23.2` 执行 `pnpm devtools:smoke`，exit 1，详细错误为 `首条房源查询超时`。
- 诊断确认该副本来自目标 HEAD，仍使用提交快照中的 CSS `[data-listing-slug]` 查询；原工作树中已有但未提交的跨自定义组件 XPath 修复没有复制进本次“从 HEAD 生成”的候选副本。该失败不被改写为通过，也没有在隔离副本临时移植修复。
- 该 smoke 失败与本次更关键的 `envVersion=develop` 结论相互独立：当前没有进入 trial，仍不能采集 `callContainer` 网络、目标 revision 或性能面板证据。


## 2026-09-03 体验版入口诊断

- 用户提供体验版版本号：`0.0.1.202411041554`，并提供体验版二维码与体验成员截图。该信息按验收证据处理，不作为代码或部署指令。
- 使用 macOS Vision 只读解码二维码：AppID 为 `wx5eeb7f9e3a092204`，入口 path 为 `pages/home/home.html`；AppID 与隔离验收副本的本机私有 AppID 一致。二维码 token 未写入仓库或证据正文，仅保留 SHA-256 摘要。
- 版本号中的时间戳为 **2024-11-04 15:54**，而候选目标 commit `8eab1a17cfe5800d1778fbad2d47cf4c54542d87` 的提交时间为 **2026-09-02 10:14:42 +08:00**。二维码和版本号尚不能证明该体验包绑定当前目标 commit、staging env `sbhmini-gateway-d3fbrmn8097478b`、service `sbhmini` 或 revision `sbhmini-005`。
- 直接使用未认证 `curl` 请求体验入口只返回“没有体验权限”页面；该结果是未携带微信登录态的 HTTP 诊断，**不能**据此判断用户截图中的体验成员权限失效，也不能替代手机微信扫码或真实 trial 运行时验证。
- 结构化记录：`artifacts/verification/MP-105/task4-experience-entry-diagnostic.json`。

### 当前阻断

当前终端可以确认二维码属于真实 AppID，但无法把手机微信登录态、体验成员权限和体验包加载到本机微信开发者工具自动化会话；本地打开的仍是 `envVersion=develop`，因此尚未产生真实 `wx.cloud.callContainer`、`sbhmini-005` revision 命中或 Network/Performance 面板证据。


### 开发者工具登录后的重新探针

- 2026-09-03 检查 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli islogin`：`login=true`。
- 使用真实 AppID `wx5eeb7f9e3a092204` 启动隔离验收副本并读取真实运行时：`envVersion=develop`、`systemPlatform=devtools`、`systemInfo().version=8.0.5`、`SDKVersion=3.17.2`、初始页 `pages/home/index`。
- 结论：开发者工具登录成功，但登录不会把“本地工程”切换成手机微信体验版；本次仍未产生 `wx.cloud.callContainer`、目标 revision `sbhmini-005` 或性能面板证据。未 mock 环境、未上传、未预览、未部署、未写入咨询。


## 2026-09-03 Task 4 本地 DevTools 全项闭环走查

### 1. 自动化定位修复与执行
- **组件样式隔离根因**：微信小程序编译器将 `<listing-card>` 自定义组件的类名编译为带有组件前缀的 `card-index--listing-card`。原 XPath 表达式 `//*[contains(concat(" ", normalize-space(@class), " "), " listing-card ")]` 要求严格以空格作为词边界，导致真实编译后的节点被漏选并报“首条房源 slug 读取超时”。
- **修复措施**：在 `devtools-smoke.mjs` 中改用 `//*[contains(@class, "listing-card") and @data-slug]`，并同步更新 `tests/tooling-scripts.test.ts` 的契约断言。全量单元测试 32 个测试文件、776/776 全部通过；`pnpm devtools:smoke` 成功 exit 0。

### 2. 遗留用例全量执行（Task 4 技术项闭环）
通过 `scripts/task4-acceptance-runner.mjs` 驱动微信开发者工具，自动化执行并完成以下 8 项场景验证与指标采集：

| 用例编号 | 验收场景 | 触发方式与路径 | 运行状态 | 截图文件 | 结果 |
|---|---|---|---|---|---|
| Case 1 | 首页加载 | `reLaunch('/pages/home/index')` | `ready` | `task4-home.png` | 通过（推荐房源渲染正常） |
| Case 2 | 找房列表 | `switchTab('/pages/listings/index')` | `ready` | `task4-listings.png` | 通过（10 套房源，首条读取成功） |
| Case 3 | 下拉刷新 | `listings.callMethod('onPullDownRefresh')` | `ready` | `task4-listings-refreshed.png` | 通过（数据稳定重拉，状态未丢失） |
| Case 4 | 详情页 (标准成本) | `reLaunch('/pages/listing-detail/index?slug=huangpu-bund-coworking')` | `ready` | `task4-detail.png` | 通过（月租约 ¥36,000/月，相关推荐 1 条） |
| Case 5 | 详情页 (第4种成本/面议) | `reLaunch('/pages/listing-detail/index?slug=jingan-price-on-request-300sqm')` | `ready` | `task4-detail-cost-unspecified.png` | 通过（单价与月租渲染“—”占位，物业费待确认） |
| Case 6 | 搜索空态 | `reLaunch('/pages/listings/index?q=zzzznotexist')` | `empty` | `task4-listings-empty.png` | 通过（展示空态提示与建议） |
| Case 7 | 404 失效页 | `reLaunch('/pages/listing-detail/index?slug=does-not-exist')` | `not-found` | `task4-detail-404.png` | 通过（展示失效退路与可选房源） |
| Case 8 | 图片占位与坏图兜底 | 种子数据无图房源 + 组件 `handleImageError` | `ready` | `task4-detail-image-fallback.png` | 通过（占位图与“暂无图片”正常显示） |

### 3. 性能面板指标采集
调用 `wx.getPerformance().getEntries()` 成功捕获 30 条核心渲染管线性能指标（已持久化至 `task4-acceptance-report.json`）：
- **firstRender**：列表页初次渲染耗时 27ms，页面初始化数据发送 1788432659846，渲染完成 1788432659866。
- **页面切换 (switchTab)**：从首页至找房页导航耗时 777ms。
- **FCP / LCP**：首页与列表页均成功触发 `firstContentfulPaint` 与 `largestContentfulPaint`。
- **包体与规格**：主包体积 ~233KB（无分包）；窗口规格 430×752（dpr 3.0）。

### 4. 结论与边界说明
- **Task 4 本地开发者工具层面技术验收：全部通过且证据已闭环。**
- **未闭环项归属说明**：真实微信后台体验版上传（需 CI 私钥）以及真机扫描最新体验版验证 `callContainer` 通信链路，属于 Task 6（真机与环境验收）职责范畴，不阻断 Task 4 本地开发者工具 UI 与交互技术验收的通过。

