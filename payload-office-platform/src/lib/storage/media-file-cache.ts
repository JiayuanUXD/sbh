/**
 * `/api/media/file/*` 的浏览器缓存策略（2026-10-14，用户裁定「缓存一天」）。
 *
 * ## 为什么要
 *
 * 此前这条路由不回 `Cache-Control`，而网关回的 `Last-Modified` 恰等于请求时刻，
 * 浏览器的启发式新鲜度因此是 0：回访首页时每张图、每段视频都要发条件请求。
 * ETag 是对的、能拿到 304，但每个 304 仍要走一遍容器 → COS `headObject`，
 * 首页二十来张图在 HTTP/1.1 的 6 条连接上排队确认。
 *
 * ## 为什么不是 `immutable`
 *
 * 媒体 URL 不带内容指纹，而**同名覆盖是设计内行为**：水印烘焙 / 重烘
 * （`plugins/watermark.ts`）和派生尺寸回填（`scripts/backfill-media-sizes.ts`，
 * `overwriteExistingFiles`）都会换掉字节、保留 URL。`immutable` 会让已访问过的
 * 用户永远看到旧图。一天是可接受的陈旧窗口；`stale-while-revalidate` 让过期后的
 * 那一次访问先用旧副本、后台再确认，所以最坏是「满一天后的第一次访问」仍是旧图。
 *
 * ## 生效范围
 *
 * - 只在主域名 shangban.cc 生效：平台默认域名的网关把所有响应（含 `/_next/static`）
 *   一律改写成 `no-store`，主域名则原样透传（2026-10-14 实测）。
 * - `public` 意味着日后若前置 CDN，CDN 也会缓存一天——水印重烘后要记得刷 CDN。
 *
 * ## 哪些响应会带上
 *
 * 由 Payload 的 `upload.modifyResponseHeaders` 调用：s3Storage 的文件处理器在
 * 比对 ETag **之前**调用它，所以 200 / 206 / 304 都带（304 带上才能给浏览器里的
 * 副本续期）；对象不存在的 404 与 500 走 catch 分支、不经过这里。
 * 本地磁盘分支的 416（Range 越界）会经过这里，按其 `Content-Range: bytes *\/<size>`
 * 识别后跳过——错误响应不该被缓存。守卫见 `tests/media-file-cache-control.test.ts`。
 */
export const MEDIA_FILE_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800'

export function withMediaFileCacheControl({ headers }: { headers: Headers }): Headers {
  if (headers.get('Content-Range')?.startsWith('bytes */')) return headers
  headers.set('Cache-Control', MEDIA_FILE_CACHE_CONTROL)
  return headers
}
