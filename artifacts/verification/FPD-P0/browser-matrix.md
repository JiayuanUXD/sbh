# FPD-P0 浏览器验证矩阵

## 自动化矩阵

浏览器：Playwright Chromium；服务器：`http://localhost:3727`；数据库：`sbh_detail_pages_p0`。

| 路由 | 375×812 | 768×1024 | 1440×900 | 1920×1080 |
|---|---|---|---|---|
| `/listings/jingan-serviced-office-42-seats` | PASS | PASS | PASS | PASS |
| `/buildings/west-nanjing-premium-center?group=lease` | PASS | PASS | PASS | PASS |

四档均断言：

- HTTP 200、唯一 H1。
- `scrollWidth <= clientWidth`，无横向溢出。
- 移动固定 CTA 不遮挡末尾正文；桌面布局使用预期详情结构。
- 房源和楼盘目标页 `console.error`、`pageerror` 均为 0；四档断言已固化在 `detail-pages.spec.ts`。

## 页面与状态补充

| 路由 / 操作 | 预期 | 实际 |
|---|---|---|
| `/listings`，375×812、1440×900 | 相邻列表可用、无横溢、无控制台错误 | PASS |
| 有效房源详情 | 决策信息、锚点、媒体、楼盘摘要和咨询可达 | PASS |
| 待复核房源详情 | 公开不可达 | PASS，HTTP 404 |
| 价格面议房源 | 不展示 `0 元` | PASS |
| 有效楼盘详情 | 同一 asOf 的数量、区间、分组和列表 | PASS |
| `empty-building` | 楼盘正文保留，不显示最低价/空 Tab | PASS，HTTP 200 |
| 楼内供给视图 | 桌面卡片/表格可切换，窄屏固定卡片 | PASS |
| 多价格单位 | 元/㎡/天、元/工位/月、元/月分组独立 | PASS |
| 图片加载失败 | 失败图片移除并显示稳定、可访问的“媒体加载失败”占位 | PASS |
| 画廊键盘 | 左右键、Esc、焦点归还、视频控件焦点循环 | PASS |
| 咨询两步流程 | 联系方式 → 需求 → 提交成功 | PASS，API 200 |
| sitemap 中所有房源/楼盘 | 仅有效公开 URL 且逐一返回 200 | PASS |
| F7.3 图片 alt | 单次原子 DOM 快照检查全部图片的 `alt` 属性 | PASS，repeat 3/3 |

404 路由会产生浏览器预期的失败资源记录；有效详情页、楼盘页和相邻列表页均未出现应用 console error 或 page error。

## 自动化文件

- `tests/e2e/detail-pages.spec.ts`
- `tests/e2e/inquiry-flow.spec.ts`
- `tests/e2e/disabled-supply-not-reachable.spec.ts`
- `tests/e2e/f7-3-accessibility.spec.ts`

最终结果：无 retries，36 passed，0 failed。
