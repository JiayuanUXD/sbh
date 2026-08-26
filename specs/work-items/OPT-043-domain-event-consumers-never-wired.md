# Task Packet：OPT-043 领域事件只写不读——消费链路整条从未接线

> 状态：**待裁定**（删 / 接 / 拆，需先定方向）
> 创建日期：2026-08-22
> 来源：OPT-041 Task 10 D11 缓存排查时发现，范围超出缓存
> 编号说明：OPT-041 为批量导入所占，OPT-042 是跨实例缓存失效，故取 043

---

## 1. 一句话

`domain_events` 表**一直在写入**，但 `EventDispatcher` 在生产**从未被实例化过**——
缓存失效消费者和通知消费者两套 `registerXxxConsumers` 都是零调用点的死代码，
事件写进表里之后再没有任何东西读它们。

## 2. 现状与证据

**事件确实在写。** 这两个 collection 走了 event publisher：

- `src/collections/ListingReports.ts`（举报暂停 / 恢复 / 成立 / 驳回）
- `src/collections/InformationCorrections.ts`（更正创建）

**消费端一个都没接。** 全仓库搜索的结果：

| 符号 | 定义处 | 生产调用点 |
|---|---|---|
| `EventDispatcher` | `src/domain/workflow/event-consumer.ts` | **0**（只在同文件的 JSDoc 示例里出现） |
| `registerCacheInvalidatorConsumers` | `src/domain/public-catalog/cache-invalidator.ts:240` | **0** |
| `registerNotificationConsumers` | `src/domain/workflow/notification-consumer.ts:93` | **0** |
| `createNextTagInvalidator` | `src/domain/public-catalog/cache-invalidator.ts:258` | **0** |

`payload.config.ts` 的 `jobs.tasks` 只注册了三个：`supplySubmissionNotificationTask`、
`cityPartnerApplicationNotificationTask`、`cityPartnerNotificationOutboxTask`。
**没有事件分发 task。** 所以也不存在「靠 job 跑消费者」这条隐藏路径。

**这些死代码有完整的测试并且全绿**，这正是它长期没被发现的原因：
`tests/public-catalog-cache-invalidator.test.ts`、`tests/cache-next-adapter-integration.test.ts`
都在验证「消费者收到事件后会算出正确的 tag 并调用 revalidateTag」——
每一条都成立，只是**没有任何东西会把事件交给消费者**。

> 这是本次排查最值得记住的一条教训，已写进
> `tests/supply-public-cache-hook.test.ts` 的「接线契约」用例：
> **测函数本身不够，必须锁住它真的被接上。**

## 3. 顺带发现：`computeAffectedTags` 里有一半是空转

即便把链路接上，`computeAffectedTags` 算出的 `public:listing:<id>` /
`public:building:<id>` 这两类具体 tag 也**没有任何缓存项挂着它们**——
`src/lib/frontend/cached-queries.ts` 里所有 `unstable_cache` 挂的都是城市级
（`public:listings:city:<city>`、`public:home:<city>`）和类目级（`public:listings`）tag。

`cache-tags.ts` 的注释对此是诚实的（「具体 tag 保留供未来 Cache Components 启用
`cacheTag` 指令时使用」），但这意味着接线的收益比看上去小：真正起作用的那部分
（城市级失效）现在已经由 collection hook 覆盖了。

## 4. 现在还缺的失效来源（本工作项要解决的实际问题）

`claude/vigilant-margulis-d3dec3` 分支给 `Listings` / `Buildings` 挂上了
afterChange / afterDelete 失效，但**`ListingReports` 没挂**。后果：

**举报暂停一条房源后，前台缓存不会失效。**

注意这不是「房源没被暂停」——暂停是实时生效的，`supply-adapter.ts` 的
`baseEffectiveWhereWithoutCity` 每次查询都会读 `listing-reports` 拿 `pausedIds` 并
`not_in` 排除。**生效的是查询，陈旧的是缓存**：被暂停的房源在城市列表、首页、facet
里最长仍会出现 300 秒（多实例下更久，见 OPT-042）。

举报暂停的产品语义是「疑似违规内容立即下线」，5 分钟的对外可见窗口与这个语义直接冲突。
`report.supply_paused` / `report.supply_resumed` 本来就在
`CACHE_INVALIDATOR_EVENT_TYPES` 里——设计是对的，只是那条链路没通。

## 5. 需要裁定的问题

**方向一：删掉事件消费体系，全部改用 collection hook。**
承认「跨对象副作用走 Outbox + 幂等消费者」（`.agent/core.md`）这条设计在本项目
没有真正落地，把缓存失效统一收敛到 collection hook（现在已经是事实状态），
给 `ListingReports` 补上 hook，删除 `EventDispatcher` / 两套 register / 相关测试。

- 优点：消灭「有测试的死代码」这个最危险的形态；实现与事实一致。
- 缺点：与 `core.md` 明文的架构立场冲突，需要同步修订那份规则；
  `domain_events` 表变成纯审计日志（要确认这是否可接受——**它现在事实上已经是了**）。

**方向二：把事件链路真正接上。**
加一个 Payload job task 跑 `EventDispatcher`，注册两套消费者。

- 优点：符合 `core.md` 的架构立场；通知消费者也一并激活。
- 缺点与前置问题：
  1. **生产 `PAYLOAD_DISABLE_JOB_AUTORUN=1`**（CloudRun EnvParams 实测），
     job 自动运行是关的。要走这条路必须先裁定这个开关为什么被关、能不能开。
  2. `revalidateTag` **需要 Next 请求上下文**，job 里没有，会抛
     `Invariant: static generation store missing`。已在
     `revalidatePublicCacheTags` 里降级成一条 warn，但那是「安静地不失效」，
     不是「失效成功」。走方向二必须先解决这个，否则接了也不生效。
  3. 与已有的 collection hook 会**重复失效**（幂等，但是浪费），要定谁负责什么。

**方向三：只补 `ListingReports` hook，事件体系原样搁置。**
最小改动解决第 4 节的实际问题，把架构问题留到以后。
代价：死代码继续存在，下一个人还会踩同样的坑；至少要在
`cache-invalidator.ts` 顶部加一句「本文件在生产未接线」的显式声明。

## 6. 需要改什么

视裁定结果，可能涉及：

- [ ] `src/collections/ListingReports.ts`：挂失效 hook（三个方向都要做）
      —— 城市解析路径是 report → listing → building → city，
      可复用 `src/domain/public-catalog/supply-cache-hook.ts` 的解析工具，**不要写第二份**
- [ ] `tests/supply-public-cache-hook.test.ts`：补 ListingReports 的接线契约用例
- [ ] `src/domain/public-catalog/cache-invalidator.ts` + `src/domain/workflow/event-consumer.ts`
      + `notification-consumer.ts`：删除 / 接线 / 加未接线声明
- [ ] `.agent/core.md` 的「跨对象副作用使用稳定事件 ID、Outbox 和幂等消费者」一条
      （方向一需要同步修订，否则规则与代码再次分叉）
- [ ] `payload.config.ts` 的 `jobs.tasks` 与 `PAYLOAD_DISABLE_JOB_AUTORUN`（方向二）

## 7. 验收

- 举报暂停一条房源后，**下一次**读城市列表 / 首页 / facet 就看不到它（不是 5 分钟后）；
- 选定方向后，仓库里不再存在「有测试但零生产调用点」的失效链路，
  或该状态被显式声明在代码里；
- `.agent/core.md` 与实际实现一致。

## 8. 坑

- **别只看测试绿就以为链路是通的**——这个工作项的存在本身就是这个教训。
  任何「注册型」代码（register / dispatch / subscribe）都要有一条断言它被真正调用的用例。
- **`domain_events` 表已有历史数据**：如果选方向一要删消费体系，
  先确认表里堆积的未处理事件（`processedAt IS NULL`）不需要补偿处理，
  以及它是否被任何报表 / 审计依赖。
- **别在 job 里直接调 `revalidateTag`**：没有请求上下文，会静默不生效（现在只留一条 warn）。
- **举报暂停的失效范围**：暂停影响的是「该房源所属城市」的列表 / 首页 / facet，
  与 listing 变更同口径，直接复用 `cityLevelSafeInvalidationTags`，不要新造范围。
