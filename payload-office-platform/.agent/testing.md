# 测试、浏览器与完成规则

## 静态与自动化

按影响范围执行：

```bash
pnpm generate:types
pnpm payload generate:importmap
pnpm typecheck
pnpm test
pnpm migrate:dry-run
pnpm build
```

顺序与 `.github/workflows/quality.yml` 一致，本地按此自检可避免只在 PR 才暴露的失败。

- 未改 Collection/Global 可省略类型生成；但生成前确认 `.env.local` 有占位 `COS_*`，否则会静默删掉 `Media.prefix`。
- 未改后台组件注册可省略 import map；改了没重生成 → `/admin` 整站 hydration 白屏（资源全 200）。
- 未改 `src/migrations/` 可省略 `migrate:dry-run`。
- 不删除、跳过失败测试或新增 suppress。
- PostgreSQL 专属约束必须在 PostgreSQL 验证。

## 浏览器与 UI 验收铁律

页面、路由、表单、权限或状态变化必须在真实浏览器中验证，**严禁仅凭静态代码推断**：

- **目标路由与环境**：目标路由、一个相邻路由和控制台；
- **前台视口**：375×812、768×1024、1440×900、1920×1080；
- **后台深浅色与微观色值对账（反“全局盲视”）**：
  - 严禁仅看“大背景是否变黑”就过关；
  - 必须逐个审查微观控件：输入框、下拉选框（Select）、Radio/Tab 切换条、Tag 徽标、空状态（Empty）底色是否符合 `--theme-elevation-*`，严禁在 Dark Mode 下残留 `#FFFFFF` 白底；
  - 必须通过脚本或点击主动触发**展开态（Dropdown Popup、Modal、Tooltip、Popconfirm）**，截取展开状态并核验浮层是否完成深色适配。
- **表单与持久化三步铁证（反“内存自嗨”）**：
  - **第 1 步 抓包核验**：拦截实际发出的 `POST/PATCH` 请求体（Request Payload），核验所有字段与嵌套数组行数据是否完整序列化并提交；
  - **第 2 步 状态码与响应核验**：确认服务端返回 `200/201` 且响应中的 Document 包含正确的最新持久化结构；
  - **第 3 步 强刷重载核验**：执行完整页面刷新（`page.goto` / `page.reload`），重新进入目标 Tab/区域，核验 DOM 回显与数量是否 100% 保持，杜绝删图残留或调序瞬态复原。
- **复杂拖拽与交互隔离**：
  - 存在拖拽（Drag & Drop）的容器，所有子控件（按钮、下拉框、删除确认、链接）必须显式阻止冒泡（`stopPropagation`）或做 target 过滤，严禁让拖拽手势劫持点击事件；
  - 自定义 array 字段组件的本地 state **只能作展示投影**，增删改序一律走 Payload 行级 action（`addFieldRow` / `removeFieldRow` / `moveFieldRow`，以及针对 `<path>.<行号>.<子字段>` 的 `UPDATE`）。**严禁用 `setValue` 往 array 父路径写整个数组**——Payload 对有行的 array 会设 `disableFormData=true`，该路径提交时被整体跳过，写进去的内容根本不会落库（真实教训：新上传的媒体在已有媒体的楼盘上静默丢失）。

## 可访问性与性能

- 前台目标 WCAG 2.2 AA；全键盘完成核心流程。
- Modal/Drawer 具焦点锁定、Esc、焦点归还和背景隔离。
- 触控目标 ≥44px，颜色不是唯一表达。
- 移动 p75 目标：LCP ≤2.5s、INP ≤200ms、CLS ≤0.1。

## 证据质量（OPT-037 回写：这批出过四次「证据本身有问题」，前三次事后才发现）

前面几节管的是「有没有验」，本节管的是「验出来的东西算不算数」。四条判据，每条都对应一次真实失误：

- **验证脚本必须随证据一起提交——证据文件不能自证。** 出过这样一次：报告称「实测通过」，
  而它自己提交的 JSON 在 2/3 断点上给出相反的值，报告引用的键在 JSON 里根本不存在，生成脚本又没进仓；
  事后才查明是**两支脚本的结论被混着写进了一份报告**。没有脚本，没人能复核一个「已附证据」的结论。
- **截图 / HTML 对比之前，先证明页面真的渲染了。** 出过拿两张 404 页比出「四档 0 差异像素」的空结论
  （`/dev-story/*` 这类预览路由在 `next start` 下可能显式 `notFound()`）。先断言状态码与一个页面特有的选择器，再比像素。
- **量之前先确认夹具能产出被测现象。** 空的关系表会让改动前后都是 0，「没变化」被误读成「没生效」或更糟——被当成「已验证」。
  临时夹具可以用，但要能整段还原，并在报告里写清「量完已移除」。
- **URL 类证据不要归一成 pathname。** 归一会让带 query 的那一整类链接在证据里隐形
  （实例：5 条 `/listings?district=<slug>` 全塌进已被导航预取的 `/listings`，整整 5 条收益在证据里消失）。
  只剥框架自己的指纹参数（如 `_rsc`），其余 query 保留。

补两条同源的采样纪律：

- **断言要打在缺陷区内，不要打在「恰好还能用的那一半」。** Playwright 的 `click()` 默认打元素中心；
  一个盖住底部 45% 的装饰层吞掉点击时，中心点恰好避开缺陷区，测试照样绿。修复后要把打在缺陷区的断言常驻化。
- **对照实验的样本数必须匹配被测对象的稳定性。** 怀疑是竞态时 `n=1` 的对照不构成证据
  （用 `--repeat-each=N`）。稳定性判据还必须排除「平凡稳定」——「一直没动」也满足「不动」，
  「反复滚到底直到 scrollY 稳定」会接受「从未移动」这个状态。

## `pnpm test` 不含 E2E——改了 class / role / aria / DOM 结构必须本地实跑 e2e

宪章把 E2E 留给 CI，所以本地三闸门（typecheck / test / lint）全绿在结构上**证明不了**改动安全。
本批有两次「本地全绿、e2e 红」，其中一次潜伏了 6 个任务才被发现。

本地跑「CI 等价」E2E 的完整环境（缺任一项都会得到误导性结果）：

- 构建：`CI=1` + **https 的 `NEXT_PUBLIC_SITE_URL`** + `MULTI_CITY_ROUTING_ENABLED=false`；
- 起 server：`next start -p <非 3717 端口>`，curl 预热全部取样路由确认 200 后再跑 Playwright；
- Playwright 侧**带 `E2E_PROD_SERVER=1`、不带 `CI=1`**（`reuseExistingServer: !CI`）。

典型症状与归因：

- **「房源类路由全红 / 楼盘类全绿」** = 缺 `CI=1` 或 `NEXT_PUBLIC_SITE_URL` 不是 https，
  `src/lib/runtime/config-guard.ts` fail-closed 让房源类路由全线 404。先查环境，别查被测代码。
- **「旧详情所有权」用例 307 vs 200** = 工作树 `.env.local` 里的 `MULTI_CITY_ROUTING_ENABLED`
  被 `next start` 读到而 Playwright 进程读不到，**这个错配本身**就会让用例失败。必须显式设 `=false`。
- **本地库夹具厚薄不同会改变结论**：并行 worktree 各自的隔离库房源数、媒体数都不一样，
  「master 上就坏的」「本地没跑 seed:media」这类归因在换库后可能整个不成立。
  写进记忆的环境断言要标注实测日期，被当作硬性指令前必须重新实测。
- **`unstable_cache` 持久化在 `.next/dev/cache/fetch-cache`，重启 dev server 并不清它**——
  改库后要在前台看见变化：删该目录**再**重启，两步缺一不可。否则连着三次「状态走查」拿到的是同一份基线数据。
- 外部脚本复现不出来的 e2e 失败，差异往往在 fixture / `beforeEach`（例：`route.abort()` 自己会记一条
  `net::ERR_FAILED` 到 console，被 `afterEach` 的控制台守卫拦下）。**直接在 `tests/e2e` 里放一个临时 spec、
  跑完即删**，在真实 runner 里抓，比继续猜便宜。
- 定位「是不是我们弄坏的」用**定向对照法**：`git checkout master -- <单个可疑文件>` → 跑用例 →
  `git checkout HEAD -- <该文件>` 还原。比 worktree / bisect 便宜且能精确到文件（但仍受上面 `n=1` 那条约束）。

## 证据

详细输出（长日志、截图等）存入 `../artifacts/verification/<工作项编号>/` 或 PR 描述，禁止粘贴长日志到 Tasks。

## 完成定义

只有以下全部成立才能勾选与汇报完成：

- 用户结果符合工作项（`../specs/work-items/`）声明的验收标准；无工作项时符合本会话确认的目标。
- 服务端权限、状态机和数据范围正确。
- 关键正常、异常、越权、并发路径有测试。
- 类型（`pnpm typecheck`）、相关测试、构建通过。
- 浏览器目标和相邻流程通过，具备**抓包 Request Payload、刷新回显 DOM 与深色展开态截图**三重铁证，无新增控制台错误。
- 迁移/数据变化有 PostgreSQL 证据和回滚说明。
- 任务包、Tasks 状态、风险和未验证项已更新。

无法执行的验证必须逐项报告，严禁在无真实证据前笼统声称完成。

