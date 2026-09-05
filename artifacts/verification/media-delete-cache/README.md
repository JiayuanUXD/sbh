# 删 media 后前台缓存是否失效 —— 浏览器走查证据

被测改动：给 `Media` 加 `beforeDelete` / `afterDelete` 两段钩子，反查引用这张图的公开消费方
并失效对应缓存 tag（`src/domain/media/media-cache-hook.ts`）。

## 结论

| 变体 | `cacheHeldDuringOutOfBandChange` | `stillRenderedAfterDelete` | 含义 |
|---|---|---|---|
| control（两段钩子摘掉） | true | **true** | 删完图，城市页继续吐这条已删除的文件 URL（前台破图） |
| fixed（钩子接上） | true | **false** | 删完图，下一次请求就回源，页面不再出现这条 URL |

原始读数：`control-unwired-run.json` / `fixed-run.json`。

`fixed-run.json` 是 **rebase 到 #151（OPT-070）之后重跑的**：那次合并把
`unmountMediaReferences` 也放进了同一个 `beforeDelete` 数组，钩子接线变了，
原先那份读数不再代表被测代码，所以整趟重做了一遍。control 组的读数没有重跑——
它测的是「没有任何失效钩子时会怎样」，与 #151 无关（#151 自带的那半失效钩子已在
rebase 时按两边约定删掉，失效面统一归 `media-cache-hook.ts`）。

## 复现方式

脚本随证据一起提交，两支都在 `payload-office-platform/scripts/verification/`：

- `media-delete-cache-fixture.ts` —— 造一张新图并挂到上海城市站点配置的 hero 背景图上，打印 id 与文件名；
- `media-delete-cache-walkthrough.ts` —— 走完「预热 → 缓存本底对照 → 删除 → 复查」四步并打印读数。

每个变体跑一整趟：

```bash
cd payload-office-platform
# 1. 造夹具（记下 mediaId / filename / profileId）
node --env-file-if-exists=.env.local --import tsx scripts/verification/media-delete-cache-fixture.ts
# 2. 生产构建 + 起 server（见下面「环境」一节，缺任一项读数都不算数）
CI=1 pnpm exec next build --webpack
CI=1 NEXT_PUBLIC_SITE_URL=https://sbh.example.test pnpm exec next start -p 3719
# 3. 走查
node --env-file-if-exists=.env.local --import tsx scripts/verification/media-delete-cache-walkthrough.ts \
  --media-id=<id> --profile-id=<id> --filename=<file.jpg>
```

control 变体：把 `src/collections/Media.ts` 里 `hooks.beforeDelete` / `hooks.afterDelete` 清空，
重新构建，再跑一整趟。

## 环境（三条，缺任一条读数都是假的）

1. **必须是 `next build` + `next start`，不能用 `next dev`。**
   第一版走查就是在 dev 下做的，control 与 fixed 给出了**完全相同**的结果（都是
   `stillRenderedAfterDelete: false`），整趟证据作废。原因是 dev 下 `unstable_cache`
   握不住这份数据——本目录的判据 `cacheHeldDuringOutOfBandChange` 在 dev 下实测为 `false`，
   在 `next start` 下为 `true`。**这条判据就是为了让这类无效走查当场失败而加的。**
2. **`next start` 需要 `CI=1` 与一个 https 的 `NEXT_PUBLIC_SITE_URL`。**
   缺 https / 指向 localhost 会被 `lib/runtime/config-guard.ts` fail-closed 拒绝启动
   （日志里是 `[config-guard] 生产配置 fail-closed`）；缺 `CI=1` 则会因为没配 COS 被拒。
   注意 config-guard 读的是运行时 `process.env`，所以这个 https 值**不必**在构建时给。
3. **每趟走查前删掉 fetch-cache 再起 server，两步缺一不可。**
   夹具脚本的写库不在请求上下文里（日志里是 `skipped_outside_request_scope`），
   它自己触发不了失效；而 `unstable_cache` 落盘在磁盘上，只重启不删缓存会读到上一趟的旧
   profile。**路径别照抄**：它随 distDir 变化，本次实测 `next dev --webpack` 落在
   `.next/dev/cache/fetch-cache`、`next start` 落在 `.next/cache/fetch-cache`，
   先 `find .next -type d -name fetch-cache` 确认再删。

## 为什么走查里要插一段「带外改库」

只验「删除后页面不再出现这条 URL」是验不出东西的：删除会把外键置空（`ON DELETE SET NULL`），
**缓存未命中**同样会得到「页面上没有这条 URL」。所以删除之前先做一次对照——在请求上下文之外
把 `heroMedia` 改掉，再取一次页面，此时页面必须还是旧值，这才证明缓存真的握着这份数据、
后面那一步的差异才是失效带来的。改完再原样改回去。

## 没验到的部分

- **后台「素材库」删除按钮的真实点击没做**：本次会话里 Browser pane 处于隐藏状态
  （viewport 0×0、a11y 树为空），点不了。走查改走 `POST /api/users/login` +
  `DELETE /api/media/:id`——与后台删除按钮同一条 Next route handler、同一个请求上下文，
  对本改动（缓存失效依赖请求上下文）是等价路径，但**「按钮本身还能不能用」这一条没有覆盖**。
- 多实例下 `revalidateTag` 只作用于当前实例（`OPT-042` 未解），其余实例仍要等 TTL 自然过期。
  本走查是单实例，覆盖不到这一点。
