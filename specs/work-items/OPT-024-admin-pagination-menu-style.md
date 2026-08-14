# Task Packet：OPT-024 后台分页菜单样式修复

> 状态：已完成  
> 创建日期：2026-08-07  
> 最后更新：2026-08-07

## 1. 目标

修复后台列表“每一页”弹层选项 padding 被 reset 清零导致的紧凑、错位样式。

## 2. 非目标

- 不替换 Payload 分页组件，不修改依赖，不改变分页选项和行为。
- 不调整其他 Popup、表格或 Arco 组件。

## 3. 权威上下文

- Agent：`payload-office-platform/.agent/core.md`、`backend.md`、`testing.md`

## 4. 当前行为与证据

- 复现路径：`/admin/collections/listings` → 点击“每一页: 10”。
- 当前结果：选项 padding 四向均为 `0px`，高度约 `16.09px`。
- 期望结果：恢复 PopupButtonList 原始 padding/行高，菜单层级和交互不变。
- 根因：同 layer 后加载的 `.per-page__button` reset 覆盖 `.popup-button-list__button` padding。

## 5. 影响范围

- 预计修改文件：后台自定义 SCSS、样式合同测试和验证文档。
- 数据模型/迁移：无。
- 权限/API/缓存/事件：无。
- 风险：Payload 升级改变 class 或变量名；合同测试负责提示。

## 6. 实施清单

- [x] 建立失败样式合同测试。
- [x] 实现局部组合选择器覆盖。
- [x] 验证浅色、深色、分页交互、相邻列表和控制台。
- [x] 更新文档与任务状态。

## 7. 验收

- 自动化测试：样式合同与现有后台样式合同。
- 浏览器路径：房源列表、楼盘列表。
- 数据/迁移检查：无数据写入，无迁移。

## 8. 结果

- 修改文件：`custom.scss`、`admin-pagination-style-contract.test.ts` 及 OPT-024 设计、计划、任务和证据文档。
- 实际结果：分页选项恢复上下 `3.5px`、左右 `10px`、`20px` 行高和 `27px` 高度；分页逻辑不变。
- 验证摘要：合同测试 5/5、TypeScript、生产构建、浅色/深色、每页 25 条交互、相邻楼盘列表和构建后复验通过，控制台 0 error。
- 详细证据：`../../artifacts/verification/OPT-024/README.md`
- 剩余风险：Payload 升级若重命名内部 class 或变量，合同测试会提示；无运行时和数据风险。
- 下一步：等待用户决定是否与当前未提交修改一起提交、推送。
