# OPT-024 验证证据

日期：2026-08-07

## 根因

真实房源列表的分页选项同时命中：

```text
.popup-button-list__button
.per-page__button
```

前一规则设置 PopupButtonList padding，后加载的 PerPage 共享按钮 reset 再写入 `padding: 0`。修复前浏览器计算值：

```text
padding-top/right/bottom/left = 0px
line-height = 16.1px
height = 16.0938px
```

## TDD

基线：

```text
pnpm exec vitest run tests/dashboard-stats-widget-contract.test.ts
1 file passed / 4 tests passed
```

RED：

```text
pnpm exec vitest run tests/admin-pagination-style-contract.test.ts
1 file failed / 1 test failed
原因：custom.scss 中不存在分页组合选择器及 spacing 声明。
```

GREEN：

```text
pnpm exec vitest run tests/admin-pagination-style-contract.test.ts tests/dashboard-stats-widget-contract.test.ts
2 files passed / 5 tests passed

pnpm exec tsc --noEmit --pretty false
exit 0
```

## 构建与服务

为避免开发服务和生产构建同时写 `.next`，先停止 3717，再执行：

```text
NEXT_PUBLIC_SITE_URL=https://example.com pnpm build
exit 0；编译、TypeScript、静态页面和路由生成成功
```

随后重新启动 `pnpm dev`，健康检查：

```text
GET http://localhost:3717/api/health
status=ok, payload=ok, db=ok
```

Node 当前为 v24.14.0，项目声明 22.x，pnpm 输出 engine warning，但未影响测试、类型、构建或运行。

## 浏览器

目标路由：`/admin/collections/listings`

- 浅色：padding 上下 `3.5px`、左右 `10px`，行高 `20px`，高度 `27px`，白色 Popup。
- 深色：同样 spacing，Popup 背景 `rgb(34, 34, 34)`、文字白色。
- 点击 25：URL 变为 `?depth=1&limit=25&page=1`，范围显示 `1-25 共 2169`。

相邻路由：`/admin/collections/buildings`

- 分页选项 spacing 同目标路由，计算高度 `27px`。
- 浅色恢复后控制台 `0 error`。

生产构建并重启开发服务后的最终复验：

```text
padding-top/bottom = 3.5px
padding-left = 10px
line-height = 20px
height = 27px
theme = light
console errors = 0
```

## 数据与回滚

- 无数据库读写、迁移、权限、API、缓存或事件变化。
- 回滚只需删除分页组合选择器和样式合同测试。
