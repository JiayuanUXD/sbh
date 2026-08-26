# Task Packet：OPT-050 楼盘在生产上删不掉，且报错对运营完全不可读

> 状态：**已实施**（2026-08-24，含真库集成测试；文案问题见 §6.5）
> 创建日期：2026-08-24
> 来源：OPT-045 验收后清理测试数据时踩到（用户反馈「手动删房源页删不了」）
> 编号说明：OPT-049 是导航隐藏选择器，故取 050

---

## 1. 一句话

删楼盘必定 500：引用 `buildings` 的两个外键是 `ON DELETE SET NULL`，
而目标列是 `NOT NULL`——PG 置 NULL 时撞非空约束，整个事务中止。
运营看到的只有一个 500，**没有任何线索指向「这个楼盘下面还挂着房源」**。

## 2. 证据（2026-08-24 生产实测）

网关访问日志：

```
23:10:45  DELETE /api/buildings?limit=0&where[and][0][id][in][0]=160&[1]=158
          → statusCode 500，耗时 230ms
```

容器日志：

```
Failed query: delete from "payload_preferences" where "payload_preferences"."key" in ($1, $2)
params: collection-buildings-160,collection-buildings-158
  caused by: error: current transaction is aborted, commands ignored until end of transaction block
```

`current transaction is aborted` 说明**更早已有一条语句失败**，
`payload_preferences` 只是中止后的第一个受害者，不是真凶。真凶是这个矛盾组合：

| 子表 | 外键列 | 删除规则 | 列是否可空 |
|---|---|---|---|
| `listings` | `building_id` | `SET NULL` | **NOT NULL** ❌ |
| `building_merchant_relations` | `building_id` | `SET NULL` | **NOT NULL** ❌ |
| `supply_submissions` | `matched_building_id` | `SET NULL` | YES ✅ |

数据库侧同时确认：这两个楼盘无任何 `RESTRICT` 外键、无软删、无锁定记录——
**唯一的阻塞就是上面这个死结**。

## 3. 与 OPT-045 无关，是既有缺陷

房源侧当初修过**同一个病**：迁移 `20260819_113218_listing_hard_delete_nullable_refs`
的头注释写得很清楚：

> 病因：引用 listings 的外键都是 `ON DELETE SET NULL`，而这两列是 NOT NULL。
> 删房源时 PG 试图置 NULL → 23502 not_null_violation → 后台只显示
> "Something went wrong."（Payload 的兜底文案，真实报错仅在服务端 stdout）。

**楼盘侧漏了。** 症状一模一样，连「后台只显示兜底文案」这条都一样。

## 4. 修法：两张子表性质不同，不能用同一招

`20260819_113218` 已经确立了口径，照抄即可：

> 为什么是「脱钩」而不是「级联删除」：这两张表是审计记录，房源删了也该留着。
> 第三张表 listing_merchant_relations 语义相反（纯关系表，房源没了就是垃圾行），
> 由 beforeDelete hook 删除。

对着楼盘侧套用：

### 4.1 `building_merchant_relations` —— 纯关系表 → beforeDelete 钩子删除

楼盘没了，这条「楼盘-商户关系」就是垃圾行。与 `listing_merchant_relations`
当初的处理完全同构，**不放宽 NOT NULL**（那会留下一堆 `building_id IS NULL` 的
无意义关系行）。

### 4.2 `listings` —— **不脱钩，也不级联删除，而是拦住**

这是与房源侧最大的不同，**不要照抄脱钩**：

- 房源**不是**审计记录，脱钩后留下的「没有楼盘的房源」毫无意义；
- 有效供给 §7 要求房源必须挂在有效楼盘下，`building_id IS NULL` 的房源在前台
  永远不可见，等于制造隐形垃圾数据；
- 级联删除更糟——删一个楼盘顺手删掉几十套房源，是**不可逆的静默数据丢失**。

正确语义是**拒绝删除并说清原因**：

> 楼盘「环球金融中心」下还有 12 套房源，请先删除或转移这些房源后再删楼盘。

即 `beforeDelete` 钩子里查一次房源数，非零就抛 `InvalidOperationError`。

### 4.3 错误文案必须可操作

现状「500 / Something went wrong.」对运营是**零信息**——她不可能从
`current transaction is aborted` 推出「因为楼盘下面有房源」。

这条与修复本身同等重要：**一个删不掉但说清为什么的系统，比一个删不掉且不说话的
系统好得多**。前者是产品规则，后者是缺陷。

## 5. 需要改什么

- [ ] `src/domain/supply/building-delete-cleanup.ts`（新建）：`beforeDelete` 钩子
      - 有房源 → 抛错，文案含楼盘名与房源套数
      - 无房源 → 删掉该楼盘的 `building-merchant-relations`
- [ ] `src/collections/Buildings.ts`：接上 `beforeDelete`
- [ ] 单测：有房源时抛错且文案含套数；无房源时清理关系并放行
- [ ] 集成测试（真库）：建楼盘 → 建房源 → 删楼盘应被拦 → 删房源 → 再删楼盘成功

## 6. 验收

- 后台删一个**有房源**的楼盘 → 明确提示「还有 N 套房源」，不是 500；
- 后台删一个**无房源**的楼盘 → 成功，且其 `building-merchant-relations` 一并清掉；
- 生产上 `OPT045验收楼盘一号/二号` 能按上述路径删掉。

## 6.5 实施期发现：文案差点没传到运营眼前

本地浏览器验收时抓到——守卫确实拦住了（500 → 400），但后台显示的仍然是
**「Something went wrong.」**，§4.3「错误文案必须可操作」那半个目标其实没达成，
**而 10 条单测全绿**。

原因：Payload 只把 `isPublic === true` 的错误消息交给客户端。项目自己的
`DomainError` 继承原生 `Error`，没有这个标记。改用 Payload 的 `APIError`
（`isPublic: true` + `status: 400`）后文案才真正显示出来。

**这不是本工作项独有的问题**：全仓 `isPublic` 零命中，21 个 `*-protect.ts` 里
100+ 条中文提示运营都看不到。已立 **OPT-052**。

教训：**单测断言的是「抛了什么错」，而缺陷在于「错误怎么被序列化给客户端」**——
那一层在 Payload 内部，测试碰不到。这类问题只能在浏览器里发现。

## 7. 坑

- **`current transaction is aborted` 永远不是根因**，它只说明「更早有语句失败了」。
  真凶要往前找；而 Payload 只把浮到 handler 的那条错误记进日志，首个失败的语句
  很可能压根没被记下来——本次就是这样，是靠比对外键规则与列可空性反推出来的。
- **别照抄房源侧的脱钩方案**，理由见 §4.2。同一个病因，两张表的正确处方不同。
- 本项目 `payload.delete` 恒为硬删（`trash` 参数只是查询过滤器），
  所以这条链路上不存在「先进回收站」的缓冲。

## 8. 相关

- `src/migrations/20260819_113218_listing_hard_delete_nullable_refs.ts` —— 房源侧同病的修复与口径
- OPT-051 —— `Listings` / `Buildings` 缺 `delete` access（同域，独立问题）
