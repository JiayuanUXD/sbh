# OPT-100 清洗 ChoOffice 导入资讯：执行与验收

时间：2026-09-17 07:03–07:21（上海）· 生产库 TencentDB（经 CloudBase MCP `managePgDatabase`）· 分支 `data/opt-100-clean-chooffice-articles-dff9`

## 结果

| | 写库前 | 写库后（线上 API 全量扫描） |
|---|---|---|
| 正文 `upload` 节点 | 255 张 / 96 篇 | **0** |
| 含 ChoOffice 招商电话的篇 | 94 | **0** |
| 来源行 `???ChoOffice?https://…` | 100 篇 | **0** |
| 「已认证 / 王经理 / 微信同号」徽章 | 221 节点 | **0** |
| 整篇软文 `chooffice-6310/6311/6312` | published | **draft**（直开 URL 404，`/news` 列表不再出现） |
| 封面 `coverImage` | 96 篇 | 不动（96 篇） |
| published 篇数 | 100 | 97 |

页面渲染（`online/*.png`，Playwright 打生产站）：封面在、正文无图无电话无来源，章节结构完整。

## 怎么写的

1. **备份**：`plan/backup-before.json`（公开 API 拉的）与 `plan/backup-before.sql.json`（SQL 直接拉的 `content::text`）
   两条取径，100/100 结构一致；本地算的 `md5(content::text)` 与库里报的一致（`plan/md5-before.json`）。**回滚用 SQL 那份。**
2. **写库不重传整份 JSON**：把每篇计划表达成「删哪些顶层节点 + 替换哪些顶层节点」的编辑脚本，
   SQL 用 `jsonb_array_elements … WITH ORDINALITY` 过滤 + `CASE idx WHEN … THEN <新节点>` 替换，
   总 SQL 从 1.1MB 降到 ~70kB（`plan/sql-edit/`）。本地先按同一语义模拟并与计划 deep-equal（97/97）。
3. **乐观锁**：每条 `UPDATE … WHERE id = N AND md5(content::text) = '<写库前值>'`，行被别人动过就不写。
4. 每批写完用公开 API 回读、与计划 deep-equal；最后对全部 100 篇做不看计划的残留扫描。
5. `plan/after-production.json`：写库后线上全量快照。

## 规则在写库过程中又收了两轮

写前 5 篇后审批次 SQL 发现三类残留，停下来改规则、重算计划再继续（已写的篇在新规则下零回改）：
括号头被丢时括号尾巴（「业主直租）！」）跟着走；「预约电话 / 本次招商由…专员 / 24小时」这类引导与徽章词进联系词表；
「来电」进句级触发词；只剩标点的行丢掉。最终版规则见 `scripts/clean-chooffice-articles.ts`，33 条单测。

## 已知的 cosmetic 残留（无联系信息，未再迭代）

- 2 篇 FAQ 的「A：可通过 王经理…联系，招商热线…，或前往 xx 现场咨询」被抠成「A：可通过或前往 xx 现场咨询。」——语法别扭但无联系信息
- 「温馨提示：由于房源动态调整及优惠政策时效性较强。」「具体租金报价需联系。」这类被截断的话术句
- 封面图本身带 ChoOffice 水印（用户裁定保留封面，此处只知会）

## 缓存

走 SQL 绕过了 `afterChange` 缓存失效钩子；`unstable_cache` revalidate 300s + stale-while-revalidate：
过期后第一次请求仍回旧页并后台刷新（实测 1088 第一次回旧、第二次即新）。写库 5 分钟后全部页面为新。

## 不在本项内

255 张正文图对应的 Media 记录变成无引用上传件，**未删**（仓库红线：不物理删除主数据），留作独立清理。
