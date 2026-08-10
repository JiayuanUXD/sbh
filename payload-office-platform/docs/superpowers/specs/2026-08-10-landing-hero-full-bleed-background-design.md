# LandingHero 通栏背景设计

## 目标

将落地页 `LandingHero` 区域升级为通栏视觉背景：背景铺满浏览器宽度，正文内容仍保持现有 1440px 安全区。`/publish` 和 `/entrust` 使用同一套组件能力，但各自绑定独立背景素材，避免两个入口视觉重复。

## 已确认要求

- 采用方案 A：共享 `LandingHero` 通栏能力。
- `/publish` 与 `/entrust` 背景素材分开，不共用同一张图。
- 背景图生成后存储到腾讯云 COS，页面通过现有 `/api/media/file/<filename>?prefix=media` 访问。
- 不变更 Node 环境、不引入新 UI 框架、不引入 shadcn/Tailwind reset。

## 视觉方向

- `/publish`：偏“业主/物业提交资产”的场景，画面应体现高端写字楼立面、前厅或空置办公空间的可信感，留出中部标题可读空间。
- `/entrust`：偏“企业选址顾问服务”的场景，画面应体现顾问、会议桌、城市商务空间或空间评估氛围，但不出现可识别人物正脸。
- 两张图都不包含文字、logo、水印，避免生成图中文字不稳定。
- 通过深色/暖色 scrim 确保标题和说明在 375、768、1440、1920 视口可读。

## 交互与布局

- `LandingHero` 背景通栏：使用 `width: 100vw` 和 `margin-inline: calc(50% - 50vw)` 抵消 `.site-main` 内边距。
- 内容安全区：保留 `.landing-hero__inner` 的 `var(--container-max)` 最大宽度和现有左右 padding。
- `/publish`：仍保持居中标题；下方表单卡片继续上叠，不被背景层遮挡。
- `/entrust`：仍保持 split 布局；表单和标题在背景上有足够对比度。

## 可访问性

- 背景图为装饰性素材，使用空 `alt` 和 `aria-hidden="true"`，避免读屏重复信息。
- 标题、副标题继续使用真实文本和唯一 H1。
- 背景加载失败时仍保留纯色/渐变底色，页面功能可用。

## 验收

- 单元测试：页面必须输出两张不同的 COS 背景 URL。
- 样式测试：`.landing-hero` 必须具备 100vw 通栏出血规则。
- 浏览器验证：`/publish` 和 `/entrust` 在 375×812、768×1024、1440×900、1920×1080 下无横向滚动、无新增 console error。
