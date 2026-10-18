# OPT-120 楼盘 URL 标识自动生成验证

日期：2026-10-17。分支：`codex/building-auto-slug-b7e41a`。应用：`E:\github\sbh\payload-office-platform`。

## 结果

楼盘新建不再显示或提交 slug 手填框，由服务端 beforeValidate 生成标识；名称旁复用房源的只读 URL 图标。重名追加序号，已有标识在改名和普通保存时保留。未变更数据库 schema，无需本项迁移。

## 自动化与审查

- 针对性回归：6 文件、94 测试通过。先红后绿的日志及详细命令见 `implementation.md`。
- `pnpm generate:types`、`pnpm payload generate:importmap`、`pnpm typecheck` 均退出 0。类型中 Media.prefix 出现 2 次。
- `pnpm lint`：退出 0，0 错误、37 条未涉及文件的既有警告。
- 全量 `pnpm test`：6511 测试通过，1 项因当前 PATH 中缺少 tar 失败。只为定向测试子进程前置 Git 的 usr/bin 后，失败文件的 31 项全部通过；没有修改系统 PATH 或测试代码，也未重复全量。
- `pnpm build`：退出 0，证据 `build.log`。构建前确认没有 `.env.production` / `.env.production.local`，仅使用本地环境并关闭该构建进程的作业自动运行。
- 独立子代理审查：未发现需修复的问题，见 `review.md`。
- 构建后冷重启 `pnpm dev`，3717 服务 Ready；`/api/health`、首页与 `/admin/collections/buildings/create` 均返回 200，Payload/数据库健康。开发服务继续运行；`next-env.d.ts` 由 Next 恢复为本任务开始时已有的 dev 类型引用，未手工编辑。

## 浏览器、请求和持久化

使用已登录的真实本地浏览器和同一个 3717 开发服务。为记录真实的 multipart 表单请求，在 3720 临时运行 `capture-proxy.mjs` 转发请求；代理不启动第二个应用，不记录 Cookie/Authorization 请求头。验证完成后已关闭代理。

| 动作 | 响应 | 实际结果 |
|---|---|---|
| 新建名称 `OPT120 验证大厦 b7e41a` 的草稿 | POST 201，id=1760 | `opt120-yan-zheng-da-sha-b7e41a` |
| 名称改为 `OPT120 改名验证大厦 b7e41a` 后保存 | PATCH 200 | 原标识保持不变；刷新后名称和标识继续存在 |
| 再建一条与原名相同的草稿 | POST 201，id=1761 | `opt120-yan-zheng-da-sha-b7e41a-2`；刷新后仍为此值 |
| 打开已有楼盘 id=1 | 正常加载 | 原标识 `west-nanjing-premium-center-2302` 在名称旁显示 |
| 深色模式展开发布状态菜单 | 正常展开 | 图标、输入框、选中项与浮层适配深色，见 `dark-dropdown.png` |
| 恢复浅色并回到楼盘列表 | 正常加载 | 共 7 条原有非回收站记录；控制台 error 列表为空 |

三个成功的 POST/PATCH 请求体均没有 slug 字段，服务端响应包含正确的标识，证明不是前端预填值。原始请求/响应见 `browser-requests.jsonl`；结构化请求和 PostgreSQL 复核见 `results.json`。最早一次创建因未选行政区按原规则返回 400；补选上海/静安区后成功，与 slug 功能无关。

测试记录 1760、1761 均为本项专用草稿，验证后仅设置 deleted_at 移入本地回收站，未物理删除。`verify-results.mjs --cleanup` 限定本地地址、两条捕获到的 ID、指定测试名称与草稿状态；事务中检查行数后提交。再次只读复核：

```powershell
node artifacts/verification/OPT-120/verify-results.mjs
```

截图：`light-created.png`、`dark-renamed.png`、`dark-dropdown.png`、`light-duplicate.png`、`existing-building-result.png`。刷新后的可访问性树：`duplicate-after-reload.txt`、`existing-building.txt`、`list-after-cleanup.txt`。

## 验证边界

同时新建同名楼盘仍由现有数据库唯一约束兜底，本项没有增加并发自动重试；这一边界已写入批准的计划。既有 API 显式自定义非空标识继续保留，后台普通编辑不提供改标识输入。正式上线尚需按仓库发布流程完成提交、审查与用户确认；本项只在本地实现，未提交、推送或部署。
