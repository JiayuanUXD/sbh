# OPT-041 Task 8 浏览器验证记录

日期：2026-08-22　环境：worktree `E:\wt-opt041`，dev server `http://localhost:3718`

## 1. 页面正常渲染（不是白屏）

- `GET /admin/import/listings`（ADM 登录态）：侧栏可见「楼盘批量导入」「房源批量导入」两个入口；
  正文渲染标题「房源批量导入」+ 说明文案 + 「下载房源导入模板」「下载楼盘对照表」两个按钮 +
  「选择文件并开始预检」按钮。控制台无 error。
- `GET /admin/import/buildings`：同上，正文标题「楼盘批量导入」，说明文案不含楼盘对照表提示，
  且不显示「下载楼盘对照表」按钮（模式条件分支正确）。

## 2. 模板下载

`curl -b <ADM cookie> "http://localhost:3718/api/bulk-import/template?type=listings"`
→ `HTTP 200`，`content-disposition: attachment; filename*=UTF-8''房源导入模板.xlsx`，
`content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，
文件另存为 `template-listings.xlsx`，本地用 exceljs 打开确认为合法 xlsx。

## 3. 上传含错误行的表 → 统计条 + 红色警示条 + 错误表格

构造 3 行测试表（1 楼盘 slug 命中的有效行 + 1 房源类型枚举错误 + 1 楼盘找不到），
通过真实浏览器（`input[type=file]` 派发原生 `change` 事件、真实 fetch 网络请求，非 mock）
提交后页面渲染：

```
总行数 3
校验通过 1
校验失败 2
[红色 Alert] 确认后 1 套房源将立即对外可见，请确认数据无误。
错误明细表格：
  行号3 / 房源类型 / 不存在的类型 / 房源类型「不存在的类型」不是合法取值... / —
  行号4 / 楼盘编号或标识 / no-such-building-xyz / 未找到「no-such-building-xyz」对应的楼盘 / —
[下载完整错误表] [取消] [确认导入]
```

errorCount(2) === rowErrors.length(2)，未触发截断提示（符合预期，规格只要求
`errorCount > rowErrors.length` 时才显示"仅显示前 N 条..."）。

点击「确认导入」→ 进入 running 态：`已处理 0/3`，Progress 0%，新建/更新/失败统计条 0/0/0。
约 6 秒后（Jobs Queue 本地自动执行完）轮询到 `status=completed`，自动切到 done 态：

```
[绿色 Alert] 本批导入已完成。
新建 1 / 更新 0 / 失败 0
[批量下架本批房源]（disabled=true，Task 9 接上）  [再导一批]
```

四态机 idle → report → running → done 全程未跳跃，均由真实用户操作 / 轮询触发。

## 4. 无 data:import 权限账号 → Forbidden

以 `e2e-brk@example.com`（BRK 角色，menuPermissions 含 listings 但 operationPermissions
不含 data:import）登录后访问 `/admin/import/listings`：

- 页面渲染「无权访问 / 当前账号没有批量导入权限，请联系管理员在「角色管理」中开通 data:import。」
  （不是重定向、不是 404）。
- 侧栏「房源运营」分组下不出现「楼盘批量导入」「房源批量导入」两个入口
  （`document.querySelectorAll('a[href*="/admin/import"]')` 结果为空数组，导航层
  `requiredOperationCode: 'data:import'` 生效）。

## 5. 未登录直接打预检端点 → 403

```
curl -X POST http://localhost:3718/api/bulk-import/preflight?type=listings -F "file=@package.json"
→ HTTP 403
→ {"ok":false,"error":"未登录或会话已失效"}
```

## 附：迁移探测

```
pnpm exec payload migrate:create opt041_view_probe
→ "No schema changes detected." 未生成迁移文件（git status 确认 src/migrations/ 无新文件）
```

结论：`payload.config.ts` 的 `admin.views` 注册与 `navigation-config.ts` 的导航项增补是
schema-neutral，符合预期（已获用户对 admin.views 注册的标准授权，使用
`SKIP_MIGRATION_CHECK=1` 提交）。
