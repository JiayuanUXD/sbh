# OPT-038 Task 5 · 闸门与实测证据

基线 `274d44e`（Task 4）。以下每条都是本机实跑结果，脚本随证据提交。

## 1. 闸门

| 闸门 | 结果 |
|---|---|
| `pnpm typecheck` | 通过，零输出 |
| `pnpm test` | **245 passed / 2 skipped（3448 tests / 4 skipped）**，零失败（基线 244/3442） |
| `pnpm lint` | **22 warnings / 0 errors**，与基线 22 持平 |
| `pnpm build` | 成功 |
| **E2E（本地实跑生产 server）** | **141 passed / 14 skipped / 0 failed（2.8m）** |

E2E 环境：`pnpm build` 与 `next start` 均带 `CI=1` +
`NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com` +
`MULTI_CITY_ROUTING_ENABLED=false`；端口 **3919**（避开 3717）；**未覆盖 `DATABASE_URL`**（默认库 `postgres`）。
Playwright 侧 `PORT=3919 E2E_PROD_SERVER=1`，**不带 `CI=1`**，靠 `reuseExistingServer` 复用已预热的 server。

`admin-navigation.spec.ts:664`（Task 3/4 报告里那条先于本批存在的失败）本轮**通过**——
工作树里有一份**不属于本任务**的 `tests/e2e/admin-navigation.spec.ts` 改动（把叶子定位从
`getByRole('link', {name, exact:true})` 换成锚定 `.admin-navigation__link` 的 label 元素，
避开角标把 accessible name 撑长的问题）。该文件**未纳入本任务提交**。

## 2. 预热：真读 HTTP 状态码

`task5-acceptance.mjs` 的第一步，任一路由状态码与期望不符即 throw：

```
/ 200 · /listings 200 · /buildings 200 · /city-partner 200 · /hangzhou 200 · /admin 200
/dev-story/opt038 404（生产 build 下按设计）
```

`/listings`（房源类）与 `/buildings`（楼盘类）同为 200 —— memory 里
「房源全 404、楼盘全 200」的环境失配指纹不存在。

## 3. 四断点（375 / 768 / 1440 / 1920）× 两个消费面

数据见 `task5-acceptance.json`，截图见 `task5-shots/{city-partner,hangzhou}-{375,768,1440,1920}.jpg`。
**每次改视口后 reload 再测**（工作项 §5.5.2）。

| 项 | 375 | 768 | 1440 | 1920 |
|---|---|---|---|---|
| 页面级横向溢出 `scrollWidth − clientWidth` | **0** | **0** | **0** | **0** |
| `.rc-container` 宽 | 343（左右各 16） | 736 | **1024** | **1024** |
| `.rc-core` 轨道 | `343px`（单栏） | `736px`（单栏） | **`552px 400px`** | **`552px 400px`** |
| `.rc-aside` | `static` | `static` | `sticky / top 68px` | `sticky / top 68px` |
| `.rc-cta` | `column` · padding 24 | `row` · padding 40/48 | `row` · padding 40/48 | `row` · padding 40/48 |
| h1 数量 | 1 | 1 | 1 | 1 |
| `[role=status]` 数量 | 1 | 1 | 1 | 1 |

两个消费面的 h1：`/city-partner` = 「城市合作伙伴申请」；`/hangzhou` = 「商办租赁即将登陆杭州，诚邀本地城市合伙人」。

旧模块清零（每断点都查）：`.city-coming-soon__{benefits,stats,dual-actions,district-card,tenant-note}`
全为 **0**；正文不含「首批上线 / 规划服务区 / 30,000 / 98.5」。
（「筹备中」仍出现——那是城市下拉里 coming-soon 城市的既有后缀「杭州（筹备中）」，
来自 `CityPartnerApplicationForm.tsx:447` 的 `serviceStatus`，是真值不是编造的批次。）

## 4. specRows 逐条对回（1440 实测 `getComputedStyle`）

| specRows 行 | 权威值 | 实测 |
|---|---|---|
| 次要入口卡 | 稿子:230 `padding 40/48` · radius 18 · `gap 48` · 灰底 | `40px 48px` / `18px` / `48px` / `rgb(245,245,247)`（= 本项目 `--bg`，稿子的 `--bg-subtle`，**按颜色映射**） |
| 卡内两行 | 稿子:231 `gap 6` | `6px` |
| 卡标题 / 说明 | 24 / 600 / 1.2 · 17 / 1.47 `--ink-2` | `24px 600 28.8px` / `17px 24.99px rgb(110,110,115)`，字距均 normal，标题标签 **H2** |
| 次级按钮 | `pill · padding 11/21 · 1px --line-strong` | `11px 21px` / `980px`(`--r-pill`) / `1px rgba(0,0,0,0.16)` / `17px 400` / `min-height 44px` / `inline-flex` / 色 `rgb(0,102,204)`(`--accent-link`) |
| 隐私 / 合规说明 | `12 / 400 / 1.33 / --ink-3` | `12px / 15.96px / rgb(134,134,139)`，`margin-top 16px` |
| 商圈布局网格 | `3 列 · gap 48/24 → 列宽 325.33` | `325.328 325.328 325.344`（1440/1920）；768 下 `229.328×3`；≤767 塌单列 `343px` |
| 尾注段 | 「不设 padding-top，与上一段间距 = 1×pad」 | `padding: 0px 0px 72px` |

### 4.1 一处**修复**：下拉箭头曾被静默删掉

`#partner-city` 的 `background-image` 实测为 **`none`** —— Task 3 的
`.rc-page .city-partner-form .filter-bar__select { background: var(--bg-subtle) }` 用了**简写**，
把 `.filter-bar__select` 的三角 `background-image`（`styles.css:992`）一并复位。
Task 3 报告写的是「保留了既有三角，只挪了位置」，实际上 select 在真实路由上和单行输入框长得一模一样。
改成 `background-color` 后复测：`url("data:image/svg+xml,…")` + `calc(100% - 14px) 50%` ✔。
**本文件所有截图都晚于这次改动。**

## 5. sticky 实测

1440 逐点采样（`task5-acceptance.json` 的 `sticky`）：

| 消费面 | `.rc-aside` computed | 左栏高 | 卡高 | `.rc-aside` 高 | `.rc-core` 高 | 可移动余量 |
|---|---|---|---|---|---|---|
| `/city-partner` | `sticky / top 68px` | 533 | 735 | **767** | **767** | **0** |
| `/hangzhou` | `sticky / top 68px` | 533 | 735 | **767** | **767** | **0** |

滚动采样里 `asideTop` 与 `coreTop` **逐点相等**（0/200/400/600/800/1200… 全程），
即卡从未从行顶脱开、**从不粘附**。这正是工作项 §3.5.1 的裁定：
只有 3 条价值点时右列比左列高，可移动余量为负/零 ⇒ sticky 不生效**是定义使然**。

375 下两个消费面 `.rc-aside` 均为 `position: static` ✔（≤1023 断点取消 sticky）。

**留白评估（brief 要求的自读结论）**：1440 下左栏 533、行高 767 ⇒ 左栏底部留 **234px**（占行高 30%）。
自读 `city-partner-1440.jpg` / `hangzhou-1440.jpg`：灰底带由白色表单卡锚定，
左栏末条正文与卡内主 CTA 大致齐平，**不构成失衡**，未做改动。
（若判为失衡，可行的修法只有纵向对齐——而 `align-items: start` 是 sticky 的地基，
改成 center 会在价值点变多时把 sticky 一并废掉。**没有为让 sticky 生效而编造左栏内容。**）

## 6. 状态走查

| 状态 | 做法 | 结论 |
|---|---|---|
| **无 `featuredRegions` 的城市** | `/hangzhou` 默认状态（本地库 7 个 profile 全空） | 商圈段**整段不渲染**，`.rc-section` 计数 3（Hero / 两栏带 / 尾注），无空货架 ✔ |
| **有 `featuredRegions`** | `task5-districts-probe.ts`：临时写入 6 个真实杭州商圈 + 两条区域介绍 → 四断点截图 → `finally` 还原并**自查还原结果** | 四断点均 6 格；1440/1920 三列 325.33、768 三列 229.33、375 单列；区位三态齐全（「上城区 · 钱塘江北岸…」两段 /「西湖区」一段 / 行政区两段皆缺 ⇒ 整行不渲染）；**全文无 `—`** ✔ |
| **已开通城市** | `/city-partner` 默认城市 = `siteConfig.defaultCity` = 上海（`live`） | Hero 走中性文案、无「即将登陆上海」这种假话；本页**不渲染**商圈段（理由写在 `page.tsx` 文件头）✔ |
| **超长城市名** | `hangzhou-1440-long-city-name.jpg`：真实路由 DOM 上把文案替换成「乌鲁木齐」版后重量行盒（布局探针，非伪造数据） | h1 两行 `616 / 616`（`text-wrap: balance` 配平，高 120）；CTA 标题单行 432；**横向溢出 0** ✔ |
| **表单 · 校验失败** | 空表单提交 | 4 条 `.field__error`（姓名 / 手机号 / 身份 / 同意），`[role=status]` 仍为 1，溢出 0 ✔ |
| **表单 · 限流** | 拦 429 | 「提交过于频繁，请稍后再试。您填写的内容仍保留在本页。」；姓名值保留；`[role=status]` 仍为 1 ✔ |
| **表单 · 第二步** | 重试成功后进第二步 | 卡宽仍 **400**、高 1137，6 项资源单列不折行 ✔ |
| **表单 · 提交成功** | 跳过第二步 | `.city-partner-form__success` 400×157，`[role=status]` 仍为 1 ✔ |

浏览器 console：整轮只有一条 `429 (Too Many Requests)` —— **本脚本自己拦出来的限流态**，非页面错误。

## 7. 已知的取证陷阱（新踩到两条，建议进 `.agent/`）

1. **`unstable_cache` 的条目落盘在 `.next/cache`，换一个 server 进程也还在。**
   `task5-districts-probe.ts` 第一版在临时写库后**新起**了一台 server，第一次请求
   `/hangzhou` 仍然拿到旧 profile（0 个商圈格），从第二次起才是新数据（stale-while-revalidate）。
   差点被读成「375 断点下商圈段不渲染」——而 section 渲不渲染是服务端决定的，与视口无关。
   **判据**：同一份数据在 375 与 768 上结论不同 ⇒ 先怀疑缓存的第一拍，不要怀疑断点。
2. **全站 `scroll-behavior: smooth` 会让 `window.scrollTo` 变成动画**：只等两帧就读，
   会得到「请求 2400、实际 235」的假位置，sticky 采样整段作废。测滚动前先把
   `document.documentElement.style.scrollBehavior = 'auto'`。
3. **「还原成观察到的原值」的探针必须先断言干净起点。** 第一版探针把上一轮残留的脏值
   （`frontendVisible: true`）当成原值写回去，一路级联。现已加起始状态守卫 + 还原后自查，
   两者任一不满足直接抛。本地库已确认还原干净（`featuredRegions: []`，4 个节点 `fv=false / desc=null`）。
