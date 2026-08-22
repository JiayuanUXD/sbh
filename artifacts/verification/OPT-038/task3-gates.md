# OPT-038 Task 3 · 闸门与实跑证据

分支 `feat/opt-038-city-recruit-page-7a3e`，基线 `2d1a3dd`。

## 1. 本地三闸门

| 闸门 | 结果 |
|---|---|
| `pnpm typecheck` | 通过，零输出 |
| `pnpm test` | **243 passed / 2 skipped**（3435 tests passed / 4 skipped），零失败 |
| `pnpm lint` | **22 warnings / 0 errors** —— 与基线 22 持平，未超 |
| `pnpm build` | 成功；路由清单含 `ƒ /dev-story/opt038` |

## 2. E2E 环境（`next start` 生产 server）

```
CI=1  NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com
MULTI_CITY_ROUTING_ENABLED=false   PORT=3919（避开 3717）   DATABASE_URL 未覆盖
```

预热时**真读 HTTP 状态码**（不是「页面看起来出来了」）：

```
/                 200
/listings         200      ← 房源类
/buildings        200      ← 楼盘类
/city-partner     200
/admin            200
/hangzhou         200      ← ComingSoonCityView 的消费面
/dev-story/opt038 404      ← 按设计（生产环境 notFound()）
```

`/listings` 与 `/buildings` 同为 200 ⇒ memory 记的「房源全 404、楼盘全 200」环境失配指纹不存在。
随后跑 Playwright，**不带 `CI=1`**，靠 `reuseExistingServer` 复用已预热 server。

## 3. Playwright 全量

| 运行 | 结果 |
|---|---|
| 本分支（含 Task 3 改动） | **140 passed / 1 failed / 14 skipped**（2.1m） |
| 基线（`git stash` 掉 `src/` 改动后重新 `pnpm build` 再跑同一 spec） | **同一条用例同样 failed**（15 passed / 1 failed） |

唯一失败用例：
`tests/e2e/admin-navigation.spec.ts:664 › ADM 能看到导航配置里的每一个叶子`
—— 报「平台管理员看不到这些入口：**消息通知**」。

**已证伪它与 Task 3 有关**：把 `payload-office-platform/src` 的全部改动 stash 掉、重新
`pnpm build` + `next start` 后单跑该 spec，**同样红**。属本地环境/数据的既有失败
（后台导航叶子 `notifications`，与 C 端零关联；Task 3 的改动全在 `(frontend)` 样式与一个
className 上）。**未在本任务中修复，也不假装它是绿的。**

`city-partner-flow.spec.ts`（4 例，含 375 无横向溢出与 `getByRole('status')` 唯一性）、
`coming-soon` / `multi-city-*` 相关用例全部通过。

## 4. 表单三态实测

见同目录 `task3-form-states.json`，由 `task3-form-states-probe.mjs` 生成
（dev server 3719 + 路由拦截两个提交端点；脚本首步即断言预览页 HTTP 200，非 200 直接抛）。

三态摘要（1440 视口）：

| 态 | 根类名 | 卡宽×高 | 表面 |
|---|---|---|---|
| 第一步 · 必填 | `city-partner-form` | 400 × 735 | 白 `#fff` · border 0 · radius 18 · padding 40 · **box-shadow none** |
| 第二步 · 可选 | `city-partner-form` | 400 × 1137 | 同上；资源多选收成单列，6 条各 320×44、**每条单行不折** |
| 提交成功 | `city-partner-form__success` | 400 × 157 | 同上 |

`[role="status"]` 在三态下**恒为 1 个**（e2e strict mode 不会被触发）。
拦截到的请求序列 `['/create', '/details']`，请求体字段集合与基线一致。

## 5. 四断点 + 挤压窗口（每次改视口后**都 reload 再测**）

| 视口 | 容器 | 两栏 | `.rc-aside` | h2 | 横向溢出 |
|---|---|---|---|---|---|
| 375 | 343（左右各 16） | 单栏 · row-gap 48 | `static`（sticky 取消） | 32px | `scrollWidth == clientWidth == 375` → **0** |
| 768 | 736 | 单栏 | `static` | 40px | 761 vs 753 = 8（与 Task 1/2、首页 `/` 同值同因） |
| 1040 | 1008（被 `100% - 32px` 夹住） | **536 + 400**，无溢出 | `sticky 68` | 40px | 1033 vs 1025 = 8 |
| 1440 | 1024 | **552 + 400** · gap 72 | `sticky 68` | 40px | 1433 vs 1425 = 8 |
| 1920 | 1024（灰带出血到 1920） | **552 + 400** · gap 72 | `sticky 68` | 40px | 1913 vs 1905 = 8 |

8px 差值是全站 `100vw` 出血与滚动条宽度之差，由 `body { overflow-x: clip }` 兜住、
不产生实际滚动，Task 1 已在首页 `/` 上量到同值，**非本任务引入**。

## 6. sticky 粘附区间实测（1440，预览页左栏被占位块拉高到 1253）

```
.rc-core 文档顶 1686 · 高 1252 · 卡高 735
计算粘附点 scrollY = 1686 − 68 = 1618；释放点 = 1686 + 1252 − 735 − 68 = 2135

scrollY 1518 → aside.top = 168   （未粘附，随页滚动）
scrollY 1618 → aside.top = 68    （开始粘附）
scrollY 1818 → aside.top = 68    （粘附中）
scrollY 2135 → aside.top = 68    （粘附区间末端）
scrollY 2335 → aside.top = -132  （已释放，随页上移）
```

## 7. 外溢核查（两个既有消费面，**核的是触发条件不是「代码还在」**）

| 消费面 | `.rc-page` 祖先 | 表单表面 | 结论 |
|---|---|---|---|
| `/city-partner`（旧页，Task 5 才接线） | **无** | `display:grid` · gap 24 · padding 32 · 1px `rgba(0,0,0,.08)` · radius 12 · `shadow-sm`；step 铜色 13/700 字距 1.56px；input 14px padding 8/12；consent 带框 20px 墨色 accent；CTA radius 8 / 14 / 600 | **与基线逐项相同，零变化** |
| `/hangzhou`（ComingSoonCityView，4 条城市路由之一） | **无**（HTML 里 `rc-` 前缀零出现） | 表单根仍是 `city-partner-form city-coming-soon__embedded-form` | **零变化** |

唯一跨消费面的改动是手机号输入框多了 `sf-num`：

```html
<input class="filter-bar__input sf-num" type="tel" … id="partner-phone" …>
```

—— 刻意为之（全站「数字一律 tabular-nums」），在两个消费面上都成立，已写进组件注释。

新增 CSS 选择器逐条核对（`git diff` 提取）：除 `.rc-vp*` 这批全新类外，
**每一条都以 `.rc-page ` 起头**；`detail.css` 那两处只是在既有 `.dt-panel` 选择器组里
**追加选择器**，声明体一字未改（既有三个消费方的取值不动）。
