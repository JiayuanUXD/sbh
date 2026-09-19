# 2026-09-19 前台小批量修整：验证记录

同一 PR 里的三件独立改动（用户决定合成一个 PR，历史上仍是三个提交）。

## ① 详情页主图 hover 缩放：指针移到左右箭头上不再缩回

- 根因：`styles.css` 的放大触发器挂在主图 `<button class="detail-gallery__main-media">` 自身的 `:hover` 上；左右箭头是 `<figure class="detail-gallery__main">` 下与之平级的覆盖层（`inset:0` + 按钮 `pointer-events:auto`），`:hover` 只沿祖先链传播，指针到箭头上按钮即失去 hover → `scale(1)`，320ms 过渡变成肉眼可见的「缩回去」。
- 修法：触发器提到 figure：`.detail-gallery__main:hover .detail-gallery__main-media img`。
- 证据（本地 dev `/shanghai/listings/media-rich-listing`，真实指针悬停后读计算样式）：

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
- 证据：本地 `pnpm exec payload migrate` 通过；后台「站点设置 → 页脚」实测只剩「页脚品牌说明 / 版权主体 / ICP 备案号」；页脚底栏 innerText 由 `© 2026 商办租赁平台 / 上海 · 商务办公租赁 / 员工入口` 变为 `© 2026 商办租赁平台 / 员工入口`。

### 顶栏搜索框
- 原状：`background: var(--bg)`（实心 `#f5f5f7`）贴在 55–75% 白的液态玻璃头部上，不透、不折射。
- 改为半透白磨砂胶囊（`--header-well*` 五个 token）：`rgba(255,255,255,.62)` 基态 / `.74` hover / `.92` 聚焦；6% 黑描边；顶边内高光与 `--header-shadow` 同语言。占位色 `--ink-3` → `--ink-2`。
- **否决过的方案**：4.5% 黑的暗井（macOS 工具栏搜索框语言）。首页滚动后玻璃压在 hero 上，井底实测 (179,184,189)，占位文字对比只剩 **2.54:1**。
- 采纳方案的实测（Playwright 1440 视口，2x，取井内像素均值）：

  | 场景 | 井底均值 | 占位 `--ink-2` | 输入文字 `--ink` |
  |---|---|---|---|
  | 首页滚动后（玻璃压 hero） | (229,231,233) | **5.11:1** | 13.58:1 |
  | 房源列表页（浅灰底） | (254,254,254) | 6.28:1 | 16.69:1 |

- 前后对照见同目录 `header-search-footer-before-after.png`。

## 闸门
- `typecheck` ✓、`eslint` ✓（改动文件）、`test:changed` 全绿、`migrate:dry-run` ✓（仅历史迁移的既有 warning）。
