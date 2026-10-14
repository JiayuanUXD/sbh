# 媒体文件浏览器缓存（2026-10-14）

## 背景

线上 `/api/media/file/*` 不回 `Cache-Control`，网关回的 `Last-Modified` 等于请求时刻，
启发式新鲜度为 0：回访首页时每个媒体请求都要条件请求一次（ETag 正确，拿到 304，
不会重下字节，但每个 304 仍经容器 → COS `headObject`）。用户裁定缓存一天。

## 改动

- `src/lib/storage/media-file-cache.ts`：`public, max-age=86400, stale-while-revalidate=604800`，
  经 Payload `upload.modifyResponseHeaders` 挂到 Media 集合。不用 `immutable` 的原因与生效范围见该文件头注释。
- 不涉及表结构：本地 PG 跑完全部迁移后 `payload migrate:create schema_probe --skip-empty` 未生成任何文件。

## 证据

| 项 | 结果 |
| --- | --- |
| `tests/media-file-cache-control.test.ts` | 先红（模块缺失 → 未挂钩子时 4 条红：200/206/304 无缓存头、钩子未挂）后绿 10/10。后 4 条把 Media 套进生产用 `s3Storage` 插件、打桩 COS 客户端，验真实处理器：200/206/304 带、404 不带 |
| 全量 `pnpm test` | 443 文件 / 6006 条全绿（无 `DATABASE_URL`，postgres 套件按设计不收集） |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | 通过（lint 0 error，35 条既有 warning，改动文件 0 条） |
| 本地 `next start`（本地磁盘存储分支）curl | 200 图、200 派生 webp、206 视频：带缓存头；416 越界、缺文件 500：不带 |

### 首访 vs 回访（`probe-revisit.mjs`，1440×900，同一 context 两个新页面，均先过 OPT-037 哨兵）

| | 媒体请求 | 走缓存 | 打到服务器 | 服务器字节 |
| --- | --- | --- | --- | --- |
| 本地（含改动）首访 | 9 | 0 | 9 | 31,441 |
| 本地（含改动）回访 | 9 | **8** | 1（视频 206） | 16,679 |
| 线上（改动前，对照）首访 | 15 | 0 | 15 | 1,584,630 |
| 线上（改动前，对照）回访 | 15 | **0** | 15（重新验证，CDP 记为 200） | 24,133 |

原始数据：`local-after.json`、`prod-before.json`；回访截图 `home-revisit-*.png`（首访截图几乎相同，未入库）。线上两条控制台错误是
本云端会话代理拒绝 Umami 主机（`ERR_TUNNEL_CONNECTION_FAILED`），与改动无关；本地 0 条。

## 上线后复测（2026-10-14，`sbh-231`，提交 `c7ef54f`）

线上 `curl`（shangban.cc）：

| 请求 | 结果 |
| --- | --- |
| 图片 200 | `cache-control: public, max-age=86400, stale-while-revalidate=604800` |
| 图片带 `If-None-Match` | 304，带同一缓存头（浏览器靠它续期） |
| 视频 `Range: bytes=0-1023` | 206，带缓存头，`content-range: bytes 0-1023/5242726` |
| 视频越界 Range | 416，**不带**缓存头 |
| 不存在的文件 | 403（Payload 文件访问检查查不到记录），**不带**缓存头 |

同一脚本对线上复测（`prod-after.json`，与改动前的 `prod-before.json` 对照）：

| | 媒体请求 | 走缓存 | 打到服务器 | 服务器字节 |
| --- | --- | --- | --- | --- |
| 线上改动前 回访 | 15 | 0 | 15（全部重新验证） | 24,133 |
| 线上改动后 回访 | 15 | **15** | **0** | **0** |

本地未能验证的视频 206 缓存在线上成立（S3 分支有 ETag）。

### 切流后的一个现象（已查明，非缺陷）

切流后约 5 分钟内，同一图片 URL 的 200 响应约四到七成不带缓存头，两类响应除该头外完全一致。
查 CloudRun 部署记录：上一版本 `sbh-230` 已 `FlowRatio 0 / HasTraffic false`，但 `ScaleStatus` 尚未变为
`zero`（更早版本均为 `zero`），旧实例仍在应答。07:35 抽样 3/10 带头，07:36 变为 10/10，之后稳定。
结论：平台切流后旧实例有数分钟退场窗口，**切流完成 ≠ 全部请求已由新版本应答**，上线复测应在旧版本缩容后进行。
