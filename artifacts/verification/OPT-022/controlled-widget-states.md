# 受控 Widget 状态浏览器验收

日期：2026-08-07。使用已有本地认证会话和 `http://localhost:3717/admin`，未读取或提交凭据。

## Loading

1. 通过 `apply_patch` 在 `requireAdminContext` 之后、`resolveDashboardStats` 之前临时加入 5 秒 Promise 延迟。
2. 等待开发服务热更新后重新加载 `/admin`。
3. 页面 `load` 完成后立即读取 DOM。

脱敏结果：URL 仍为 `/admin`；DOM 包含 `status "正在加载运营数据"`，证明后台 shell 已完成而统计仍在加载。

## Error 与 Retry

1. 将临时延迟替换为仅用于本次验收的受控异常。
2. 重新加载 `/admin`，等待 `.arco-admin-dashboard__error` 可见。
3. 读取错误文案，点击其中的“重新加载”，再次等待错误面板出现。

脱敏结果：错误文案为“运营数据暂时加载失败，请检查网络后重试。”；重试按钮可见且可点击；点击后重新发起请求并回到错误面板；浏览器控制台 error 数为 0。

## Restore 与 Success

1. 使用 `apply_patch` 删除临时受控异常，恢复生产实现。
2. 重新加载 `/admin`，等待“当前可租”可见。
3. 确认错误面板/重试按钮消失，读取浏览器控制台。

脱敏结果：成功统计可见，页面不含“重新加载”，浏览器控制台 error 数为 0。随后关闭本次新增的验收标签。

最终 `git diff` 中不包含延迟、受控异常或诊断开关。
