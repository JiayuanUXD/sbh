# 出售频道 canonical 自指——走查证据（2026-09-16）

分支 `fix/sale-canonical-self-e2fb`（基于 `28dfecd` = origin/master）。
缺陷：`[city]/sale/page.tsx` 把 `pageType` 传成 `'listings'`，`/shanghai/sale?district=changning`
的 canonical 落到 `/shanghai/listings?district=changning`。

## 环境

- 验证树 `E:\wt-sale`（detached @ 28dfecd + 拷入本分支改动；会话树在 `.claude/worktrees/` 下 next dev 恒 500）
- 本地 `localhost:5432/postgres`，走查前补跑了 master 已合入的 `20260914_034003_opt_097_icp_record`（单条加列）
- `next dev` 3741（`MULTI_CITY_ROUTING_ENABLED=true`，生产形态）与 3742（`cross-env …=false`，CI 主趟形态）
- 探针：`probe.sh`（curl）+ `tests/e2e/sale-channel.spec.ts`（Playwright，随本分支提交）+ 面板内 JS 读 DOM

## 对照组（同一 server，两处 src 临时 `git checkout --` 回 master）

```
== /shanghai/sale?district=changning
<title>上海写字楼出售 · 商办买卖 · 商办租赁</title>
<meta name="description" content="上海写字楼、独栋办公与共享办公在租房源。"/>
<link rel="canonical" href="http://localhost:3741/shanghai/listings?district=changning"/>
```

## 修复后（开关开启，3741）

```
== /shanghai/sale?district=changning  [200]
<title>上海写字楼出售 · 商办买卖 · 商办租赁</title>
<meta name="description" content="上海写字楼、独栋办公与商办物业出售房源。"/>
<meta name="robots" content="noindex, follow"/>            ← 本地库 0 套出售房源，shouldIndexSaleChannel 门槛
<link rel="canonical" href="http://localhost:3741/shanghai/sale?district=changning"/>
== /shanghai/sale?areaMin=100&unknown=drop  [200]
<link rel="canonical" href="http://localhost:3741/shanghai/sale?areaMin=100"/>
== /shanghai/sale  [200]
<link rel="canonical" href="http://localhost:3741/shanghai/sale"/>
== /hangzhou/sale  [200]（未开城）
<meta name="robots" content="noindex, follow"/>
<link rel="canonical" href="http://localhost:3741/hangzhou/sale"/>
== /shanghai/listings?district=changning  [200]（相邻路由，未受影响）
<title>上海在租房源 · 商办租赁</title>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="http://localhost:3741/shanghai/listings?district=changning"/>
== /sale?areaMin=100&unknown=drop (redirect)
307 -> http://localhost:3741/shanghai/sale?areaMin=100
```

## 修复后（开关关闭，3742）

```
== /sale?areaMin=100&unknown=drop  [200]
<title>写字楼出售 · 商办租赁</title>
<link rel="canonical" href="http://localhost:3741/sale?areaMin=100"/>      ← origin 是构建内联值，只看 path
== /shanghai/sale?district=changning  [200]
<meta name="robots" content="noindex, follow"/>
<link rel="canonical" href="http://localhost:3741/sale?district=changning"/>  ← canonical 归还无前缀 URL
```

## 面板走查（开启态，Browser pane，JS 读 DOM）

`/shanghai/sale?district=changning`：url / canonical / og:url 三者一致为 `/shanghai/sale?district=changning`，
title `上海写字楼出售 · 商办买卖 · 商办租赁`，H1 `上海出售房源`，已选 chip `位置：长宁`，空态正常渲染，
控制台 0 错误、server 日志 0 错误。相邻 `/shanghai/listings?district=changning` canonical 自指、`index, follow`。

## Playwright `tests/e2e/sale-channel.spec.ts`

| 形态 | 结果 |
| --- | --- |
| `MULTI_CITY_ROUTING_ENABLED=true`（两侧同值） | 4 passed |
| `=false`（两侧同值） | 3 passed / 1 skipped（`/shanghai/sale` 用例按设计跳过） |
| **变异验证**：开启态 + src 回 master | 3 failed（收到 `/shanghai/listings`、`/shanghai/listings?areaMin=100`）/ 1 passed |

## 单测 / 静态

- RED：`city-metadata` 两条 TypeError（`CITY_PAGE_COPY['sale']` 缺失）；`city-route-pages` 两条收到 `/shanghai/listings` / `/listings`
- GREEN 后全量 `pnpm test`：385 files / 5113 tests 全绿；`pnpm typecheck` 0 错；`pnpm lint` 0 错（35 条既有 warning）
