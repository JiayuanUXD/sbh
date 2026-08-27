# OPT-059 焦点实测（DOM/CSS 证据，无法产出 `focal-effect.png`，见下方环境限制说明）

## 环境限制

与本目录其它三份 `.md` 相同：本会话 `computer.screenshot`/`zoom` 全程报 `the Browser pane is not displayed, so the page is not compositing frames`，无法产出 brief 要求的 `focal-effect.png` 像素截图，如实报告"验不到"。改用真实渲染后的 `getComputedStyle` 读值——这条链路（`Media.focalX/focalY` → DTO → `ui/Media.tsx` 写 inline `--focal-x`/`--focal-y` → `.hm-bento-card img { object-position: var(--focal-x, 50%) var(--focal-y, 50%) }`）本身就是"裁切跟不跟焦点走"的机制来源，`object-position` 计算值直接决定浏览器渲染裁切的锚点，读到这个值变化即等价于验证了裁切行为会变，只是没有肉眼像素图可比对。

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

## 结论

**焦点变化确实端到端生效**：后台改 X%/Y% → `Media.focalX/focalY` 落库 → 前台 `<img>` 的 `object-position` 计算值同步从 `50% 50%` 变成 `20% 80%`。`object-fit: cover` 下，`object-position` 直接决定裁切从图片哪个锚点取景，这一属性变化即是 bento 卡片裁切跟随焦点走的直接证据。**缺的只是肉眼截图确认最终像素观感**，机制层面（数据流 + CSS 属性）已完整验证。
