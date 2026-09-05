# OPT-070 验证记录（2026-09-05）

环境：本工作树专用库 `sbh_dev_opt070`（migrations.md「多 worktree 各用独立库名」），
`pnpm exec payload migrate` + `pnpm seed` + `pnpm seed:media` 后为基线。
分支基于 `origin/master`（1b2ad27）。

## 先读这条，别误读 `fk-scan.txt`

扫描输出里 `listings_gallery.image_id`、`listings_media_items.resource_id`、
`buildings_media_items.resource_id` **改后仍标着 `DEADLOCK`**——这是**预期**的：
本工作项的口径是「钩子摘除，不放宽 NOT NULL」，`DEADLOCK` 行只是在如实报告
数据库约束的形状（`attnotnull=true` + `confdeltype='n'`），而**本工作项不改 schema**。
死结之所以不再发作，是因为 `Media` 的 `beforeDelete` 在 PG 执行 SET NULL 之前
已经把那些行删掉了，SET NULL 无行可置。理由见
`src/domain/media/media-delete-cleanup.ts` 头注释。

`city_site_profiles_type_card_overrides.cover_image_id` 也标着 `DEADLOCK`——
那是**另一条在建分支**（`fix/media-delete-notnull-fk-7c4a` / 提交 58b4c43）的修复，
尚未合入 master，因此不在本分支的基线里，也不属本工作项范围。

## 自动化

- `tests/media-delete-listing-building-postgres.test.ts`（新增，真库）
  - 接钩子**之前**：6 条里 5 条红，报错就是目标错误
    `23502 UPDATE ONLY "listings_gallery" SET "image_id" = NULL`
  - 接钩子**之后**：6/6 绿
- `pnpm typecheck`：干净
- `pnpm lint`：0 error（21 条既有 `no-img-element` warning）
- `pnpm test`（带 `DATABASE_URL`，真库用例未被跳过）：**324 个测试文件 / 4344 个单测全绿**
- `pnpm seed:media`：跑通到「媒体数据挂载完成。」——**这是删掉手工解引用之后跑的**

## 浏览器实测（`pnpm exec next dev --webpack -p 3718`，夹具账号 e2e-adm@example.com）

删除 media 44（`现代办公楼开放式办公区`，被 **11 条房源图集 + 2 条媒体工作台行**引用，
改前必定 500）：

- `DELETE /api/media/44` → **200 OK**，toast「媒体「现代办公楼开放式办公区」已成功删除。」
- 库内后果（见 `db-state-after-delete.txt`）：
  - media 44 已删除
  - 三张死结表残留引用行 **0 / 0 / 0**
  - `buildings_gallery` 空行 0、`listings.cover_image_id` 为 NULL 的行 0
  - 房源总数仍为 11（**没有连带删除任何房源**）
  - `listings_gallery` 33 → 22（摘掉 11 行）、`listings_media_items` 9 → 7（摘掉 2 行）
  - `_order` 留下空档 `[2,3]`，剩余图片 `[45,46]` 顺序正确
- 后台房源详情「展示内容」页签：媒体工作台 3 张图 `naturalWidth=1200` 全部加载成功，
  **0 张无 src、0 张加载失败**——被删的那张是整块消失，不是破图占位。
- 后台「信息完整度」卡片（innerText 核对，非截图肉眼）：缺项含「✗ 房源图集」，
  计数是 **2 而不是 3**——证明保持 NOT NULL 的不变量守住了，没有幽灵空行虚增
  `galleryCount`。这正是没选「放宽 NOT NULL」的原因。
- 后台「前台可见性」卡片：`✓ 已上架 ✓ 审核通过 ✓ 可见性正常 ✓ 未被举报暂停`——
  **删图没有让房源跌出有效供给**，实测印证 supply.md §6 自 2026-08-19 起媒体数量
  不再参与前台可见性。
- C 端 `/shanghai/listings/media-rich-listing`：图集正常渲染，剩余 gallery-2 /
  gallery-3 均 200，页面 HTML 里已无被删图片的任何痕迹。

## 一条被查清的假警报

浏览器验证途中 C 端出现过一次
`GET /shanghai/listings/media-rich-listing → 500`，服务端日志是
`TypeError: Cannot read properties of undefined (reading 'call')`，紧邻
`[Fast Refresh] rebuilding`。冷重启 dev server 后复测：
`/shanghai/listings/media-rich-listing`、`/shanghai/listings/jingan-serviced-office-42-seats`、
`/shanghai`、`/` **全部 200，服务端零错误**。确认是 webpack HMR 重建产物，与本次改动无关。
