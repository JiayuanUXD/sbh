# Task Packet：OPT-124 资讯日更流水线（取数对账、数字核对、REST 发布）

> 状态：**待合并**（分支 `feat/opt-124-news-daily-pipeline-61ab`）
> 创建日期：2026-10-22
> 来源：用户让豆包定时任务每天写一篇资讯，请 Claude 看范围和质量的优化空间 → 复盘后用户选择「在这里完成」两个后续任务之一

---

## 1. 一句话

把日更资讯里能确定的步骤（取数、与前台对账、数字核对、发布、验收）收进仓库脚本，外部 agent 只负责选题和写稿，也不再需要生产库凭据。

## 2. 现状（2026-10-22 复盘）

| 现象 | 影响 |
|---|---|
| 豆包 source `.env.production.local` 直连生产库，裸 SQL `INSERT INTO articles` 且直接 published | 外部 agent 持有生产库、COS、`PAYLOAD_SECRET` 全套凭据，同时读外部网页；绕过 Articles 的访问控制、校验与 hook |
| 线上 109、110 两篇取数口径错：110 样本 5.7 万（前台在租 3.37 万），109 有 6 个区的条数与中位数对不上（闵行写 1,132 条 / 2.82，前台口径是 357 条 / 2.46） | 文章数字与前台不一致，「反常识结论」建在错数据上 |
| 110 把「贵 12.5%」写成 18%，三处样本数各不相同 | 人工通读很难逐个核 |
| 两篇都过不了 `tests/article-content-files.test.ts` | 现成的内容闸门被绕开 |
| 全部 10 篇资讯都没绑 `relatedDistricts` / `relatedBuildings` | 商圈落地页的「相关资讯」一篇都不显示 |
| `import-articles.ts --execute --status=draft` 会作用于目录里所有文章 | 日更单篇导入时会把已发布的文章一起改回草稿 |

## 3. 做了什么

- `scripts/lib/article-content.ts`
  - frontmatter 支持 `relatedDistricts` / `relatedBuildings`（逗号分隔 slug；没写 = 不动库里已有关联，留空 = 明确不关联）；`resolveRelated` 统一做 slug → id，查不到一次列全再报错。
  - 内容规则从单测挪进来：`lintArticle`（篇幅、SEO 字段、套话、模板小标题、粗体、末尾声明、电话 / 占位符 / 绝对化用语，新增「coverAlt 不能写成 slug」）、`lintCover`（JPEG、16:9、< 400KB）。`tests/article-content-files.test.ts` 改为调用它们，阈值不变。
  - `selectArticles`（`--only`）、`articleTexts`、`articleLinks`。
- `scripts/import-articles.ts`：`--only=<slug>`；导出 / 写库前先跑内容规则；`--execute` 先解析全部关联再写库，`--emit` 带上关联 slug。
- `scripts/news/data.ts` + `scripts/lib/news-supply.ts`（`pnpm news:data`）：公开 REST 取数 → 快照（分位数照 `percentile_cont` + `ROUND(::numeric, 2)`，价格单位复用 `mappers.ts` 的映射表）→ 与前台列表页、区域落地页逐项对账，不一致退出码 1；`--archive` 按日存快照。
- `scripts/news/check.ts` + `scripts/lib/news-numbers.ts` + `scripts/lib/news-check.ts`（`pnpm news:check`）：内容规则、封面、数字核对（每个数都要在 numbers.json 里找得到出处）、关联是否存在、站内链接是否 200。
- `scripts/news/publish.ts` + `scripts/lib/news-publish.ts`（`pnpm news:publish`）：重跑全部检查 → 专用账号登录 → 封面以 `usage=article` 上传 → 新建文章（带关联）→ 验收；只新建不覆盖。
- 文档：`scripts/news/README.md`；`.agent/frontend.md` 加一行指针。

## 4. 刻意没做

| 项 | 原因 |
|---|---|
| 生产里建专用发稿角色和账号 | 需要用户在后台操作并保管凭据 |
| 回写已上线 10 篇的关联、修 109 / 110 的数字 | 是生产内容变更，单独确认后再做 |
| 改 `.env.production.local` 的位置 | 本机系统配置，由用户决定 |
| 用统一有效供给服务直接出统计（不经 REST 简化谓词） | 需要新的公开统计接口或直连库；现在用「REST 取数 + 前台逐项对账」兜底（`.agent/supply.md`） |
| `news:publish` 支持更新已有文章 | 只新建不覆盖是刻意的，改稿走后台 |

## 5. 验收

- 单测：`tests/article-content-lint.test.ts`、`news-supply.test.ts`、`news-numbers.test.ts`、`news-publish.test.ts` 新增；`article-content-files.test.ts` 改为调用共享规则。
- `pnpm news:data` 实跑生产公开接口（只读）：在租 33,721 条，对账 62 项全部一致（落地页 13 个的样本数 / P25 / 中位数 / P75 逐位一致），11 个区域落地页 404（前台隐藏）。证据：`artifacts/verification/OPT-124/news-data-*`。
- 数字核对拿 OPT-118 的两篇真实文章试跑：分别核对 80、136 个数，报出的 9 个、5 个全是当年没记进数字文件的派生数（80㎡ 月租、几区合计、得房率换算），没有格式误报。证据：`news-check-opt118-articles.log`。
- 本地端到端（独立库 `sbh_dev_news`，dev server 3791，运营夹具账号）：REST 发布 published → 详情页「相关推荐」出现关联楼盘与两个商圈、封面 `usage=article`；陆家嘴落地页「相关资讯」出现该文（截图 `local-area-lujiazui-related-news.jpg`）；draft 前台 404、接口读回正常；同 slug 重复发布被拒；错误密码 401 停下；`import-articles --execute --only` 只改了指定那篇的关联。
- **未验证**：生产环境的 REST 发布（要先有专用账号）、生产媒体走 COS 时的封面上传。
