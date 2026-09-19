# 2026-09-19 前台小批量修整：验证记录

同一 PR（#202）里的三件独立改动（用户决定合成一个 PR，历史上仍是三个提交）。

## 如何复现（Codex 审查 P1：证据脚本必须入库）

本目录的数字与截图全部由下面三个脚本产出，每次导航都过 `../OPT-037/lib/sentinel.mjs` 的共享渲染哨兵
（HTTP 状态码 + 路由族关键选择器），哨兵不过直接抛，不会把 404 / 软 404 当页面拍下来。
只依赖仓库自带的 `@playwright/test` 与 Node（PNG 解码在 `lib/png.mjs` 里手写，不用 PIL / pngjs）。

```bash
# dev server 先起在 3717（pnpm dev）
node artifacts/verification/frontend-polish-2026-09-19/gallery-hover.mjs          # ① → shots/gallery-hover-report.json（判据不符退出 1）
node artifacts/verification/frontend-polish-2026-09-19/header-shots.mjs after     # ③ → shots/after-*.png + after-report.json
node artifacts/verification/frontend-polish-2026-09-19/compose.mjs                # 拼 before/after 对照图
```

`before` 的产法：本地库先 `pnpm exec payload migrate:down`（把 `footer_tagline_suffix` 列补回来，否则 master
的 Global 读不到列），`git restore --source=origin/master -- payload-office-platform/src`，冷重启 dev server，
跑 `header-shots.mjs before`；随后 `git restore --source=HEAD -- payload-office-platform/src`、冷重启、
`pnpm exec payload migrate`。`shots/before-report.json` 就是这么来的。

每个 `*-report.json` 里逐条记着：哨兵结果（status / family / missing）、搜索框计算样式、取样矩形（截图像素）、
井内均值、对当时 `--ink` / `--ink-2` / `--ink-3` 计算值的对比度。取样矩形按占位文字的 canvas measureText
宽度定位到文字右侧空白带——第一版按固定偏移取，压到了「址」字笔画上，均值偏暗 6–7 个色阶，已改。

## ① 详情页主图 hover 缩放：指针移到左右箭头上不再缩回

- 根因：`styles.css` 的放大触发器挂在主图 `<button class="detail-gallery__main-media">` 自身的 `:hover` 上；左右箭头是 `<figure class="detail-gallery__main">` 下与之平级的覆盖层（`inset:0` + 按钮 `pointer-events:auto`），`:hover` 只沿祖先链传播，指针到箭头上按钮即失去 hover → `scale(1)`，320ms 过渡变成肉眼可见的「缩回去」。
- 修法：触发器提到 figure：`.detail-gallery__main:hover .detail-gallery__main-media img`。
- 证据（`gallery-hover.mjs`：真实鼠标 `page.mouse.move`，每步等 450ms > 320ms 过渡；本地 dev `/shanghai/listings/media-rich-listing`）：

  | 指针位置 | `btn.matches(':hover')` | `fig.matches(':hover')` | `img` transform |
  |---|---|---|---|
  | 图片中心 | true | true | `matrix(1.04,…)` |
  | 左箭头 | **false**（旧选择器在此必失配） | true | `matrix(1.04,…)` |
  | 右箭头 | **false** | true | `matrix(1.04,…)` |
  | 移出图片区 | false | false | `none` |

- 守卫：`tests/detail-gallery-motion.test.ts`（先红 3 项 → 修后 5/5 绿）。
- 触摸端沿用全站惯例（站内没有任何 `(hover: hover)` 守卫）：点箭头后图片保持 4% 放大直到点别处，与此前点主图本身的行为一致。

## ② 关闭详情页分享 / 收藏

- 摘除 `CityListingDetailView` / `BuildingDetailLayout` 标题栏的 `<ShareSaveActions>`；删除组件、`styles.css` 的 `.share-save-actions*` 块（52 行）、E2E `detail-share-save.spec.ts`。
- 新守卫 `tests/detail-share-save-removed.test.ts`（防旧分支合并时把挂载带回来）。
- 证据：本地 dev 两个详情页 `.dt-titlebar__actions` 内按钮只有 `["信息纠错"]`，全页无「分享 / 收藏」按钮，控制台无错误。
- **非目标**：会员「我的收藏」页 / 菜单 / `/api/member/favorites` / 登录时合并本地收藏（`saved-details.ts`）未动。详情页是唯一的「加入收藏」入口，关掉后新用户的「我的收藏」恒为空态，已有收藏仍可查看 / 移除。

## ③ 页脚去掉「页脚副标题后缀」+ 顶栏搜索框磨砂化

### 页脚
- Global 字段、视图类型、兜底值、mapper、`SiteFooter` 渲染整链移除；迁移 `20260919_153235_footer_tagline_suffix_removed`（`DROP COLUMN`）已在 `DESTRUCTIVE_MIGRATION_APPROVALS.json` 登记（用户会话内明确批准；生产该列现值「商办空间」，随删列丢失）。
- 证据：本地 `pnpm exec payload migrate` 通过；后台「站点设置 → 页脚」实测只剩「页脚品牌说明 / 版权主体 / ICP 备案号」；页脚底栏 innerText（`*-report.json` 的 `footerBar.innerText`）由 `© 2026 商办租赁平台 / 上海 · 商务办公租赁 / 员工入口` 变为 `© 2026 商办租赁平台 / 员工入口`。

### 顶栏搜索框
- 原状：`background: var(--bg)`（实心 `#f5f5f7`）贴在 55–75% 白的液态玻璃头部上，不透、不折射。
- 改为半透白磨砂胶囊（`--header-well*` 五个 token）：`rgba(255,255,255,.62)` 基态 / `.74` hover / `.92` 聚焦；6% 黑描边；顶边内高光与 `--header-shadow` 同语言。占位色 `--ink-3` → `--ink-2`。
- **否决过的方案**：4.5% 黑的暗井（macOS 工具栏搜索框语言）。首页滚动后玻璃压在 hero 上，井底实测 (179,184,189)，占位文字对比只剩 **2.54:1**。
- 采纳方案的实测（`header-shots.mjs`，1440 视口 2x，井内像素均值；`shots/{before,after}-report.json`）：

  | 场景 | before 井底（占位 `--ink-3`） | after 井底 | after 占位 `--ink-2` | after 输入文字 `--ink` |
  |---|---|---|---|---|
  | 首页滚动后（玻璃压 hero） | (245,245,247) 实心，4.66:1 | (229,231,233) | **5.11:1** | 13.58:1 |
  | 房源列表页（浅灰底） | 同上 | (254,254,254) | 6.28:1 | 16.69:1 |
  | 列表页 hover | 同上 | (254,254,255)，bg `.74` | 6.28:1 | 16.70:1 |
  | 列表页聚焦 | 同上 | (255,255,255)，bg `.92` | 6.33:1 | 16.83:1 |

  before 四个场景井底恒为 (245,245,247)——实心 `--bg` 完全不随背景变化，这就是「纸片」的数据形态。

- 前后对照见同目录 `header-search-footer-before-after.png`。

## 闸门
- `typecheck` ✓、`eslint` ✓（改动文件）、`test:changed` 全绿、`migrate:dry-run` ✓（仅历史迁移的既有 warning）。
