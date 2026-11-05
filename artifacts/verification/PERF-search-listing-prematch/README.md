# 房源关键词 SQL：楼盘侧匹配前置（性能）

## 改了什么

`src/domain/public-catalog/listing-query-sql.ts`：房源搜索的关键词条件原先是联表之后的一个大 OR——
`l.title / b.name / dist.name / ba.name / metro.name / b.address` 六列 `ILIKE`，每条房源（线上约 5.7 万）
都在联表结果上算一遍，打分的 CASE 里还要再算一遍。

现在把「楼盘侧五列」提到每个词项一个 `MATERIALIZED` 命中集（楼盘表约 4 千行：`is_hit` + 楼盘侧得分），
房源按 `building_id` 左连；房源行上只剩 `title ILIKE`。命中集合、得分、排序都与改前一致。

## 踩到的坑（已写进代码注释与 `tests/listing-query-hit-cte.test.ts`）

第一版把命中集写成 `WHERE (b.name ILIKE ...)`，只留命中的楼盘。结果集合与排序全对，
但规划器把命中集估成几行，选了嵌套循环、对 5.5 万房源逐行重扫命中集，最慢的词从 0.4s 变成 9s
（「徐家汇」，命中 800 个楼盘）。改成保留全量楼盘、用 `is_hit` 标记后规划器估对行数、走哈希连接。
**结果对、SQL 形状坏**——单测看不出来，所以把形状钉进了结构守卫测试。

## 证据

- `compare.ts`：同一份合成数据、同一组 44 条查询，逐条比较**完整有序 id 列表与 total**，并取 5 次中位数计时。
  「改前」取自 `origin/master` 同名文件（脚本自己 `git show`，跑完删除）。
- `compare-output.txt`：最后一次完整输出。**44 条里 0 处不一致**；中位数耗时合计 13158 ms → 5793 ms。
- 夹具规模取线上量级（房源 57080、楼盘 4447、行政区 16、商圈 80、地铁站 200），库字符集 C / UTF8 与生产一致。
- `tests/listing-query-postgres.test.ts` 新增 6 条 ranking 用例（标题 > 楼盘名次序、行政区 / 商圈 / 地铁 / 地址各自召回、
  无命中、通配符转义、AND / OR），夹具楼盘加了 `address` 列。

## 没有验证到的（如实）

- **数据是合成的**：标题、楼盘名、地址按固定模板拼出来，选择率与线上不同；只量了房源分页查询本身，
  不含页面其余查询（楼盘、资讯、词表缓存）。**线上收益要上线后用同一批词复测**，不要把合成数据上的倍数当承诺。
- 本机是 x86 的 Homebrew PG 16，生产是 TencentDB PG 17.10；计划形状应一致，但绝对耗时不可比。
- 合成夹具里有几条结果为 0 的查询（如「国金中心」），它们只能证明「都为空」，等价性主要靠非零的那些。
- 「办公室 + 价格升序」改前 2.5s、改后 50ms，是改前计划在零结果下的偶发劣化，不计入收益。
- 浏览器：本地 dev（`sbh_dev_geo`，房源 530 / 楼盘 10）走查 `/shanghai/search?q=陆家嘴`，
  房源 2 条 + 楼盘 1 条，控制台无报错；相邻路由 `/shanghai/listings?q=`、`/buildings?q=`、`/listings` 均 200。
  本地数据太小，只能证明页面渲染与计数正常，不能证明性能。

## 复现

```bash
cd payload-office-platform
arch -arm64 pnpm exec tsx ../artifacts/verification/PERF-search-listing-prematch/compare.ts
# 保留实验库排查计划：KEEP_DB=1，只跑一条：ONLY='rank and [徐家汇]'
```
