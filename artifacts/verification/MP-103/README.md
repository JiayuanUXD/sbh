# MP-103 验证证据

微信开发工具链的漏洞来源、官方版本调查与当前阻断决定见 [`toolchain-security-assessment.md`](./toolchain-security-assessment.md)。该评估没有接受安全例外，也没有把全量审计改成仅检查生产依赖。

> 当前状态：2026-08-27 已完成 Node 侧代码和回归验证；全量开发依赖安全审计仍红。微信开发者工具模拟器、真机、request 合法域名和图片域名尚未通过验收，不得用 Node 结果代替。

## 1. Node 侧自动化

- [x] Node 版本：`v22.23.2`，满足 `>=22.12 <23`。
- [x] TDD RED：先更新 `project-contract.test.ts` 和 `tooling-scripts.test.ts`；旧配置/旧脚本下定向执行为 2 个测试文件、10 个失败、47 个通过。失败原因为首路由仍是 `pages/foundation/index`、首页缺少 `#home-ready`，且冒烟脚本仍只验收 foundation。
- [x] TDD GREEN：完成最小路由、marker、工程检查和双页冒烟实现后，定向执行为 2 个测试文件、57/57 通过。
- [x] CLI 悬挂 TDD RED：在真实 Node 子进程中注入失败并制造活跃句柄；旧 `main()` 仅设置 `process.exitCode`，子进程超过 1.5s 上限后被 `SIGTERM`。定向结果为 1 文件、2 失败、48 通过。
- [x] CLI 悬挂 TDD GREEN：失败入口先保留短清理宽限，然后强制有界 `process.exit(1)`；真实子进程在有活跃句柄时仍以退出码 1 在 1s 断言上限内退出，成功入口返回后调用方可继续执行。定向结果为 1 文件、50/50 通过。
- [x] 小程序全量 `pnpm test`：19 个测试文件、241/241 通过。
- [x] 小程序 `pnpm typecheck`：小程序源码与 Node 工具两个 TypeScript 项目通过。
- [x] `pnpm project:check`：通过；已检查首页/找房/foundation 页面四件套、两项 tabBar、`#home-ready` 和 `#listings-ready`。
- [ ] `pnpm audit --audit-level high`：未通过；共 62 个已知漏洞（low 3、moderate 25、high 27、critical 7），路径集中在 `miniprogram-ci@2.1.31`、`miniprogram-automator@0.12.1` 和 `miniprogram-simulate@1.6.2` 的传递开发依赖。Task 7 未越界修改依赖或锁文件。
- [x] 补充边界 `pnpm audit --prod --audit-level high`：通过，无已知生产依赖漏洞。该结果不抵消上述全量开发依赖审计失败。
- [x] Web `payload-office-platform` 回归：`pnpm typecheck` 通过；`pnpm test` 为 289 个测试文件通过、5 个跳过，3904 个用例通过、25 个跳过。

## 2. 微信开发者工具模拟器

- [ ] 未执行：IDE 服务端口关闭。2026-08-27 使用既定 CLI 绝对路径尝试 `pnpm devtools:smoke` 一次，未建立 automator 连接，脚本报告“请检查 CLI、登录状态、自动化端口与工程编译结果”。报错后命令进程未自动退出，为避免留下挂起会话已手动中止（退出码 130）。
- [x] CLI 失败进程边界已通过真实 Node 子进程回归修复：失败时先给迟到连接与 close/disconnect 250ms best-effort 清理宽限，再强制以退出码 1 结束；成功路径不强制退出。本轮未重复调整 IDE 或再次发起真实冒烟，因此这条只证明进程边界，不代表模拟器页面验收通过。
- [ ] 未执行：首页 `#home-ready` 与找房页 `#listings-ready` 未在真实模拟器命中，无法出具两页运行时异常窗口或交互证据。
- [ ] 未执行：初次进入、搜索、区域快捷筛选、计价单位切换、价格/面积筛选、空结果逐项放宽、错误重试、下拉刷新、触底分页、图片失败、安全区和 44px 触达未走查，未产生模拟器截图。
- [x] 未开启 IDE 服务端口，未修改开发者工具安全设置。

## 3. 真机

- [ ] 未执行：本轮没有具备真实 AppID、微信账号权限、可访问的 HTTPS 联调环境与真机验收会话，因此 iOS/Android 的全部视觉、弱网、图片失败、安全区和 44px 触达矩阵均待补证。
- [ ] 未执行：无 `MP-103-<device>-<state>.png` 真机截图；不用 Node 侧测试或模拟数据代替。

## 4. request 合法域名

- [ ] 未执行：代码只能验证 trial/release API 基址为公开 HTTPS 根域名，无法读取或代替微信公众平台的 request 合法域名配置。待具备正式 AppID 和平台权限后，核对 Mini API 实际 origin 并在模拟器/真机网络面板留证。

## 5. 图片域名

- [ ] 未执行：房源封面来自 API DTO 的真实 URL；本轮没有在可用的微信环境中获取实际图片 origin，也无权限检查 downloadFile 合法域名。待联调时分别核对 API request 域名和所有图片 origin，不假设二者相同。

## 6. 安全与范围

- [x] 未执行 `ci:preview`、preview、upload、deploy；未提交、推送或创建 PR。
- [x] 未读取或写入正式 AppID、AppSecret、CI 私钥、二维码、`project.private.config.json` 或数据库配置。
- [x] 未修改用户原有 `docs/SBH小程序页面设计/` 未跟踪目录。
