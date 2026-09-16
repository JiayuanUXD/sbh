# OPT-099 验证证据

日期：2026-09-16 · 分支 `feat/opt-099-frontend-polish-4050` · 基线 `28dfecd`

取证工具：**Playwright（本地 Chromium，1440×900）** 打 `http://localhost:3730`（wt-099 的 dev server），
以及真实浏览器窗口（Browser pane）用于指针交互。

> **不用 Browser pane 量生产站**：它会拦掉站点自己的样式表（实测 `cssRules` 抛 `blocked`、
> `.sf-media` 的 `aspect-ratio` 读成 `auto`、`display` 读成 `inline`），量出来的是无 CSS 的假数字。
> 生产站的取证一律走本地 Playwright。

---

## ④ 卡片等高：`.sf-media` 的 16:10 实际未生效

### 生产站现状（修复前，`https://shangban.cc/shanghai/listings`）

一页 24 张 `.ls-card`，`.sf-media` 声明 `aspect-ratio: 16/10`（期望盒高 202.5px @ 列宽 324）：

| 实测盒比例 | 1.333 / 1.341 / 1.348 / 1.484 / 1.500 / 1.530 / 1.600 …共 **8 种** |
|---|---|
| 实测盒高 | 202.5 / 211.8 / 216 / 218.4 / 240.3 / 241.7 / 242.9 / 243 |
| 卡片高 | **329.3 与 356.3 两档** |

每种实测比例都正好等于那张封面的**原始比例**（`768x512`→1.500→216px；`1620x1092`→1.484→218.4px）。

### 本地对照实验（同一页、同一时刻、只切换本次两条声明）

本地夹具封面全是 `768x432`（16:9，比 16:10 更扁，顶不高盒子），
因此**先注入 6 种「比 16:10 更高」的图**（1200x800 / 1200x900 / 800x1000 / 1600x1200 / 900x900 / 1500x1000），
否则本地永远复现不出该缺陷 —— 这也正是它能活到今天的原因。

| | 修复后 | 对照组（`overflow:visible` + `img{position:static}`，即撤回本次两条声明） |
|---|---|---|
| 盒比例 | **1.600（1 种）** | 1.500 / 1.333 / 0.800 / 1.000（**4 种**） |
| 媒体盒高 | **202.5（1 种）** | 216 / 243 / 405 / 324（**4 种**） |
| 卡片高 | **315.8（1 种）** | 518.3 / 437.3（**2 种**） |
| `img` position | absolute | static |
| `.sf-scrim` 高 | 45% | 45% |
| `.sf-phototag` | 可见 | 可见 |

撤回对照样式后三项全部复原为单一值 —— **对照组确实是未修复状态**，不是环境差异。

截图：`04-media-ratio-BEFORE-1440.png` / `04-media-ratio-AFTER-1440.png`
（BEFORE 四张卡参差、价格行被挤出视野；AFTER 四张等高、价格落在同一基线）

---

## ① hover 投影被滚动容器裁切

`.hm-rail__track` 计算样式 `overflow-x: auto` **连带把 `overflow-y` 提升成 `auto`**（实测 `overflowY: "auto"`），
于是它是一个纵向裁切盒。量 hover 卡片投影外沿与容器裁切边的距离：

| | 修复后（`padding-block: 6px 30px`） | 对照组（恢复 `4px 12px`） |
|---|---|---|
| 上缘余量 | **0**（恰好贴合） | **−2**（切掉 2px） |
| 下缘余量 | **0**（恰好贴合） | **−18**（切掉 18px） |
| `fullyInside` | **true** | **false** |

`--shadow-hover: 0 14px 36px` + hover `translateY(-2px)` → 需上 6 / 下 30。
实测余量为 0 说明 `6px 30px` 正是**刚好够用的最小值**，没有多留。

截图：`01-rail-hover-BEFORE-1440.png` / `01-rail-hover-AFTER-1440.png`

`.nearby-strip`（楼盘详情「周边楼盘」）同一成因、同一处置，规则已改为同一 token。

---

## ③ 二级导航跳转后自动收起

headless Playwright **复现不出**这个场景：客户端导航后它的虚拟指针不再命中重新渲染的分组
（`stillHovered: false`），菜单是因为 hover 结束才关的，走不到抑制逻辑。
因此改用**真实浏览器窗口**，点完之后一次都不动鼠标：

| 时机 | `:hover` | `data-nav-suppressed` | menu visibility |
|---|---|---|---|
| hover 父项 | true | — | visible |
| 点「找楼盘 → 租赁」跳到 `/shanghai/buildings` 后**（指针未离开）** | **true** | **true** | **hidden / opacity 0** |
| 指针移开 | false | false | — |
| 指针移回 | true | false | visible（子项「租赁」高亮） |

第二行是关键：`:hover` 仍然命中、菜单仍然收起 —— 修复前这一行会是 `visible`。

键盘路径（`e.detail === 0`）不抑制：Tab 到子项 → 菜单 visible → Enter 导航后
`suppressed: false`、menu 仍 `visible`、`document.activeElement` 的 `visibility` 为 `visible`
（焦点没有落在隐藏元素上）。

截图：`03-nav-collapsed-after-navigate-1440.png`

---

## ② 去掉「排序」文案

`/listings` 工具条右侧实测 `textContent` = `"推荐最新"`（原为 `"排序推荐最新"`）：

- `.ls-toolbar__sortlabel` 已无任何节点，CSS 规则一并删除
- 排序链接包在 `role="group" aria-label="排序"` 内 —— **可见文案没了，可访问名还在**
- 两个排序项间距实测 **16px**，与改前一致（分组自带 `gap`，没有被外层 gap 吃掉）
- 楼盘详情供给区同款控件一并去掉，其 `role="group" aria-label="排序"` 本来就有
  （`tests/e2e/detail-pages.spec.ts` 与 `supply-filter-scroll.spec.ts` 正是按这个 role 定位，不受影响）

截图：`02-listings-toolbar-1440.png`

---

## ⑤ 商圈筛选（级联）

| 步骤 | URL | 筛选行 | 商圈候选 | chips |
|---|---|---|---|---|
| E1 未选区 | `/shanghai/listings` | 位置 / 类型 / 面积下限 | **整行不渲染** | — |
| E2 选「长宁」 | `?district=changning` | 位置 / **商圈** / 类型 / 面积下限 | 虹桥 4 | 位置：长宁 |
| E3 选「虹桥」 | `?district=changning&businessArea=hongqiao-area` | 同上 | 虹桥 4 | 位置：长宁、**商圈：虹桥** |
| E4 切到「徐汇」 | `?district=xuhui` | 同上 | 徐家汇 4 | 位置：徐汇 |

- E3 的 chip 印出的是**商圈名「虹桥」**而不是维度名 —— 词表随扫描行而来，零额外查询
- E4 的链接 href 实测为 `/shanghai/listings?district=xuhui`，**`businessArea` 已被级联清除**
- 375 移动抽屉（`/shanghai/listings?district=changning`）：行序为 位置 / **商圈** / 类型 / 面积下限，
  「长宁 4」为激活态；在抽屉里点「虹桥」后 URL 变为 `?district=changning&businessArea=hongqiao-area`、
  底栏变「查看 4 套」，且 **抽屉保持打开**（`.agent/frontend.md` 点名的「每选一个条件抽屉就关一次」
  那条不变量未被破坏）

截图：`05-filter-business-area-1440.png` / `05-filter-business-area-375.png`

### 走查中发现并修掉的一个缺陷

第一轮走查发现：选中商圈后「位置」行**塌成只剩已选的那一个区**，用户再也切不走。

根因是区域候选的计数只剥了 `district`、没剥 `businessArea` —— 那个商圈只属于当前这个区，
于是其余区计数全为 0、被「计数为 0 不渲染」规则滤掉。这正是本仓库既有的
「facets 必须算在筛选之前」那条规则在**从属维度**上的翻版。

已改为 `facetsOmitting(['district', 'businessArea'])`，修复后 E3 的位置行仍保有全部 4 个区（见上表）。

---

## 静态闸门

- `pnpm typecheck` 干净
- `pnpm test:changed` 155 文件 / 1891 用例全绿（含新增 `tests/opt099-frontend-polish.test.ts` 19 条、
  `tests/opt068-listing-scan.test.ts` 新增 3 条、`tests/card-equal-height.test.ts` 新增 3 条）
- `pnpm build` 通过
- E2E 自查：`detail-pages` / `supply-filter-scroll` 按 `role=group name=排序` 定位（分组保留，不受影响）；
  `landing-pages` 断言 `.site-nav__sub[aria-current]` 文本（不涉及可见性，不受影响）

## 仍需线上复测

④ 的真实收益只有在**有「比 16:10 更高」的封面**的环境才看得到。本次上线后，
用同一份 Playwright 脚本复测生产站 `/shanghai/listings`，预期
「盒比例 8 种 → 1 种、卡片高 2 档 → 1 档」。


---

## 走查中顺带发现的既有缺陷（**不在本项内**，已由 PR #193 `e2dbeb1` 单独修复并合入）

旧式无城市段的列表链接在 307 重定向时会**静默丢掉 `district`**，而 `type` 保留：

```
https://shangban.cc/listings?district=changning  →  307 → /shanghai/listings              （丢了）
https://shangban.cc/listings?type=coworking      →  307 → /shanghai/listings?type=coworking（保留）
```

发现时生产站（master 基线 `28dfecd`）与本地 dev 表现一致，**与 OPT-099 无关**；本分支已 rebase 到含该修复的 master 之上。
后果：多城市路由上线前分享出去的带区域筛选的链接，点开会得到全量结果且页面无任何提示。
推测与「路由层拿城市区域词表校验 district、重定向时城市尚未确定」有关（`type` 走静态白名单故幸存），
但未验证，不要当结论。
