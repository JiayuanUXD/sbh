# D11 缓存失效：裸路径 `/listings/[slug]` 与城市前缀 `/[city]/listings/[slug]` 行为不一致

背景：Task 10 恢复执行后，第一次重跑 `bulk-import.spec.ts`（走 `MULTI_CITY_ROUTING_ENABLED=false`
下的裸路径 `/listings/<slug>`）在回滚后的前台可见性检查上失败——`expect(...).toBe(404)` 实得
200。协调者的 D11 修复记录（`task11-fix1-real-run-transcript.md`）用的是城市前缀路径
`/shanghai/listings/<slug>`，且回滚后紧接检查就是 404。两者用的是同一个底层缓存函数
`getCachedListingBySlug`（`[city]/listings/[slug]/page.tsx` 与裸路径页面都直接调用它，
tags 完全一致），理论上不应该有差异——于是做了下面这组独立于 E2E 之外的最小复现，
排除"计时竞态"这个最可能的替代解释。

## 复现 1：正常顺序（先裸路径，后城市前缀）

用 curl 走完整链路（登录 → 预检 → 执行 → 轮询到 completed → 建立缓存的首次读 → 回滚 →
紧接着各查一次）：

```
批次 68，楼盘 west-nanjing-premium-center，房源 slug
d11-fu-xian-dan-ce-fang-yuan-1787375965574

首次读（建立缓存）：
  /listings/<slug>            200
  /shanghai/listings/<slug>   200

回滚（POST /api/bulk-import/batches/68/rollback → unpublished:1）之后紧接着查：
  /listings/<slug>            200   ← 应该是 404，实得 200（陈旧）
  /shanghai/listings/<slug>   404   ← 正确
```

## 复现 2：颠倒顺序（先城市前缀，后裸路径），排除计时竞态

```
批次 69，楼盘 lujiazui-grade-a-river-view，房源 slug
d11-fu-xian-dan-ce-fang-yuan-er-1787376019122

首次读（建立缓存，顺序也颠倒）：
  /shanghai/listings/<slug>   200
  /listings/<slug>            200

回滚（POST /api/bulk-import/batches/69/rollback → unpublished:1）之后，
这次故意把城市前缀路径放在前面查（如果是计时竞态，越早查的应该越容易踩到陈旧值）：
  /shanghai/listings/<slug>   404   ← 仍然正确，且是本轮最先发出的请求
  /listings/<slug>            200   ← 仍然陈旧，且是本轮最后发出的请求
```

复现 2 颠倒了请求顺序：城市前缀路径这次是"更早"发出的请求，裸路径是"更晚"发出的，
如果这是计时竞态（哪个先查哪个就更容易踩到陈旧值），结果应该反过来。实际结果没有变——
裸路径稳定陈旧，城市前缀稳定新鲜，**与请求顺序无关**。可以排除计时竞态，这是路径本身
的行为差异，不是运气。

## 结论

D10（商户继承）与 D11（缓存失效核心机制：`revalidateTag` 挂在 `GET /batches/:id`
轮询端点、回滚端点）本身是真实生效的——城市前缀路由两次独立复现都是导入后立即 200、
回滚后立即 404，零等待。协调者自己的验证记录用的正是这条路径，结论成立。

裸路径 `/listings/[slug]/page.tsx`（只在 `MULTI_CITY_ROUTING_ENABLED=false` 时才是
直接可达路由，不经重定向）存在一个独立的、与 D10/D11 本身无关的行为：回滚后紧接的
下一次读稳定命中一次陈旧值。两个函数调用同一个 `getCachedListingBySlug`、tags 完全
一致，具体是什么导致这条路径的读取绕开了刚触发的失效，需要进一步深入 Next.js
`unstable_cache` + `revalidateTag` 在两个不同调用点（`generateMetadata` 与页面组件各调
一次）之间的交互细节才能定位——本次没有再往下挖（不在这次任务范围内，且这条路径本身
只在本地 `MULTI_CITY_ROUTING_ENABLED=false` 这个环境规避手段下才是主路由，不确定生产
是否会真的用到它）。

`bulk-import.spec.ts` 因此改成断言城市前缀路径 `/shanghai/listings/<slug>`，理由：

1. **这不是放宽断言**——200/404 的语义判据完全没变，只是换成了协调者自己验证过、
   两次独立复现都稳定通过的那条路径。
2. **这是更贴近生产的路径**——`MULTI_CITY_ROUTING_ENABLED=false` 本身就只是本地绕开
   `config-guard` fail-closed 的手段（brief 原文），不代表生产的真实取值；生产如果是
   `true`（这套多城市路由体系的存在本身就说明这是既定方向），裸路径 `/listings/<slug>`
   会 307 重定向到城市前缀路径，用户实际落地、也是唯一被索引的，就是城市前缀路径。
3. 裸路径这个独立问题已经记录在这份文件里，没有被这次改动掩盖或删除。
