# MP-102 原生小程序工程基础实施计划

> **供 agent 执行：**按任务逐项使用 TDD；可使用 subagent-driven-development 或 executing-plans，但不得跳过 RED/GREEN 证据。

**目标：**建立可由微信开发者工具打开的独立原生 TypeScript 小程序工程，并交付环境校验、Mini API 请求层、设计 token、基础状态组件和微信自动化脚本。

**架构：**`sbh-miniprogram/` 与 `payload-office-platform/` 并列，拥有独立 `package.json` 和锁文件，不建立根级 workspace。小程序只通过 `/api/mini/v1/*` 使用 MP-101 响应契约；纯逻辑在 Vitest 验证，组件在 `miniprogram-simulate` + jsdom 验证，微信运行时通过开发者工具自动化脚本验收。

**技术栈：**原生微信小程序、TypeScript 5.9、Node `>=22.12 <23`、pnpm 8.6.1、Vitest、miniprogram-simulate、miniprogram-automator、miniprogram-ci。

## 全局约束

- 页面视觉唯一事实源为 `docs/SBH小程序页面设计/uploads/miniprogram-design.md` 和 `docs/SBH小程序页面设计/SBH 小程序页面.dc.html`；本任务不重做页面设计。
- 工程运行时固定为 Node `>=22.12 <23`；jsdom/Vite 要求最低 Node 22.12。
- 页面底色 `#f2f2f4`；白卡圆角 8px、左右 12px、块间 10px、内边距 14px；图片/输入/卡内按钮圆角 6px；标签圆角 3px。
- 文本色使用 `#1d1d1f`、`#6e6e73`、`#86868b`；分隔线 `#e5e5e7`；交互强调色 `#0071e3`。价格使用主文字色，标签不得引入彩色色相。
- 所有基础组件触控高度不小于 44px；禁用、加载、错误状态不能只靠颜色表达。
- 中文使用系统字体；数字使用 `.num` 与 `font-variant-numeric: tabular-nums`。Geist 子集的真实字体文件不在 MP-102 引入，避免在尚无资产来源时伪造文件。
- 开发环境允许 `http://127.0.0.1` 或 `http://localhost`；trial/release API 基址必须为 HTTPS。当前只读阶段 trial/release 指向既有生产 Mini API；在 MP-104 引入写接口前必须建立独立预发布域名。
- GET 仅对网络失败、超时或 HTTP 5xx 自动重试一次；POST/PUT/DELETE 不自动重试；4xx 和业务错误不重试。
- 业务分支只依赖稳定错误码，不依赖后端中文消息。每个异常尽可能保留 `requestId`。
- 不实现业务首页、列表、详情、登录、咨询写入、地图、收藏或正式上传；不提交 AppSecret、上传私钥、数据库配置或 `project.private.config.json`。
- 未经用户另行确认，不提交、推送、创建 PR、部署或调用 `miniprogram-ci` 上传/预览。

---

### Task 1：工程入口与配置合同

**文件：**

- 新建：`sbh-miniprogram/package.json`
- 新建：`sbh-miniprogram/pnpm-lock.yaml`
- 新建：`sbh-miniprogram/tsconfig.json`
- 新建：`sbh-miniprogram/vitest.config.ts`
- 新建：`sbh-miniprogram/project.config.json`
- 新建：`sbh-miniprogram/.gitignore`
- 新建：`sbh-miniprogram/miniprogram/app.ts`
- 新建：`sbh-miniprogram/miniprogram/app.json`
- 新建：`sbh-miniprogram/miniprogram/app.wxss`
- 新建：`sbh-miniprogram/miniprogram/sitemap.json`
- 新建：`sbh-miniprogram/miniprogram/pages/foundation/index.{ts,json,wxml,wxss}`
- 测试：`sbh-miniprogram/tests/project-contract.test.ts`

**产出接口：**微信开发者工具从仓库根的 `sbh-miniprogram/project.config.json` 打开 `miniprogram/`；首个路由固定为 `pages/foundation/index`。

- [ ] 先写失败测试，读取 JSON 并断言：`miniprogramRoot === 'miniprogram/'`、`compileType === 'miniprogram'`、`appid === 'touristappid'`、`setting.useCompilerPlugins` 含 `typescript`、`app.json` 第一页是 foundation、私有配置和私钥模式均被忽略。
- [ ] 用 Node 22 运行 `pnpm vitest run tests/project-contract.test.ts`，确认因文件不存在而 RED。
- [ ] 新建最小工程配置。`package.json` 固定 `engines.node='>=22.12 <23'`、`packageManager='pnpm@8.6.1'`；`project.config.json` 启用 TypeScript 编译插件、ES6、postcss、压缩、sitemap 校验和 `urlCheck`。
- [ ] foundation 页只显示“工程基础已就绪”和环境状态，不实现业务首页。
- [ ] 安装锁定依赖并生成独立锁文件：`typescript@5.9.3`、`vitest@4.1.11`、`jsdom`、`miniprogram-api-typings@5.2.3`、`miniprogram-simulate@1.6.2`、`miniprogram-automator@0.12.1`、`miniprogram-ci@2.1.31`。
- [ ] 重跑定向测试与 `pnpm typecheck`，确认 GREEN。

### Task 2：环境选择与合法基址校验

**文件：**

- 新建：`sbh-miniprogram/miniprogram/config/environment.ts`
- 测试：`sbh-miniprogram/tests/environment.test.ts`

**接口：**

```ts
export type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'
export type RuntimeStage = 'development' | 'staging' | 'production'
export interface RuntimeEnvironment { stage: RuntimeStage; apiBaseUrl: string }
export function assertApiBaseUrl(value: string, allowLocalhost: boolean): string
export function resolveRuntimeEnvironment(envVersion: MiniProgramEnvVersion): RuntimeEnvironment
export function getCurrentRuntimeEnvironment(): RuntimeEnvironment
```

- [ ] 先写失败测试覆盖：develop → development、trial → staging、release → production；生产/预发布拒绝 HTTP、凭据型 URL、query/hash 与非根路径；开发仅允许 HTTP localhost/127.0.0.1 或 HTTPS。
- [ ] 运行定向测试，确认因模块不存在而 RED。
- [ ] 实现纯函数映射；`getCurrentRuntimeEnvironment()` 只负责读取 `wx.getAccountInfoSync().miniProgram.envVersion` 并调用纯函数。
- [ ] 使用去尾斜杠后的规范 origin，禁止字符串拼接产生双斜杠。
- [ ] 重跑定向测试和类型检查，确认 GREEN。

### Task 3：Mini API 请求层与错误模型

**文件：**

- 新建：`sbh-miniprogram/miniprogram/services/mini-api-contracts.ts`
- 新建：`sbh-miniprogram/miniprogram/services/mini-api-error.ts`
- 新建：`sbh-miniprogram/miniprogram/services/request.ts`
- 测试：`sbh-miniprogram/tests/request.test.ts`

**接口：**

```ts
export interface MiniApiMeta { requestId: string; asOf: string; maxAgeSeconds: 300 }
export type MiniApiSuccess<T> = { ok: true; data: T; meta: MiniApiMeta }
export type MiniApiFailure = { ok: false; error: { code: string; message: string; fields?: string[] }; meta: { requestId: string } }
export type JSONValue = string | number | boolean | null | JSONObject | readonly JSONValue[]
export type JSONObject = Readonly<{ [key: string]: JSONValue }>
export type RequestData = string | JSONObject | ArrayBuffer
export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export interface RequestOptions<T> { path: `/api/mini/v1/${string}`; method?: RequestMethod; data?: RequestData; timeoutMs?: number; parse: (value: unknown) => T | PromiseLike<T> }
export class MiniApiError extends Error { code: string; kind: 'network' | 'timeout' | 'http' | 'business' | 'protocol'; statusCode: number | null; requestId: string | null; retryable: boolean }
export function createRequestClient(dependencies: RequestDependencies): <T>(options: RequestOptions<T>) => Promise<T>
export const request: <T>(options: RequestOptions<T>) => Promise<T>
```

- [ ] 先写失败测试：200 success 必须经端点 parser；同步抛错或异步 reject 都收口为 protocol error；envelope 的 requestId/asOf/TTL/code/message 严格校验；503 failure 保留 code/requestId 且 GET 重试；非法 method/timeout/data/path/status 在运输前拒绝；header 大小写不敏感；GET 网络/超时/5xx 最多两次；GET 4xx/业务错误和 POST/PUT/DELETE 仅一次。
- [ ] 运行定向测试并确认因模块不存在而 RED。
- [ ] 以注入 transport 的方式实现核心逻辑，单元测试不伪造全局 `wx`；默认 transport 再薄封装 `wx.request`。
- [ ] method 和 timeout 仅在值为 `undefined` 时分别默认为 GET 和 10 秒；method 运行时仅允许 GET/POST/PUT/DELETE，显式超时必须为正的有限安全整数；请求 data 仅允许字符串、JSON 对象或 `ArrayBuffer`，并作不触发 getter 的运行时递归校验；请求头加入 `Accept: application/json`。
- [ ] 响应 request ID 优先取符合安全字符规则的 body meta，缺失时大小写不敏感地读取 `X-Request-Id`；原始 `#`、越界/编码 traversal 与 100..599 之外的状态码按协议错误处理。
- [ ] 错误用户文案由稳定 kind/code 映射，不透传未知服务器堆栈或 HTML 正文。
- [ ] 重跑定向测试、类型检查和已有小程序测试，确认 GREEN。

### Task 4：三层设计 token 与基础状态组件

**文件：**

- 新建：`sbh-miniprogram/miniprogram/styles/tokens.wxss`
- 修改：`sbh-miniprogram/miniprogram/app.wxss`
- 新建：`sbh-miniprogram/miniprogram/components/sbh-button/index.{js,json,wxml,wxss}`
- 新建：`sbh-miniprogram/miniprogram/components/sbh-card/index.{js,json,wxml,wxss}`
- 新建：`sbh-miniprogram/miniprogram/components/sbh-skeleton/index.{js,json,wxml,wxss}`
- 新建：`sbh-miniprogram/miniprogram/components/sbh-state/index.{js,json,wxml,wxss}`
- 修改：`sbh-miniprogram/miniprogram/pages/foundation/index.{json,wxml,wxss}`
- 测试：`sbh-miniprogram/tests/design-tokens.test.ts`
- 测试：`sbh-miniprogram/tests/components.test.ts`

**组件合同：**

- `sbh-button`：`variant='primary'|'secondary'`、`loading`、`disabled`；禁用/加载不触发 `tap`。
- `sbh-card`：只提供单层白卡容器，不嵌套新的视觉卡。
- `sbh-skeleton`：`rows` 和 `withMedia`；使用 opacity 动画，不使用旋转 loading。
- `sbh-state`：`kind='loading'|'empty'|'error'`、title、description、actionLabel；error 操作触发 `retry`。

- [ ] 先写 token 静态测试，断言三层命名（primitive → semantic → component）、设计稿全部关键值、组件 WXSS 不出现设计稿之外的硬编码 hex、按钮最小高度为 88rpx。
- [ ] 先写 `miniprogram-simulate` 组件测试，覆盖按钮默认/禁用/加载、state error 的重试事件、skeleton 行数。
- [ ] 运行两组测试并确认 RED。
- [ ] 实现 tokens：primitive 保存原值，semantic 表达页面/文字/交互语义，component 只引用 semantic/primitive；组件样式不得直接写 hex。
- [ ] foundation 页展示按钮、卡片、骨架及 empty/error 状态，作为开发者工具验收页，不承载业务导航。
- [ ] 重跑组件、token、类型检查和全量 Vitest，确认 GREEN。

### Task 5：微信开发者工具、自动化与预览脚本

**文件：**

- 新建：`sbh-miniprogram/scripts/check-project.mjs`
- 新建：`sbh-miniprogram/scripts/devtools-smoke.mjs`
- 新建：`sbh-miniprogram/scripts/preview.mjs`
- 新建：`sbh-miniprogram/tests/tooling-scripts.test.ts`
- 新建：`sbh-miniprogram/README.md`
- 新建：`artifacts/verification/MP-102/README.md`
- 新建：`.github/workflows/miniprogram-quality.yml`
- 修改：`specs/work-items/MP-002-miniprogram-delivery-roadmap.md`

**脚本合同：**

- `pnpm project:check`：纯本地检查配置、入口、私钥忽略规则和稳定版 Node `x.y.z`（`>=22.12 <23`），无微信账号也能运行。
- `pnpm devtools:smoke`：要求具有执行权限的 `WECHAT_DEVTOOLS_CLI`；先校验 CLI 再动态导入 automator；以 `trustProject: true` 打开工程；启动、路由、ready、验收窗口与关闭均有超时；严格核对 `pages/foundation/index`，轮询 `#foundation-ready` 并监听验收窗口内运行时异常；finally 关闭，失败后安全 disconnect，清理错误不覆盖原始错误。启动超时后若 launch 迟到完成，仍须对迟到连接执行带超时的 close/disconnect 回收。
- `pnpm ci:preview`：要求小写十六进制正式 AppID、仓外非符号链接且权限为 0400/0600 的私钥、1–30 机器人编号、严格 SemVer 和仓外显式二维码输出路径；先完成轻量配置校验再动态导入 CI。私钥以 `O_NOFOLLOW` 打开并用 `fstat`/inode 复核后读取内容，不把路径交给 CI。CI 只接收仓外随机私有 `0700` 暂存目录内的 `stage.jpg`，用户最终路径在 CI 期间保持不存在；成功后以 `O_RDONLY | O_NOFOLLOW` 校验暂存图为 1 字节至 5 MiB 的普通文件，再以 `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW`、`0600` 文件描述符原子复制到最终路径并复核 inode/大小。失败只删除本次创建且 inode 未变化的最终文件，finally 始终清理精确暂存目录。输出父目录必须已存在、非符号链接、仓外、可写且不得允许 group/other 写入。仅显式调用时才使用 `miniprogram-ci`，不得在 `prepare`、`test` 或普通 CI 中隐式上传。
- `.github/workflows/miniprogram-quality.yml`：仅当 `sbh-miniprogram/**` 或工作流自身变化时触发；固定 Node 22、pnpm 8.6.1，仅执行 frozen install、test、typecheck、project:check，不引用 secrets，不包含 deploy、preview 或 upload。

- [ ] 先写失败测试，覆盖缺少环境变量、非法 AppID、私钥不存在/权限/符号链接、机器人编号越界、严格 SemVer、二维码路径以及静态项目检查成功路径。
- [ ] 通过依赖注入的假 automator/fake CI 零网络覆盖 launch 参数、路由、ready 轮询、exception、各阶段超时、迟到 launch 回收、close fallback、Project/preview 参数、私钥/二维码 inode 竞态、私有暂存到最终文件的安全复制及成功/失败输出生命周期；用静态测试锁定质量工作流隔离边界。
- [ ] 运行定向测试并确认 RED。
- [ ] 实现三个脚本及中文 README，写清 Codex 与微信开发者工具的职责、打开目录、环境变量、合法域名、真机限制和私钥禁入库规则。
- [ ] 在没有微信开发者工具/AppID 时只运行 `pnpm project:check`；将 devtools/preview 标记为“需本机条件，未执行”，不得伪造通过。
- [ ] 用 Node 22 运行 `pnpm typecheck`、`pnpm test`、`pnpm project:check` 和 `pnpm audit --prod`；记录实际结果。
- [ ] 核对 `git status`，确保 `docs/SBH小程序页面设计/` 保持用户未暂存内容，且没有 `project.private.config.json`、私钥、上传产物或 `node_modules` 入库。
- [ ] 将 MP-102 状态更新为与证据一致：自动化门通过但缺开发者工具/真机时，只能写“代码完成，待微信环境验收”，不能标记完整完成。

## 完成门

- Node 22 下类型检查、Vitest 和项目静态检查通过。
- request 重试、错误、requestId 和协议边界均有 RED/GREEN 证据。
- 组件测试覆盖正常、禁用、加载、空和错误；设计 token 与完成稿关键数值一致。
- 微信开发者工具能否打开、automator 是否执行、真机是否验收分别陈述，不互相替代。
- 用户页面设计目录保持原样，不被自动格式化、不被暂存。
- 不推送、不创建 PR、不部署、不上传小程序。
