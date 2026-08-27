# Task Packet：OPT-061 `/_next/image` 全通配 remotePatterns 形成开放图片代理

> 状态：**已修复**
> 创建日期：2026-08-27
> 来源：用户安全审查（next.config.ts 配置巡检）
> 编号说明：本项**让号两次**——初编 OPT-059，与在建分支
> `docs/opt-059-homepage-image-covers-ab95` 上的 `OPT-059-image-pipeline-derived-sizes`
> 撞号；该分支同时占用了 OPT-060（`homepage-cover-configurability`），故顺延至 061。
> 教训同 OPT-058：开工前不仅查 `specs/work-items/`（当前 master 只到 058），
> 还要 `git branch -a` 查在建分支上的未合入编号。

---

## 1. 一句话

`next.config.ts` 的 `images.remotePatterns` 配了 `{ protocol: 'https', hostname: '**' }`
全通配——即使当前没有任何组件使用 `next/image`，`/_next/image` 优化端点默认启用，
全通配使它成为**任意 https 源的公开图片代理**：可被滥用刷出站带宽，也可当作
SSRF 探测面（用响应差异探测内网/第三方地址的可达性）。

## 2. 事实核查（2026-08-27）

- 全仓 `rg 'next/image'`：`src/` 内**零消费方**。仅两处注释提及未来接入
  （`payload.config.ts:527` blurDataUrl 说明、`components/frontend/ui/Media.tsx:73`
  「暂走原生 img」）。C 端图片全部是原生 `<img>`（`Media.tsx` 用 `<img src={media.src}>`）。
- 媒体 URL 一律是同源相对路径 `/api/media/file/*`（本地磁盘与 COS 模式同）。
  Next 的 `remotePatterns` **只约束远程绝对 URL**，相对路径不受它管——
  也就是说这个全通配从来不是任何现有功能所需要的。
- `rg 'remotePatterns'` 全仓仅 `next.config.ts` 一处，无其它引用或文档假设。
- 邻接风险留意：在建分支的 OPT-059 是「图片管线派生尺寸」。若那边将来引入
  `next/image` 且用远程图源，需同时在 `remotePatterns` 显式加白并改本项守卫测试——
  这正是守卫测试存在的目的（加远程源会让断言变红，逼迫显式决策）。

## 3. 修法

`remotePatterns` 收紧为空数组（等价于 Next 默认值：不允许任何远程源），
保留显式空配置 + 注释说明安全语义，防止将来"顺手"加回通配。
未来若真接入 `next/image`：同源相对路径开箱即用；需要远程源时按具体域名
逐条加白，并同步更新守卫测试。

## 4. 守卫

`tests/next-image-config.test.ts`：导入真实 `next.config` 导出，断言
`images.remotePatterns` 为空。TDD：先在全通配配置上看它红，再收紧配置转绿。

## 5. 验证

- [x] 守卫测试先红后绿（红：`- []` vs `+ [{hostname:'**'}]`；绿：7 passed）
- [x] `pnpm typecheck` 干净；`pnpm test` 全量 3851 passed / 25 skipped，无失败
- [x] 开放代理闭合的权威对照：直接以前/后两份 `images` 配置调用生产 `next start`
  在 `next-server.js:202` 使用的同一 gate 函数 `ImageOptimizerCache.validateParams`。
  通配配置下外部 `https://attacker.example/...` 被 **ACCEPT（代理）**；空数组下同 URL
  被 **REJECT: "url" parameter is not allowed**，而同源相对 `/api/media/file/*` 两态都
  ACCEPT。证据：`artifacts/verification/OPT-061/image-optimizer-before-after.txt`。
- [ ] 浏览器走查 C 端首页/列表/详情：**受环境所限未能在本机跑起带本改动的服务器**。
  本工作树路径下 `.pnpm` 嵌套绝对路径达 289 字符（> Windows 260 上限），Turbopack
  dev/build 直接解析失败（Node 侧 typecheck/vitest 不受影响，正是 CLAUDE.md 记载的
  指纹）；短路径 `E:\wt-o59` 亦然（`.pnpm` 相对路径本身即 ~256）。唯一可编译的主树
  正被另一会话（`docs/opt-059-homepage-image-covers-ab95`，3717 端口）活跃占用，
  按并行纪律不予借用。已用**只读**方式观察其运行中的 C 端页面确认渲染模型（见下）。
  结论：本改动仅影响 `/_next/image`，而 C 端零 `next/image` 消费方、图片全走同源原生
  `<img>`，故对页面渲染为可证明的惰性；真实服务器的 before/after 由生产同款 gate
  函数离线锚定。若需在合入前补一次带改动的真机走查，请在主树空闲后于短路径重跑。
