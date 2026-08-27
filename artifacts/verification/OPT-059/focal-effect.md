# OPT-059 焦点实测（DOM/CSS 证据；肉眼视觉确认见 VISUAL-VERIFICATION-PENDING.md）

## 环境限制

与本目录其它文件相同：本会话 `computer.screenshot`/`zoom` 全程报 `the Browser pane is not displayed, so the page is not compositing frames`，无法产出 brief 要求的 `focal-effect.png` 像素截图，如实报告"验不到"（协调者已独立复现同一报错，确认是会话级限制）。改用真实渲染后的 `getComputedStyle` 读值——这条链路（`Media.focalX/focalY` → DTO → `ui/Media.tsx` 写 inline `--focal-x`/`--focal-y` → `.hm-bento-card img { object-position: var(--focal-x, 50%) var(--focal-y, 50%) }`）是"裁切跟不跟焦点走"这件事的数据通路，`object-position` 计算值直接决定浏览器渲染裁切的锚点。

## 操作路径

1. 复用 Step 5 已建的 media id=71（陆家嘴商圈封面，`opt059-srcset-cover.jpg`，三档 webp 派生齐全）。
2. `PATCH /api/media/71 { focalX: 20, focalY: 80 }`（明显偏离中心，对应 brief 建议的 x=20/y=80），返回体确认 `focalX=20, focalY=80` 落库。
3. 首页数据带缓存（见 `srcset-network.md` 里记录的 `unstable_cache revalidate:300`，且 `coverImage` 变更能触发失效但 media 内部字段变更不在 `Locations.ts` 的失效字段表里、也不属于该失效路径管辖范围）自然过期后刷新 `/shanghai`，读取该 `<img>` 的真实渲染样式。

## 实测

刷新前（焦点仍是旧值 50/50 时的缓存）：
```json
{ "style": "--focal-x:50%;--focal-y:50%", "computedObjectPosition": "50% 50%" }
```

缓存过期后重新刷新：
```json
{
  "style": "--focal-x:20%;--focal-y:80%",
  "computedObjectPosition": "20% 80%",
  "objectFit": "cover"
}
```

`read_console_messages({ onlyErrors: true })` → `No console logs.`，无报错。

## 结论：这里证明了什么，没证明什么

**证明了输入参数被正确传到了决定裁切的 CSS 属性上**：后台改 X%/Y% → `Media.focalX/focalY` 落库 → 前台 `<img>` 的 `object-position` 计算值同步从 `50% 50%` 变成 `20% 80%`。这条数据通路是端到端打通的，不是配置摆设。

**没有证明、也不能算作已证明的是渲染出来的画面观感是否正确**——`object-position` 数值对了，不代表肉眼能看出裁切确实偏了：这取决于图片内容本身和容器宽高比，理论上存在「数值变了但视觉上看不出差异」或「偏移方向和预期不符」的可能性，这两种情况都只有截图/肉眼查看才能发现。**这不是"只差最后一层薄薄的确认"，这正是这项验收要验的核心结论**，本次没有验到。待补的截图步骤和判断标准见 `VISUAL-VERIFICATION-PENDING.md` 的「3. `focal-effect.png`」一节。
