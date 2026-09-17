# Task Packet：OPT-100 清洗 ChoOffice 导入资讯正文的来源 / 图片 / 联系方式

> 状态：**已执行**（2026-09-17 写库完成，97 篇清洗、3 篇软文下架；验收见 `artifacts/verification/OPT-100/README.md`）
> 创建日期：2026-09-16
> 来源：用户「去掉资讯详情页里的来源、图片和联系方式」

---

## 1. 一句话

生产 100 篇资讯全是 `chooffice-*` 导入件，正文 Lexical JSON 里带着 ChoOffice 的来源行、图片与招商电话。
这是**改数据**不是改模板（页面模板没有「来源」字段；`page-detail__cta` 那句「留下联系方式」是本站自己的咨询入口，不动）。

## 2. 摸底（2026-09-16，线上公开 API + 生产库只读 SQL）

| 目标 | 实际 | 分布 |
|---|---|---|
| 来源 | 每篇末节点 `???ChoOffice?https://www.chooffice.com/NNNN.html?`（导入时乱码的「来源」行） | 100/100；另 4 篇正文中间也提到 |
| 图片 | 正文 `upload` 节点，引用 Media | 96/100，共 255 张；封面 `coverImage` 是独立字段（96 篇有） |
| 联系方式 | ChoOffice 招商电话 `13774382509` 王经理（177 次）、`021-51306070`（9）、`13764512981`（3），含 `137-7438-2509` 等分隔写法；散落在「招商热线：」标题、「温馨提示…致电」引用块、结尾段、列表项、以及正文段落里嵌的一句 | 94/100，181 个节点含电话，221 个节点含联系词 |
| 整篇软文 | 标题带「-上海找办公室网」、通篇推广 chooffice.com | 3 篇：`chooffice-6310` / `6311` / `6312` |

Articles 集合无 versions / drafts，`content` 是 `articles.content` 一列 jsonb；`afterChange` 钩子做公开缓存失效，`unstable_cache` revalidate 300s。

## 3. 设计裁定（2026-09-16 与用户确认）

| 问题 | 裁定 |
|---|---|
| 改数据还是渲染时过滤 | **一次性脚本清洗**。渲染过滤会让 `/api/articles`、JSON-LD、搜索引擎照样拿到竞品电话 |
| 封面 | **保留**，只去正文里的图（封面同时是列表卡与 OG 图） |
| 联系方式粒度 | **含电话的整个节点删；混排块只抠号码段** |
| 整篇软文 | **不改写**（删段落只剩残骸），报告单列，建议下架——待用户定 |
| 写库路径 | 本机拿不到生产 `DATABASE_URL`；用 CloudBase MCP 直接 `UPDATE`。绕过了 `afterChange` 缓存失效钩子，代价是最多 5 分钟旧缓存（revalidate 300s）。脚本同时提供 `--execute`（Payload Local API）给有 DB 访问权的环境。**实施时改为不重传整份 JSON**：把计划表达成顶层节点的删除 / 替换编辑脚本，用 `jsonb_array_elements WITH ORDINALITY` 在库内重组，SQL 从 1.1MB 降到 70kB；每条带 `md5(content::text)` 乐观锁 |
| 孤儿 Media | 255 张正文图对应的 Media 记录**不删**（仓库红线：不物理删除主数据；它们只是变成无引用上传件），留作独立清理 |

## 4. 做法

`scripts/clean-chooffice-articles.ts`（规则 + CLI）+ `tests/opt100-clean-chooffice-articles.test.ts`（29 条）。

规则以文件头注释为准，要点：`upload` 一律删；命中 `chooffice.com|ChoOffice|上海找办公室网` 的节点删；
联系方式按「以联系为主 → 整节点删」「混排 → 按行 / 句 / 分句只抠含电话、联系词、纯话术的分句」；
分句里带数字单位的一律当事实保留；FAQ 的「A：」被删后紧挨的「Q：」一起删；收尾合并连续 hr、
删空章节（导入时就空的单独记账为 `already-empty-heading`），键值式 / 竖线分隔 / 带单位的信息式标题不当空章节删。

**规则是在 100 篇真实数据上迭代出来的**，每一轮都拿三类最可能误伤的删除逐条过：句级抠除、长段落整删、空章节。
最后一版对 97 篇计划结果扫描：残留电话 0、残留来源 0、残留「已认证 / 王经理」0、≤2 字残行 0；第二遍清洗 97/97 零改动（幂等）。

## 5. 计划（`artifacts/verification/OPT-100/plan/`）

- `report.md`：逐篇列出删了哪些节点 / 哪些分句，给人过目
- `plan.json`：id → 新 content，写库用
- `backup-before.json`：100 篇写库前的完整 content，**回滚就用它**

删除计数：upload 255 · source 98 · contact-node 172 · contact-line 207 · empty-heading 6 · already-empty-heading 55 · hr 113。

## 6. 验收

- [x] 单测 29 条（每条规则一个 + 不误伤 + 不改入参 + 幂等）
- [x] 对生产数据 dry-run，三类高风险删除人工逐条审过
- [x] 用户过目 `report.md`（2026-09-16 裁定：软文下架，其余写库）
- [x] 写库前 SQL 备份与 API 备份 100/100 结构一致；md5 本地/库端一致
- [x] 分批 `UPDATE`（jsonb 编辑脚本 + md5 乐观锁），每批 API 回读 deep-equal：5 + 30 + 29 + 33 = 97/97
- [x] 写库后线上 API 全量扫描：upload / 电话 / 来源 / 徽章全 0；Playwright 页面复测 3 篇；缓存过期后页面为新
- [x] 三篇软文 status → draft（直开 404，列表不出现）

## 7. 不在本项内

孤儿 Media 清理；封面图；导入器本身（未来再导入仍会带这些东西——如果还会导，得在导入侧过滤，另立工作项）；
`page-detail__cta` 本站咨询入口。
