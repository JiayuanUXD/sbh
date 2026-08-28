# OPT-060 浏览器验收证据

日期：2026-08-28。分支 `feat/opt-060-homepage-cover-config-3b8e`。

## 截图能力

**本轮执行环境 `computer screenshot` 不可用**（多次尝试，多个 tab，均报
"the Browser pane is not displayed, so the page is not compositing frames"，
与 `artifacts/verification/OPT-059/VISUAL-VERIFICATION-PENDING.md` 记录的同一个环境限制）。
`left_click`（坐标版）同样不生效——聚焦落在 `<body>` 而非目标输入框，判断是同一根因
（面板未合成帧，无法做真实的坐标命中测试）。

**替代方案**：改用 `javascript_tool` 里的原生 DOM API 驱动同一个浏览器 tab——
`querySelector` 定位真实按钮/输入框、用 React 兼容的 setter 派发 `input`/`change`
事件、调用元素的原生 `.click()`。这不是"读代码猜行为"，而是在**真实运行的浏览器
标签页**里，通过**真实的 DOM 事件**触发 React 的事件处理器，产生**真实的网络请求**
（登录、表单保存、图片选择均有对应的 `POST/PATCH` 请求，见下文各步骤）——只是没有
最终的像素级截图。

**因此没有证据支撑的结论**：卡片的视觉排版是否整洁、图片裁剪 focal point 是否合适、
是否有 CSS 层叠导致的视觉错位——这些只有真实截图才能确认，本轮**没有**验证。
以下证据全部是「配置生效」「DOM 结构 / `getComputedStyle` 实际返回值」「真实
HTTP 响应内容」，不是视觉截图。**待补清单见 `VISUAL-VERIFICATION-PENDING.md`**
（具体缺哪几张截图、每张看什么算通过、不依赖本次会话上下文的补做步骤）。

**但不是所有结论都需要截图**：断点验收项（`display:none`、卡片高度）测的是
CSS 规则在给定视口宽度下的**布局计算结果**，`getComputedStyle()` 触发的正是
真实布局计算、不依赖画面合成，所以"面板不合成帧"这条限制不影响它的真实性——
这组数据本身是可信的，第一轮遗漏的只是**没有把它落盘成可复核的文件**（只写在
报告叙述里）。已在 `step7-breakpoints-computed-style.txt` 补上原始输出。

## 各文件对应的验收项

| 文件 | 对应验收项 | 证明了什么 |
|---|---|---|
| `step3-shanghai-global-cover.html` | 验收项①后台实配 | `SiteSettings.typeCards[0].coverImage` 配为 `gallery-16.jpg` 后，`/shanghai`（=根路径 `/` 的目标城市）实际渲染的「传统办公」类型卡 `<img src>` 就是这张图 |
| `step3-hangzhou-city-override.html` | 验收项①城市覆盖只作用于该城市 | 给杭州 `CitySiteProfiles.typeCardOverrides` 配 `slot=traditional-office → floor-plan-2.jpg` 后，`/hangzhou` 的实际类型卡显示 `floor-plan-2.jpg`；同一次请求里 `shanghai-global-cover.html` 显示上海仍是 `gallery-16.jpg`，未被杭州的配置污染 |
| `step4-cache-invalidation-before.html` / `step4-cache-invalidation-after.html` | 验收项②只改封面立即生效 | 详见下方专门说明 |
| `step5-before-daning-featured.html` | 验收项③截断修复 - 对照组 | 造了一个新商圈「大宁」（有 1 栋在营楼盘，`recommendedOrder` 与其余 7 栋同为 0，但商圈按 `sortOrder=999` 排在原有 5 个成功商圈之后，即"候选池第 6 名"），**未设为精选**时确认 bento 仍是原来 5 张（虹桥/徐家汇/外滩/南京西路/陆家嘴），大宁不在其中 |
| `step5-after-daning-featured.html` | 验收项③截断修复 - 实验组 | 把「大宁」加进 `CitySiteProfiles.featuredRegions` 并保存后，bento 变为（大宁/虹桥/徐家汇/外滩/南京西路）——大宁进入 `hm-bento__main`（大卡位），陆家嘴被挤出前 5。这是本工作项的核心断言，候选池从 5 放宽到 20 后，「精选」真的能把第 6 名拉进来 |
| `step6-quality-gate-xinzhuang-excluded.html` | 验收项④质量门槛仍在 | 另造一个零在营楼盘的商圈「莘庄」，同样加入 `featuredRegions`，确认它**没有**出现在 bento 任何位置（`grep -c shanghai-xinzhuang` = 0）——「有货才能上榜」的门槛没有被"精选"绕过 |
| `step7-breakpoints-computed-style.txt` | 验收项⑤两个断点 | 375/767/768/1280px 四个视口宽度下，`.hm-type-card__media img` 与 `.hm-bento-card`（三档）的 `getComputedStyle()` 原始输出：≤767px 图片 `display:none`、bento 三档高度统一 232px；≥768px 图片 `display:block`、bento 三档恢复各自高度（480/232/280） |

## 验收项②（改封面立即生效）详细过程

spec §2.3 的旧结论是"待实测推断"，且明确要求必须在 `next start`
（`NODE_ENV=production`）下、由后台 UI 发起改动（与 Next 同进程）才算数——
2026-08-27 那次非正式实验用的是 `next dev` + 独立 tsx 脚本，两个条件都不满足。

本轮做法：

1. `git worktree add --detach E:/wt-opt060-verify <本分支>`，独立于主工作树
   （主工作树的 3717 dev server 当时正被另一个会话占用，不能停）。
2. worktree 内 `pnpm install` + `pnpm exec next build`，`.env.local` 设
   `NEXT_PUBLIC_SITE_URL=https://opt060-verify.local`（生产配置门禁要求 https
   且非 localhost）与 `CI=1`（跳过 COS 门禁——本地验证不必配腾讯云 COS，
   `CI=1` 是仓库既有约定，`src/lib/storage/cos-config.ts:83-85` 的注释写明
   这条路径就是给 `next start` 本地/CI 验证用的）。
3. `pnpm exec next start -p 3802`，同一个进程里登录 `/admin`（Payload 登录
   cookie 不分端口，`localhost:3717` 登录过的会话在 `localhost:3802` 直接可用）。
4. 记录改动前 `/shanghai` 的 HTML（`step4-cache-invalidation-before.html`）——
   商圈「外滩」当时 `Locations.coverImage` 为空，bento 卡回退显示楼盘自己的封面
   `cover-huangpu-bund-3.jpg`。
5. 在 `localhost:3802/admin/collections/locations/9` **只改**「封面图」一个字段
   （选择 `landing-hero-entrust-20260810.jpg`），点保存——**不碰**商圈名、显隐等
   任何其它字段（避免命中 `PUBLIC_LOCATION_FIELDS` 里原有字段而产生假阳性）。
6. 保存的 `PATCH /api/locations/9` 返回 200 后，**不等待**，立即
   `curl http://localhost:3802/shanghai` 存为 `step4-cache-invalidation-after.html`。

结果：bento 里外滩商圈卡（`href=".../listings?district=bund"`）的 `<img src>`
已经是新图 `landing-hero-entrust-20260810.jpg`。`cover-huangpu-bund-3.jpg`
在 after 文件里依然出现一次，但位置是楼盘卡片区（`href=".../buildings/huangpu-bund"`），
即楼盘自己的封面字段，与本次改动的商圈封面无关，不是陈旧缓存。

**结论：Task 1 的修复（`coverImage` 补进 `PUBLIC_LOCATION_FIELDS`）在满足
"生产模式 + 后台 UI 同进程发起"两个条件时，改动立即生效，不存在陈旧窗口。**
该结论已回填进 `specs/work-items/OPT-060-homepage-cover-configurability.md` §2.3。

## 数据清理

Step 5/6 用到的两个测试商圈（`shanghai-daning` id=813、`shanghai-xinzhuang`
id=816，均为本地库既有的隐藏商圈，验证时临时 `frontendVisible=true`）、
临时开通的杭州服务状态（`live`→验证后已还原 `coming-soon`）、shanghai 的
`featuredRegions`、外滩的 `coverImage`，验证结束后均已通过**真实后台 UI 保存**
（而非脚本，脚本改动不触发 `revalidateTag`，验证时也踩了一次这个坑，见下）
还原，并用 `curl` 复核首页确实回到验证前的 5 张商圈卡状态。为验证造的测试楼盘
（`opt060-daning-verify-building`）已删除。

站点设置的全局类型卡封面（传统办公→`gallery-16.jpg`、联合办公→`gallery-18.jpg`）
与杭州的类型卡覆盖（`floor-plan-2.jpg`）**保留未还原**——它们是验收项①要求
"实际配一遍并确认生效"的正常产物，无害，且杭州已还原 `coming-soon` 后该覆盖
不会在公开页面渲染。

**踩坑记录**：清理阶段第一次用独立脚本（`payload.update`，非 HTTP 请求）
还原数据，日志打出 `skipped_outside_request_scope`——`revalidateTag` 只在真实
请求上下文里才会调用，脚本改动虽落库但首页缓存没跟着刷新，一度看到"明明已经
还原、首页还是显示测试商圈"的假象。改为在浏览器里对同一条记录做一次真实的
勾选变化（先切 true 再切回 false，两次都是真实 `PATCH` 请求）后才刷新掉。
这正好是验收项②要验证的同一个缓存机制的反向印证。
