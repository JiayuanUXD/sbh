# 后台分页菜单样式修复设计

## 背景与根因

Payload 3.86 的分页选项同时带有 `popup-button-list__button` 与 `per-page__button`。前者为弹层按钮设置 padding 和行高，后加载的后者又通过共享按钮 reset 写入 `padding: 0`。两条规则处于同一 CSS layer 且后者顺序更晚，因此分页选项最终只有约 16px 高，菜单行距和点击区域异常。

真实页面计算样式证据：

- `.popup-button-list__button` 预期设置 `padding-top/padding-bottom: calc(2px + var(--popup-button-list-gap) / 2)`。
- `.per-page__button` 后续 reset 将四向 padding 全部覆盖为 `0px`。
- 当前选项计算高度约 `16.09px`，行高约 `16.1px`。

## 方案

在后台 `custom.scss` 中增加仅命中分页弹层选项的组合选择器：

```scss
.popup__content .popup-button-list__button.per-page__button {
  padding-block: calc(2px + var(--popup-button-list-gap) / 2);
  padding-inline: var(--list-button-padding);
  line-height: var(--base);
}
```

组合选择器的作用域限定在 Payload Popup 内的 PerPage 按钮，复用上游组件自身变量，恢复被覆盖的原始意图。它不会改变其他 Popup 按钮、表格、筛选器或 Arco 组件。

## 非目标

- 不替换 Payload `PerPage` 组件。
- 不修改 `node_modules` 或给第三方包打补丁。
- 不改变每页数量选项、分页行为或当前选中箭头。
- 不引入新的视觉规范或全局 CSS reset。

## 测试与验收

- 先增加样式合同测试，要求组合选择器包含 `padding-block`、`padding-inline` 和 `line-height`，并确认修复前 RED。
- 实现后运行合同测试、相关后台测试和 TypeScript 检查。
- 在真实房源列表打开“每一页”菜单，确认计算 padding 不再为 `0px`、选项高度恢复，并验证选择每页数量仍能更新列表。
- 在浅色和深色模式检查弹层背景、文字、选中态和控制台。

## 风险与回滚

风险仅限 Payload 后续升级改变 class 名或 CSS 变量；样式合同测试和浏览器验收可捕获此类变化。回滚只需删除该组合选择器及对应合同测试，不涉及数据或迁移。
