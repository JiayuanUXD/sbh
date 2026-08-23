# Task Packet：OPT-042 公开缓存失效的跨实例传播

> 状态：**待裁定**（需先定方向再排期）
> 创建日期：2026-08-22
> 来源：OPT-041 Task 10 D11「裸路径陈旧一次」排查的衍生发现（该次排查的主结论已修复，见下）
> 编号说明：OPT-041 为批量导入所占，故取 042

---

## 1. 一句话

`revalidateTag` 的失效标记写在**进程内存**里，而生产 CloudRun `MaxNum=5`——
在实例 A 上下架一条房源，实例 B–E 的缓存**完全不知道**，继续对外供陈旧数据，
直到各自的 300s TTL 到期。

## 2. 现状与证据

**失效标记是进程级的。** Next 16 的 tag 失效落在一个模块级 Map 上：

```js
// next/dist/server/lib/incremental-cache/tags-manifest.external.js
const tagsManifest = new Map()
```

`revalidateTag` → `FileSystemCache.revalidateTag` → 写这个 Map。
`unstable_cache` 读取时经 `areTagsExpired` / `areTagsStale` 查同一个 Map。
`next.config.ts` **没有配置 `cacheHandler`**，所以用的就是这个默认实现；
缓存内容本身也落在容器内的 `.next/cache`，容器之间同样不共享。

**生产确实会多实例。** CloudRun 服务 `sbh` 当前配置（2026-08-22 查）：

| 项 | 值 |
|---|---|
| MinNum / MaxNum | 1 / 5 |
| OperationMode | `alwaysScale` |
| 扩容策略 | CPU 使用率 50% |

也就是说：**平峰单实例时失效是对的，一旦流量上来扩到多实例，失效就开始漏。**
这是最难查的那类 bug——它只在有负载时出现，而有负载时恰恰最难复现。

**具体后果。** 运营在后台下架一条房源，请求落到实例 A：

- 实例 A：城市列表 / 首页 / facet / 楼盘详情 / sitemap 立即失效，下次读回源。正确。
- 实例 B–E：**什么都没发生**，继续用各自 5 分钟前的缓存。房源仍挂在搜索结果里。

用户看到的是「刷新几次，有时房源在有时不在」——因为每次请求可能打到不同实例。
这比「稳定陈旧 5 分钟」更难被当成 bug 报告，也更难信任。

## 3. 与已修复部分的关系

OPT-041 D11 那次排查同时暴露了三个层次的问题，前两个已修（分支
`claude/vigilant-margulis-d3dec3`）：

| # | 问题 | 状态 |
|---|---|---|
| 1 | `revalidateTag(tag, 'max')` 只标记 stale，放行一次陈旧读 | **已修**，改用 `{ expire: 0 }` 硬失效 |
| 2 | `Listings` / `Buildings` 根本没有失效接线，后台下架不触发任何失效 | **已修**，挂了 afterChange / afterDelete |
| 3 | 失效只作用于单个实例 | **本工作项** |

第 3 条**不会被前两条掩盖**：现在失效是硬的、也真的触发了，但传播范围仍是一个进程。

## 4. 需要裁定的问题

**方向一：配共享 cacheHandler。** 语义最正确，一次失效对所有实例生效。代价：

- 需要一个所有实例可达的共享存储。当前架构里**没有现成的 Redis**；
  腾讯云 Redis 需要与 CloudRun 同 VPC，而服务现在 `VpcConf` 是空的
  （`DATABASE_URL` 走的是公网 TencentDB 地址）——**这一条本身就是要评估的前置条件**。
- Next 16 的 `cacheHandler` 契约（`get` / `set` / `revalidateTag` / `updateTags`）
  需要自己实现并测试，属于基础设施代码。
- 复用现成的 PG（已有共享库）做 cacheHandler 是否够用？读放大能不能接受？

**方向二：缩短 TTL。** 改 `cached-queries.ts` 的 `revalidate: 300`。零基础设施成本，
但只是把「最长陈旧 5 分钟」变成「最长陈旧 N 秒」，同时按比例抬高回源频率。
需要先量：当前公开查询的 QPS 与单次回源成本，才谈得上定 N。

**方向三：接受现状，只做可观测。** 承认多实例下失效是 best-effort，
把 TTL 作为正式的一致性上界写进文档，并加监控。适合「多实例扩容实际很少发生」的情况——
**这需要先用数据证明**：查 CloudRun 的实例数历史，看过去 30 天到底有没有真的扩到 >1。
如果从没扩过，本工作项的实际优先级会大幅下降；如果经常扩，方向一就不可回避。

**建议先做的事：拉实例数曲线。** 这是唯一能把三个方向的优先级区分开的证据，
成本也最低。在拿到之前不要动代码。

## 5. 需要改什么

视裁定结果，可能涉及：

- [ ] `next.config.ts`：`cacheHandler` 配置（方向一）
- [ ] 新增 cacheHandler 实现 + 测试（方向一）
- [ ] CloudRun `VpcConf`（方向一，若选 Redis）——注意这是服务级配置，
      `tcb cloudrun deploy` 没有 `--env-vars`，只能在控制台 / MCP 改
- [ ] `src/lib/frontend/cached-queries.ts` 的 `revalidate` 值（方向二）
- [ ] 一致性上界的文档化 + 监控（方向三）

## 6. 验收

- 能在多实例条件下证明：一次后台下架后，**所有**实例的下一次读都返回新数据
  （方向一），或者陈旧窗口不超过承诺的上界（方向二/三）；
- 不引入新的跨实例状态一致性问题（比如 cacheHandler 自身的失效风暴）。

## 7. 坑

- **别只在本地单实例验证就宣布修好**：这个 bug 的定义就是「单实例下看不出来」。
  验收必须构造 ≥2 个实例，或直接在生产灰度上验证。
- **`tagsManifest` 是 Next 内部实现**，升级 Next 时要重新核对。
  `tests/public-cache-immediate-expiry.test.ts` 已经是这条语义的哨兵，
  做本工作项时应扩展它，而不是另写一套。
- **别把 TTL 调得很短当成「修好了」**：那是把正确性问题换算成流量成本，
  在裁定文档里要说清楚这是取舍不是修复。
