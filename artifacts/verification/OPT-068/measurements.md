# OPT-068 度量记录

## 1. 生产库上的查询形状对比（2026-09-04，线上 API，上海 2181 条房源）

| 形状 | 覆盖 | 单页耗时 | 单页字节 | 覆盖全量合计 |
|---|---|---|---|---|
| 旧：`depth 2` 全字段，limit 200 | 200 条/页 | 1.41 / 1.65 s | 8.2 / 8.5 MB | 1000 条候选 ≈ 5 页 ≈ **7–8 s / 41 MB** |
| 新：`select` + `populate` 收窄，limit 1000 | 1000 条/页 | 0.78 / 0.53 / 0.23 s | 0.99 / 0.99 / 0.18 MB | 全部 2181 条 ≈ **1.5 s / 2.1 MB** |
| 新增：本页 24 条按 id 回捞（`depth 2`） | 24 条 | 0.31 s | 0.99 MB | 每页一次 |

旧路径每次冷渲染要跑 2–4 遍上表第一行（列表 1 次 + facet fan-out 1–3 次），
这与线上实测的 `?areaMax=500` 冷开 20.4 s、`?areaMin=100&areaMax=300` 10.8 s 吻合。
新路径整页共用一次扫描（1.5 s）+ 一次回捞（0.3 s）。

## 2. 本地生产构建（`next start`，本地库 26 条房源）

| URL | 冷（首次） | 热（第二次） |
|---|---|---|
| `/shanghai/listings` | 0.027 s | 0.021 s |
| `?district=jingan` | 0.222 s | 0.016 s |
| `?type=coworking` | 0.094 s | 0.014 s |
| `?sort=newest` | 0.142 s | 0.018 s |
| `?page=2` | 0.082 s | 0.012 s |
| `?priceUnit=rmb-sqm-day&priceMax=8` | 0.098 s | 0.015 s |
| `?areaMin=100`（新扫描键） | 0.198 s | 0.015 s |
| `?q=陆家嘴`（新扫描键） | 0.123 s | 0.009 s |

本地数据量小，绝对值不能外推到生产；这组数只用来证明「筛选/排序/分页都能跑通、
且第二次命中缓存」。生产收益按第 1 节的查询形状与共享次数推算，上线后复测。

## 3. 派生图回填（本地实测）

`cover-west-nanjing-premium-center-3.jpg` 原图 63,469 B →
派生 `-320x180.webp` 4,946 B / `-768x432.webp` 13,942 B / `-1600x900.webp` 32,606 B。
卡片位（~360 px）实际下载从 62 KB 降到 14 KB。原图文件名与 `media.url` 不变，
引用它的房源/楼盘无需改动。

## 4. 走查中发现并修复的回归（本次改动引入）

`lib/frontend/media-srcset.ts` 最初从 `@/domain/public-catalog` barrel 导入
`pickVariantSrc`，而 `ui/Media.tsx` 是 `'use client'`——barrel 把 `supply-adapter`
连同 `payload` 的服务端上传代码拖进了客户端包，dev 报
`Can't resolve 'fs/promises'`，**所有 `/api/media/file/*` 返回 500**。
改为从叶子模块 `domain/public-catalog/mappers` / `contracts` 导入后恢复 200。
这条只有真在浏览器里打开页面才会发现：typecheck / 单测 / build 全绿。

## 5. 本地 `next start` 的一个坑（与本改动无关，记下来省下次排查）

配置守卫拒绝启动的那一次运行，会把失败结果写进 `.next/cache` 的 `unstable_cache`
条目；之后即使用正确环境变量重启，`/shanghai` 等城市路由仍恒 404
（`createCityContextResolver` 对异常 `catch → return null`，路由层 `notFound()`）。
判据：全局路由（`/news` `/entrust`）200 而城市路由全 404。解法：删 `.next/cache` 再起。
