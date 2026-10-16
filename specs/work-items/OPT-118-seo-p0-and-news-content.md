# Task Packet：OPT-118 SEO 基础修复 + 首批 8 篇原创资讯

> 状态：**待合并**（分支 `feat/seo-p0-news-content-3d34`；资讯尚未写入生产库，见 §5）
> 创建日期：2026-10-16
> 来源：用户「这个站点如何进行 SEO」→「根据你的建议生成 6–10 篇高质量资讯，和之前的任务一起做」

---

## 1. 一句话

修掉线上实测出的结构化数据 / sitemap / 空资讯页问题，并用平台自有房源数据产出 8 篇原创资讯（`content/articles/*.md`），替代 OPT-100 之前那批从 ChoOffice 采集的内容。

## 2. 线上实测（2026-10-16，`shangban.cc`）

| 现象 | 影响 |
|---|---|
| 房源 JSON-LD 的 `image` 是 `/api/media/...` 相对路径 | Google 富媒体结果要求绝对 URL，字段无效 |
| 房源 `Offer.price: 4.25`（实为 4.25 元/㎡/天） | 单价被读成总价 |
| `static.xml` 全部 URL 的 `lastmod` = 请求时刻 | 每次抓取都声称「刚更新」，会让搜索引擎不再信任整个 sitemap 的 lastmod |
| `/news` 显示「共 0 篇 / 暂无资讯」却在 sitemap 里（`daily`） | 提交收录了一个空页（薄内容 / 软 404） |
| 资讯 Article JSON-LD 缺 `author` / `publisher` / `dateModified`，`image` 同样是相对路径 | 资讯类富媒体结果不完整 |

## 3. 做了什么

- `lib/frontend/detail-metadata.ts`：`toAbsoluteMediaUrl`；`Offer` 改为 `priceSpecification`（`UnitPriceSpecification` + `unitText`），顶层不再写 `price`；新增 `buildArticleJsonLd`（`author` / `publisher` 用站点 Organization，不虚构个人作者；`dateModified` 仅在晚于发布时间 1 小时以上时输出，避免批量导入后几秒的二次写入被当成「修改」）。
- `domain/public-catalog`：`ArticleDetailViewModel` 增加 `updatedAt`（仅供 JSON-LD）。
- `_lib/sitemap.ts` / `sitemap-shards.ts`：静态页与城市频道页**不写 `lastmod`**；`/news` 仅在存在已发布资讯时进 sitemap，`lastmod` 取最新发布时间。
- `news/page.tsx`：无已发布资讯时 `noindex`。
- `scripts/lib/markdown-to-lexical.ts`、`scripts/lib/article-content.ts`、`scripts/import-articles.ts`：资讯 Markdown → Lexical → Payload Local API 幂等 upsert。
- **去掉内容页底部咨询模块**（产品裁定 2026-10-16：除楼盘、房源详情页外，其它页面不挂底部「需要专业选址建议？/ 提交需求」）：删除 `news/[slug]`、`pages/[slug]` 的 `.page-detail__cta` 区块及其样式，`tests/content-pages-no-bottom-cta.test.ts` 守着不被加回去，e2e `frontend-journey` 的对应用例改为断言不存在。委托找房 / 投放房源 / 城市合作等本身就是表单的页面不受影响。
- `content/articles/`：8 篇资讯。数据口径与复现脚本见 `artifacts/verification/OPT-118/`。
- **行文**：按「顾问对朋友讲清一件事」的口气写，不用「先说结论 / 数据口径 / 下一步」这类模板小标题，粗体每篇不超过 3 处；`tests/article-content-files.test.ts` 里有一条套话黑名单（首先/其次/综上/值得注意的是/赋能……）和破折号检查守着。不编造亲身经历，数字一个没动。
- **封面**：8 张由 Codex 图片生成工具产出（生成记录与踩坑见 `artifacts/verification/OPT-118/cover-generation/`），1600×900 JPEG，放在 `content/articles/covers/<slug>.jpg`，frontmatter 里 `coverAlt` 是替代文本。`import-articles.ts --execute` 会把封面上传到媒体库（`usage=article`，不打水印）并设为封面，**只在文章还没有封面时设置**，`--replace-covers` 才覆盖。

## 4. 刻意没做

| 项 | 原因 |
|---|---|
| 旧路径 `/listings`、`/buildings` 等的 307 → 308 | `redirect()` 散在 8 个页面、十几个测试和 e2e 断言里；308 一旦被浏览器 / 百度缓存很难撤回，而旧路径本来就不在 sitemap 里，收益小风险大 |
| 资讯「作者 / 审核人」字段 | 要加列迁移，超出 P0；JSON-LD 先用站点 Organization |
| 资讯分类落地页 `/news/category/<x>` | 新路由，单独立项 |
| 区域 / 商圈落地页 | 最大的流量机会，但是新功能，单独立项 |
| 品牌名统一（页脚「商办空间」vs title「商办租赁」） | 需要产品拍板用哪个 |
| 表格 | 前台 `PageContent` 与后台 Lexical 编辑器都没有启用表格节点，加了会在后台编辑时报错；数据一律写成列表 |

## 5. 资讯上线流程

1. 文章默认以**草稿**导入。`pnpm node --env-file-if-exists=.env.local --import tsx scripts/import-articles.ts --check` 只校验不写库。
2. 本机没有生产 `DATABASE_URL`（也不该有）。生产写入走 `--emit=<file.json>` 导出，再由有权限的人经 CloudBase MCP 写入（同 OPT-100 的做法）。
3. **上线前人工通读**每篇，并核对数字（口径在 `artifacts/verification/OPT-118/README.md`）。
4. 封面：`--execute` 会自动上传并设置。生产媒体在 COS，本机不直连生产，所以生产上线时由有权限的人在后台「素材库」上传 `content/articles/covers/` 下的 8 张图（用途选「文章配图」），再在文章里选上；`--emit` 导出的 JSON 里带每篇的封面文件路径和替代文本。AI 生成图的商用条款请自行确认。
5. 数据类文章（`*-2026-10`）是**时点快照**，文中写明了「截至 2026 年 10 月 16 日」；之后要么按月更新，要么在正文里明确下线。

## 6. 验收

- `pnpm typecheck` 干净、`pnpm lint` 0 error、`pnpm test` 461 文件 / 6354 用例全绿。
- 本地隔离库（`sbh_dev_seo_content`）导入后浏览器实测：`/news` 8 篇、详情页标题 / canonical / description / 单个 H1 / Article JSON-LD / 列表与引用块排版、375 宽无横向溢出、`static.xml` 与 `/news` 条目符合预期。
- **未验证**：生产环境的真实表现（合并后才有）、Google 富媒体结果测试、百度收录、Core Web Vitals。
