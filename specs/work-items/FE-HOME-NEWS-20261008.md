# 首页资讯左右等高布局与资讯中心主推配置

用户已确认：
1. 后台主推资讯功能移至「资讯中心」（Articles 集合），通过 `isHomeFeatured` 开关维护，全站至多 1 篇生效，保存时互斥更新；
2. 资讯部分桌面端左右高度改为一致，左侧日期贴底，右侧 5 条资讯均匀垂直分布，底边平齐；
3. 左侧大图卡片标题字号与右侧列表标题字号保持一致（桌面端 19px，移动端 17px）。

- 分支：feat/home-news-layout-4a9e，基线 origin/master c71c8c75。
- 资讯中心：`Articles` 集合新增 `isHomeFeatured`（设为首页主推）布尔字段，`admin.defaultColumns` 展示该列；`afterChange` Hook 保障单选互斥。
- 站点设置：清理此前临时加入的 `homeFeaturedArticle` 关联，恢复纯净。
- 公开读取：Adapter / Facade 查询已发布、未软删除的主推文章；无有效选择时回退至最新已发布文章第一篇。
- 右侧列表：最新已发布文章 5 条，不排除左侧文章，日期倒序；保留标题、日期、链接、点击埋点。
- 样式与布局：
  - 桌面等宽两栏，容器 `align-items: stretch`；左侧 16:9 图片在上、标题（19px）及日期（贴底）在下；右侧 5 条均匀撑满整列（`flex: 1`）。
  - 移动端改上下排列，取消等高拉伸。
- 数据库：回滚前次 `site_settings` 临时迁移；为 `articles` 新增 `is_home_featured` 生成新迁移，迁移正文不手改。
- 门禁要求：`generate:types`、`typecheck`、`lint`、`test`、`migrate:dry-run`、`build` 全部通过。
- 验证证据：桌面与手机浏览器视口截图与对齐测量、后台互斥保存验证。
