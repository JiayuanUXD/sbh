# OPT-059 两断点验证（DOM/computed-style 证据；肉眼视觉确认见 VISUAL-VERIFICATION-PENDING.md）

## 环境限制：本会话无法产出 `desktop.png` / `mobile.png`

`computer.screenshot`（及 `computer.zoom`）在本会话中持续报错：

```
Screenshot timed out after 5s: the Browser pane is not displayed, so the page is not compositing frames. Display the pane and retry.
```

尝试过的排查：多次重试、`resize_window` 切换 preset 前后各试一次、新建前台 tab（`tabs_create foreground:true`）后再试——**同样失败，是会话级限制，不是某个 tab 的偶发问题**。协调者已独立复现同一报错，确认不是本次操作导致的。

**因此 `focal-point-selector.png`、`desktop.png`、`mobile.png`、`focal-effect.png` 四张 brief 点名的截图本次都产不出来，如实报告"验不到"，不用其它证据顶替这个事实。**

作为替代，下面用 `getComputedStyle` / `getBoundingClientRect` 读真实渲染后的计算样式与布局尺寸——这条路径不依赖合成/绘制，只依赖 layout，在本环境下可靠。它能证明"CSS 规则确实按断点生效"，**不能证明"渲染出来的画面观感对"**——这两者是不同的问题，下面「结论」一节把这层差距说清楚。

## 桌面（1440×900，`resize_window` 显式设置，非 pane 默认响应式尺寸）

| 选择器 | 断言 | 实测 |
|---|---|---|
| `.hm-type-card__media img` | 可见 | `display: block`，`168px` 高 |
| `.hm-bento__main` | 480px | `height: 480px` ✓ |
| `.hm-bento__small` | 232px | `height: 232px` ✓ |
| `.hm-bento__wide` | 280px | `height: 280px` ✓ |
| `.hm-bento-card img` | `object-fit: cover` | `objectFit: cover`，`objectPosition: 50% 50%`（默认焦点），渲染尺寸 885×480（main） |

## 移动（375×812，`resize_window` 显式设置）

| 选择器 | 断言（对应 `home.css:210`、`home.css:238-241`） | 实测 |
|---|---|---|
| `.hm-type-card__media` | 退成 28px 编号列 | `width: 28px` ✓ |
| `.hm-type-card__media img` | `display: none` | `display: none` ✓ |
| `.hm-type-card__no` | 可见（编号改静态定位） | `display: block` ✓ |
| `.hm-bento__main` / `__small` / `__wide` | 三档统一 232px | 三者均 `height: 232px` ✓ |
| `.hm-bento__row` | 纵向堆叠 | `flex-direction: column` ✓ |

## 结论：这里证明了什么，没证明什么

CSS 断点规则本身（`home.css:203-218`、`home.css:242-245`）在浏览器里按预期生效，桌面/移动两套布局的计算样式与 brief 列出的具体行为逐条吻合——这证明了**规则被正确应用**。

**没有证明的是视觉观感本身**：`objectFit: cover` 加一组渲染尺寸数字，只能说明"CSS 设置正确"，不能说明"裁切构图合理、图片没有拉伸变形、移动端编号列里没有残留色块、bento 三档卡看起来高度真的整齐"——这些都是只有肉眼看截图才能判断的东西，而这正是这项验收（"两个断点各验"）字面上要验的内容。**这不是"验完了、只差张照片存档"，是这项验收的核心结论目前完全没有证据支撑**。待补的截图步骤和判断标准见 `VISUAL-VERIFICATION-PENDING.md` 的「1. `desktop.png`」「2. `mobile.png`」两节。
