# OPT-038 Task 6 · 闸门与清理证据

基线 `8a67c10`（Task 5 提交 `8087360` + 一条不属本批的 e2e 定位修复）。以下每条都是本机实跑结果，脚本随证据提交。

## 1. 闸门

| 闸门 | 结果 | 基线（Task 5） |
|---|---|---|
| `pnpm typecheck` | 通过，零输出 | 通过 |
| `pnpm test` | **245 files / 3448 tests passed，2 files / 4 tests skipped，零失败** | 245 / 3448 |
| `pnpm lint` | **22 warnings / 0 errors** | 22 warnings |
| `pnpm build` | 成功 | 成功 |
| **E2E 本地实跑** | **141 passed / 14 skipped / 0 failed（2.3m）** | 141 / 14 / 0 |

`pnpm migrate:dry-run` 未跑：零 collection 改动，`src/migrations/` 一字未动。

### 1.1 E2E 环境（两侧 flag 必须同值——本轮实地踩到）

build 与 `next start` 均带 `CI=1` +
`NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com` +
`MULTI_CITY_ROUTING_ENABLED=false`；端口 **3921**（避开 3717 与 Task 5 的 3919）；
**未覆盖 `DATABASE_URL`**（默认库 `postgres`）。Playwright 侧 `PORT=3921 E2E_PROD_SERVER=1`，
**不带 `CI=1`**，靠 `reuseExistingServer` 复用已预热的 server。

⚠️ 第一轮我**只给 server 传了 `MULTI_CITY_ROUTING_ENABLED=false`，Playwright 进程没传**，
结果 **128 passed / 14 failed**。那 14 条全是 `multi-city-routing` / `multi-city-isolation` /
`detail-pages` / `landing-pages`，报的是「期望 307 实际 200」「`.city-switcher__trigger` 找不到」
——**看起来完全像产品回归**。真因是这些 spec 直接读**测试进程自己的**
`process.env.MULTI_CITY_ROUTING_ENABLED` 来选期望值，而它从工作树 `.env.local` 拿到了 `true`。
同一个构建、同一台 server，只在 Playwright 侧补上该变量即回到 141 passed / 0 failed。
已写进 `.agent/testing.md`。

## 2. 死规则摘除：逐类名，两道判据

### 2.1 判据 A —— 带边界的全仓 grep

37 个候选类名逐个 grep（`src` / `tests` / `scripts` / `docs` / 仓库根，排除 `node_modules` /
`.next` / `.git` / 另一个 worktree），结果只有两类命中，都不是消费方：

| 命中形态 | 例子 | 结论 |
|---|---|---|
| CSS / 组件注释里解释「旧版长什么样」 | `recruit.css:159` 提到 `.city-coming-soon__hero`、`:533` 提到 `__quick-links`；`RecruitHero.tsx:68,72` 提到 `__media` | 不是消费方 |
| **文件名子串误判** | `city-partner-page` 在 `src`/`tests` 里 7 处「命中」，**全部是 `tests/city-partner-page-seo.test.ts` 这个文件名** | ★ 正是 brief 点名的 `page-detail__summary` 同型陷阱。带边界重 grep（`city-partner-page([^-a-zA-Z]\|__\|$)`）后，除 styles.css 自身外**零命中** |
| CSS 存在性断言 | `coming-soon-city-view.test.ts:44-47` 的四条 `toContain` | 不是渲染消费方，是钉着旧版式的守卫；已随本次清理**反转方向**为 `not.toContain` |

另外核过**模板串拼接**（`` `city-coming-soon__${...}` `` 之类）：全仓零命中。
这是 `.city-switcher__status--live` 那次的失效通道，必须单独查。

### 2.2 判据 B —— 生产 server 上的运行时 `querySelectorAll`

脚本 `task6-dead-css-probe.mjs`，删 CSS 前后各跑一次。扫 4 条路由：
`/city-partner`、`/hangzhou`、`/hangzhou/listings`、`/hangzhou/buildings`
（`/hangzhou/sale` 本地 404，属预期，不列入）。预热**真读 HTTP 状态码**，任一不符即抛。

**37 个候选在 4 条路由上的命中数总和 = 0。**

**对照选择器（证明扫描本身有效，不是「什么都没扫到」）：**

| 选择器 | `/city-partner` | `/hangzhou` | `/hangzhou/listings` | `/hangzhou/buildings` |
|---|---|---|---|---|
| `.rc-page` | 1 | 1 | 1 | 1 |
| `.rc-container` | 3 | 3 | 3 | 3 |
| `.rc-core` / `.rc-aside` | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `.city-partner-form` | 1 | 1 | 1 | 1 |
| `.city-partner-form__step` / `__consent` | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `.city-coming-soon` | **0**（该页无城市外壳，符合预期） | 1 | 1 | 1 |
| `.city-coming-soon__embedded-form` | 0 | 1 | 1 | 1 |
| `.city-coming-soon__media` | 0 | 0 | 0 | 0 |

原始数据 `task6-dead-css-probe-before.json` / `task6-dead-css-probe-after.json`。

### 2.3 存疑保留（判据未同时满足，一个都没删）

| 类名 | grep | 运行时 | 处置 |
|---|---|---|---|
| `.city-coming-soon`（根） | 有（组件源码 + 测试文本断言） | **1**（三条城市路由） | **保留**。虽然 `recruit.css` 把它复位成透明块、旧盒模型全被压掉，但它仍在 DOM 上，删了就得连 `recruit.css` 的复位一起删——那是渲染路径的改动，不属清理 |
| `.city-coming-soon__media` | **有**（`ComingSoonCityView.tsx:104` 真的在渲染） | **0** | **保留**。运行时 0 只说明本地库没有城市填了 `hero.media`（7 个 profile 全空），不说明没有消费方。这与 `.amap-layer`（grep 0 / 运行时命中）**正好互为镜像**，两道判据缺一不可的活例 |
| `.city-coming-soon__embedded-form`（+ `header h2` / `header p`） | 有 | **1** | **保留**。虽然三条声明在 `.rc-page` 作用域下全被 (0,2,0) 压过去、当前不产生任何可见效果，但类名活着，属「拿不准就留」 |
| `.city-partner-form*` **全族** | 有 | 1 | **保留**。表单组件类名写死且被 4 条城市路由共用，`recruit.css` / `detail.css` 是**覆写**它而不是取代它 |
| `.city-partner-form__step` | 有 | 1 | **保留**，但从 `.city-partner-page__eyebrow, .city-partner-form__step` 这条分组规则里**摘掉了已死的那一支**，规则本身与取值一字未改 |
| `@media (max-width: 640px)` 里的 `.city-partner-form(__success)` / `__checks` | 有 | 1 | **保留**。它们在 `.rc-page` 下被 `detail.css`/`recruit.css` 的 (0,2,0) 全部压过去、实际不生效，但类名活着，且该 @media 块里还混着 `.listing-card--list`——**不按块删** |

> ⚠️ 2026-08-22 终审 I2 补记：上面这一行**看见了现象却没追到后果**。`__success` / `__checks` 那两条被压过去确实无害
> （`__checks` 在 `.rc-page` 下本来就是单列），但 `padding: var(--sp-4)` 那条被压掉 = **移动端表单卡内边距
> 从 16 静默变成 40**，是一处没有任何人决定过的渲染变更。当时把「实际不生效」当成了「无所谓」，
> 而它真正的含义是「一条既有规则被本批打断了」。已在 `recruit.css` 用 (0,2,0) 重述修复，见工作项 §8.10。


### 2.4 实际删除

`src/app/(frontend)/styles.css` **−383 行**（5579 → **5196**）：

> 2026-08-22 终审 M1 订正：本节原写「−385 行（5579 → 5194）」，两个数都不对。
> `git show --numstat 688a75f` 对该文件是 **41 增 / 424 删 = 净 −383**，行数 5579 → 5196。
> 提交 688a75f 的提交信息里那句「-385 行」同样不准，历史提交不改写，以本节与工作项 §8.9 为准。


- `.city-partner-page` / `__intro` / `__copy` / `__eyebrow` / `__lead` / `__note` / `.city-partner-page h1`
  + `@media (max-width: 1023px)` 整块（块内三条全是该族）+ `@media (max-width: 640px)` 里的那一条
- `.city-coming-soon__` 旧四模块：`hero` / `hero-grid` / `intro` / `eyebrow` / `title` / `lead` /
  `benefits` / `benefit-card(:hover)` / `benefit-icon` / `benefit-content h3|p` / `tenant-note(button)` /
  `form-card` / `regions-section` / `section-header h2|p` / `district-grid` / `district-card(:hover)` /
  `district-header` / `district-name` / `district-status` / `district-sub` / `stats` / `stat-item` /
  `stat-number(span)` / `stat-label` / `dual-actions` / `action-panel(::before, --tenant, --landlord)` /
  `action-badge` / `action-btn-wrap` / `quick-links`
  + `@media (max-width: 900px)` 整块 + `@media (max-width: 600px)` 整块 + 767 档里的 `__quick-links > .btn`

删除处都留了注释说明「删了什么、判据是什么、证据在哪、为什么另外三个没删」。

## 3. 「清理不得改变任何渲染输出」的证明

`task6-shot-diff.mjs` 逐张比像素（`task6-shot-diff.json`）：

| 截图 | 尺寸 | 差异像素 | 最大通道差 |
|---|---|---|---|
| `city-partner-375` | 375 × 2889 | **0** | 0 |
| `city-partner-768` | 768 × 2617 | **0** | 0 |
| `city-partner-1440` | 1440 × 1818 | **0** | 0 |
| `city-partner-1920` | 1920 × 1818 | **0** | 0 |
| `hangzhou-375` | 375 × 3338 | **0** | 0 |
| `hangzhou-768` | 768 × 2928 | **0** | 0 |
| `hangzhou-1440` | 1440 × 2105 | **0** | 0 |
| `hangzhou-1920` | 1920 × 2105 | **0** | 0 |

**这个 0 不是「两张 404 页比出来的」**：同一轮探针第一步真读了 HTTP 状态码（7 条路由全部符合预期），
同一轮记录的对照选择器计数 > 0，且 fullPage 页高在 1818–3338 之间——页面确实渲染了。
两侧截图都在**改视口后 reload** 再拍（工作项 §5.5.2），页高逐档相同也说明布局未变。

## 4. 单测的同步处置

`tests/coming-soon-city-view.test.ts` 里 `styles readable responsive city sections and 44px action targets`
这条用例，原先逐字要求 `.city-coming-soon__{hero,district-grid,stats,benefits}` 四条 CSS 规则**存在**
——它钉的是已经不存在的版式。按现状重写（**只加不减地转成回归守卫**）：

- 四条 `toContain` → **`not.toContain`**（旧模块不得写回来）；
- 新增 `toContain('.city-coming-soon__media')` / `('.city-coming-soon__embedded-form')`（还活着的两支）；
- `expect(css).toContain('min-height: 44px')` → `expect(recruitCss).toContain('min-height: 44px')`：
  原断言打的是 `styles.css` 里随模块 4 一起删掉的两条 `> .btn { min-height: 44px }`，
  而招募页的 44 触控高度现在由 `recruit.css` 给（输入框 / 复选行 / 主 CTA）。继续打 `styles.css` 只会保护一个空壳；
- 尾部切片的 token 守卫（工作项 §5.1「新样式不得追加到 styles.css 末尾」）**原样保留**，
  只把正向锚从 `var(--color-paper)` / `var(--color-line)`（随删掉的规则一起没了）换成切片里**实际还在用**的
  `var(--color-ink)` / `var(--color-muted)`——没有正向锚时那三条 `not.toContain` 在空切片上恒真。

⚠️ 配套细节：styles.css 里新写的删除说明注释**刻意只写 `__stats` 后缀不写全类名**，
否则 `not.toContain('.city-coming-soon__stats')` 会永远命中注释自己，守卫等于失效。

## 5. 复跑方法

```bash
cd payload-office-platform
CI=1 NEXT_PUBLIC_SITE_URL=https://<线上域名> MULTI_CITY_ROUTING_ENABLED=false pnpm build
CI=1 PORT=3921 NEXT_PUBLIC_SITE_URL=https://<线上域名> MULTI_CITY_ROUTING_ENABLED=false pnpm start &
TASK6_TAG=before node ../artifacts/verification/OPT-038/task6-dead-css-probe.mjs   # 删 CSS 前
# ... 删 CSS，重新 build + start ...
TASK6_TAG=after  node ../artifacts/verification/OPT-038/task6-dead-css-probe.mjs
node ../artifacts/verification/OPT-038/task6-shot-diff.mjs
PORT=3921 E2E_PROD_SERVER=1 MULTI_CITY_ROUTING_ENABLED=false pnpm test:e2e
```
