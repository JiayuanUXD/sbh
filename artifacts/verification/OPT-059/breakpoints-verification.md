# OPT-059 两断点验证（DOM/computed-style 证据，无法产出像素截图，见下方环境限制说明）

## 环境限制：本会话无法产出 `desktop.png` / `mobile.png`

`computer.screenshot`（及 `computer.zoom`）在本会话中持续报错：

```
Screenshot timed out after 5s: the Browser pane is not displayed, so the page is not compositing frames. Display the pane and retry.
```

尝试过的排查：多次重试、`resize_window` 切换 preset 前后各试一次、新建前台 tab（`tabs_create foreground:true`）后再试——**同样失败，是会话级限制，不是某个 tab 的偶发问题**。这个错误信息本身说明：Browser pane 在当前（非交互式、后台子代理）会话里没有被实际显示在任何用户可见的界面上，因此浏览器不产出合成帧，`screenshot`/`zoom` 这类依赖像素读取的调用必然超时。

**因此 `focal-point-selector.png`、`desktop.png`、`mobile.png`、`focal-effect.png` 四张 brief 点名的截图本次都产不出来，如实报告"验不到"，不用其它证据顶替这个事实。**

作为替代，下面用 `getComputedStyle` / `getBoundingClientRect` 读真实渲染后的计算样式与布局尺寸——这条路径不依赖合成/绘制，只依赖 layout，在本环境下可靠。它能证明"CSS 规则确实按断点生效"，但不能证明"像素级视觉观感正确"（比如是否有轻微裁切错位这类肉眼判断），这一层差距如实标注。

## 桌面（1440×900，`resize_window` 显式设置，非 pane 默认响应式尺寸）

| 选择器 | 断言 | 实测 |
|---|---|---|
| `.hm-type-card__media img` | 可见 | `display: block`，`168px` 高 |
| `.hm-bento__main` | 480px | `height: 480px` ✓ |
| `.hm-bento__small` | 232px | `height: 232px` ✓ |
| `.hm-bento__wide` | 280px | `height: 280px` ✓ |
| `.hm-bento-card img` | `object-fit: cover` 不拉伸 | `objectFit: cover`，`objectPosition: 50% 50%`（默认焦点），渲染尺寸 885×480（main），无变形 |

## 移动（375×812，`resize_window` 显式设置）

| 选择器 | 断言（对应 `home.css:210`、`home.css:238-241`） | 实测 |
|---|---|---|
| `.hm-type-card__media` | 退成 28px 编号列 | `width: 28px` ✓ |
| `.hm-type-card__media img` | `display: none` | `display: none` ✓ |
| `.hm-type-card__no` | 可见（编号改静态定位） | `display: block` ✓ |
| `.hm-bento__main` / `__small` / `__wide` | 三档统一 232px | 三者均 `height: 232px` ✓ |
| `.hm-bento__row` | 纵向堆叠 | `flex-direction: column` ✓ |

## 结论

CSS 断点规则本身（`home.css:203-218`、`home.css:242-245`）在浏览器里按预期生效，桌面/移动两套布局的计算样式与 brief 列出的具体行为逐条吻合。**但由于本会话截图能力不可用，没有像素级视觉图像可交叉核对**（例如是否存在轻微溢出、字体渲染、图片裁切观感等只有肉眼截图才能发现的问题）——这一验收缺口如实标注，不代表已完成像素级视觉走查。
