# Task Packet：OPT-079 散落字面量收成 token，横滑轨道收成共享基元

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：eBay 前端对标分析第三批（清单项 D2 / D5 / S7）

---

## 1. 一句话

把两枚散落的颜色字面量收成 token（零视觉变化），把两条横滑轨道的共享行为收成
`.sf-rail` 基元（修掉「一个隐藏滚动条、一个没有」的偏差）。

## 2. 三条收口

### 2.1 `--bg-hover`：`#ececf0` 散落 7 处

`styles.css` 顶部写着「颜色一律走 token，禁止散落字面量」，而 `#ececf0` 以字面量出现在
筛选 chip / 开关 / 空态按钮 / 移动面板重置 / 供给筛选片共 7 处。**仓库自己的注释已经点名了
这件事**（`styles.css:1973`：「同一枚字面量 `#ececf0`」），只是当时没收。

语义就是那条注释写的：**pill 型控件在 `--bg` 白灰底上的 hover 档**。同色阶的下一档是
`--line`（激活态底）与 `--line-strong`（激活态 hover）。取值未变，纯收口。

### 2.2 `--media-placeholder`：`#8e8e93` 散落 4 处

`.sf-media` / `.building-summary-card__media` / `.hm-bento-card` 等各写一遍同一个值。

**刻意保持中深灰，不改浅灰。** 对标分析里提过「跟 eBay 一样换成浅灰 + shimmer」——
不采纳：图上标签 `.sf-phototag` 是 `rgba(255,255,255,.92)` 的白 pill，浅底会让它糊掉。
现有的深灰是与那枚标签配套的选择，不是随手取的值。这条写进 token 注释，免得下次又有人提。

### 2.3 `.sf-rail`：横滑轨道的共享行为

全站只有两条横滑轨道，且**已经**大部分一致（都有 `scroll-snap-type: x mandatory` 与
逐卡 `scroll-snap-align`）。实际偏差只有一处：首页轨道 `.hm-rail__track` 隐藏了原生
滚动条，周边楼盘条带 `.nearby-strip` 没有——同一个「横滑看卡」的手势，一个干净、
一个挂着灰条。用户要求卡片/投影/动效全站统一，这条属于同一类。

`.sf-rail` 只放两者**都需要且必须一致**的四条：横向滚动、逐卡吸附、隐藏滚动条、
容器内平滑滚动。**不放**轨道两端的对齐留白与卡宽——首页要跟 `.hm-container` 的居中容器
对齐，详情页条带是在 `.dt-container` 内整宽排布，参照系不同，硬统一只会让一边错位。

`scroll-behavior: smooth` 放进基元是安全的：全站禁用的是**根元素**的平滑滚动
（会把浏览器的历史滚动恢复也动画化），嵌套滚动容器不受那条约束。

## 3. 第三批其余各项：核对后不做

| 项 | 核对结果 |
|---|---|
| D3 语义色补 success / info | 现有成功态（`.modal__success` 等）走的是单色体系。设计系统明文「唯一彩色 `--accent`，新体系没有第二彩色」，加绿色是引入第二个色相——**需要产品定，不该由 agent 加** |
| D6 容器查询 | 全站零使用属实，但**没有可证的问题**：同一张卡目前没有在差异极大的宽度里复用。为「将来可能有用」加抽象是过早优化 |
| D7 focus-visible 审计 | **已经是对的**。21 处 `:focus-visible`，3 处裸 `:focus` 全部合理：全局 `:focus { outline: none }` 是与 `:focus-visible` 配对的标准写法，两处输入框的 `outline: none` 由外层 `.hm-search__pill:focus-within` 的 `--focus-ring` 接管 |
| M3 reduced-motion 分级 | 是真缺口（全局通配 `!important` 把所有过渡压到 0.01ms），但它是**全站无障碍行为变更**，而我无法在不改用户系统设置的前提下验证效果。不做，留给能真机验证的批次 |
| S10 列表页补 BackToTop | 移动端 `.back-to-top`（`bottom: 72px`）会与列表页底部悬浮筛选触发器打架，需要先定两者的共存方案，不是一行 CSS |
| S8 桌面图集竖排 filmstrip | 是真缺口，但属于版式改动而非收口，与本工作项性质不同，另开 |

## 4. 验收（实测计算值，零视觉变化是硬要求）

| 项 | 实测 |
|---|---|
| token 解析 | `--bg-hover: #ececf0`、`--media-placeholder: #8e8e93` |
| 占位色未变 | `.sf-media` / `.hm-bento-card` / 列表卡图 均为 `rgb(142, 142, 147)` |
| hover 规则 | 7 条规则全部变成 `background: var(--bg-hover)`（含 `.building-supply-browser__filter`） |
| 首页轨道 | flex / auto / `x mandatory` / smooth / `scrollbar-width: none` / gap 16 / `scroll-padding-left` 与 `padding-left: 48px` **保持** |
| 首页轨道项 | `flex-basis: 400px`、`scroll-snap-align: start`、实测宽 400 **保持** |
| 周边条带 | flex / auto / `x mandatory` / smooth / **`scrollbar-width: none`（本次修掉的偏差）** / gap 12 / padding 4 **保持** |
| 周边条带项 | `flex-basis: 200px`、`scroll-snap-align: start`、实测宽 200 **保持** |

`pnpm typecheck` 干净；`pnpm test` 343 文件 / 4705 用例通过。

> 走查用 3000 端口：3717 被另一个会话的 worktree dev server 占着（横向滚动那个任务），
> 按仓库「多 worktree 各用独立端口」的纪律没有去动它。
