# 首页资讯左右等高布局与资讯中心主推配置验证报告

- **日期**：2026-10-08
- **分支**：`feat/home-news-layout-4a9e`
- **基线**：`origin/master` (`c71c8c75`)
- **状态**：全部实现完成并通过全量自检；未提交、未推送、未部署。

---

## 1. 需求实现概述

1. **后台主推配置收敛至资讯中心（Articles 集合）**：
   - 在 `Articles` 集合中增加 `isHomeFeatured`（布尔开关）字段，描述为「设为首页主推」。
   - `admin.defaultColumns` 配置展示 `isHomeFeatured` 列，运营在列表视图即可一目了然。
   - `afterChange` 挂载 `syncHomeFeaturedExclusivity` Hook，当某篇文章勾选主推时，自动将其余文章设为 `false`，全库保证至多 1 篇为有效主推。
   - 完全解耦 `SiteSettings`，站点设置恢复职责单一。
2. **前台左右等高布局与标题字号一致**：
   - 桌面端（1280px）`.hm-news__grid` 设为 `align-items: stretch`，左右两栏总高度均为 `398.89px`，高度差精确为 **0px**。
   - 左侧卡片封面大图保持 16:9 比例，日期设置 `margin-top: auto` 贴底，与右侧最末行底边完全水平平齐。
   - 右侧列表 5 个条目通过 `flex: 1` 纵向均分空间，首行与左侧图片顶对齐，末行与左侧日期底对齐。
   - **左侧大图标题字号设为 `19px`**（`font-weight: 600; line-height: 1.3`），与右侧列表标题字号完全一致。
   - 移动端（375px）自适应单列流式堆叠，字号统一为 `17px`，无横向溢出。
3. **公开数据流与自动降级**：
   - `SupplyAdapter` 新增 `findHomeFeaturedArticle()`，仅查询已发布、未软删除且 `isHomeFeatured: true` 的文章并展开封面。
   - `getHomepage` 并行获取主推与最新 5 条文章；若无有效主推，自动回退展示最新文章第一篇。

---

## 2. 门禁与命令执行记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 依赖与类型生成 | `pnpm generate:types && pnpm payload generate:importmap` | 通过，无新增 client 组件导入 |
| 类型检查 | `pnpm typecheck` | 0 错误通过 |
| 静态检查 | `pnpm lint` | 0 错误（35 条既有历史警告） |
| 全量单测 | `pnpm test` | **402 个测试文件全部通过，5296 个测试全部通过** |
| 迁移静态检查 | `pnpm migrate:dry-run` | 通过（`20261008_091723_home_featured_article_flag` 无禁止规则） |
| 生产构建 | `pnpm build` | Next.js 16.2.10 Turbopack 构建成功 |

---

## 3. 浏览器与实时交互验收记录

1. **后台资讯中心管理（`http://localhost:3717/admin/collections/articles`）**：
   - 列表表格正确显示 `设为首页主推` 列，直观展示各文章状态。
   - 点击文章 2（《初创公司如何选第一间正式办公室？》），勾选「设为首页主推」并保存。
2. **前台首页桌面端测量（1280px 视口）**：
   - `featuredHeight`: `398.890625px`
   - `listHeight`: `398.890625px`
   - `heightDiff`: **0px**（完美等高）
   - `featuredTitleFontSize`: **19px**
   - `listTitleFontSize`: **19px**
   - `bottomDiff`: **0px**（左侧日期底部与右侧最末行底部完全平齐）
   - 左侧主推文章 ID 变为 2，封面真实加载，右侧为除主推外的最新 5 条资讯（2026-10-08 补充：右侧去重，见第 6 节）。
3. **取消主推回退验证**：
   - 在后台取消勾选文章 2 的「设为首页主推」并保存。
   - 刷新前台首页，左侧主推文章自动回退至全站最新文章 1（《2026 上海写字楼市场观察》）。
4. **移动端视口（375px）**：
   - 验证单列自然流式堆叠，`hasHorizontalOverflow: false`（无横向溢出）。
   - 标题字号响应式自适应为 `17px`。
5. **截图留存**：
   - 桌面端截图：`artifacts/verification/FE-HOME-NEWS-20261008/home-news-desktop.png`
   - 移动端截图：`artifacts/verification/FE-HOME-NEWS-20261008/home-news-mobile.png`

---

## 4. 迁移与数据安全

- 迁移文件 `20261008_091723_home_featured_article_flag.ts` 由 Payload 官方命令生成，仅执行 `ALTER TABLE "articles" ADD COLUMN "is_home_featured" boolean DEFAULT false;`，未手改正文。
- 已在本地 PG 库应用并校验。

---

## 5. 主推互斥接口证据（2026-10-08 补充）

原 `settings-api-save.json` 记录的是已移除的站点设置 `homeFeaturedArticle` 流程，不能证明新字段，已删除，改为 `articles-api-exclusivity.json`：

- 前置：文章 4 为现任主推（`isHomeFeatured=true`）。
- 以 E2E 管理员 `PATCH /api/articles/2`，body `{"isHomeFeatured":true}` → `200`，响应 doc 的 `isHomeFeatured` 为 `true`。
- 重新查询：`isHomeFeatured=true` 只剩文章 2；单独 GET 文章 4 为 `false`；数据库行同样是 2=true、4=false。
- 互斥 hook 已改为与外层保存同一事务（传 `req`），批量取消旧主推出现任何失败即抛错，本次保存整体回滚，不再「吞错后照样提交」。单测见 `tests/articles-home-featured-hook.test.ts`。

## 6. 右侧列表去重与缺图占位（2026-10-08 补充）

- 右侧列表不再包含左侧主推那篇，`getHomepage` 多取一条补满 5 条；未配置主推、回退到最新一篇时同样不重复。
- 本地 7 篇测试资讯、文章 4 为主推时，桌面与移动端右侧依次为 7 / 6 / 5 / 3 / 2。
- 主推无封面时占位只显示「图片拍摄中」，不再出现「可先查看房源信息或联系顾问」。

