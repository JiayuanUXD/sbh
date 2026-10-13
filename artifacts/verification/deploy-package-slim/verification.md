# 部署包第二轮瘦身 验证记录（2026-10-13）

## 背景

run 38222193643 / 38266385896：包 2.99MB，按 COS 单次 PUT 200s 上限要求 ≥14.9KB/s；
两台 runner 十次上传均速 12.3–15.2KB/s，全部失败（`UserNetworkTooSlow` / curl 28）。

## 包体积（`git archive --format=zip HEAD:payload-office-platform`）

| | 字节 | 要求最低均速 |
|---|---|---|
| 改前 `81463bf` | 2,990,172 | 14.9KB/s |
| 改后 `d7ba7b1` | 2,465,722 | 12.3KB/s |
| 再改 `3167658`（兜底图去水印 + q50） | 2,393,249 | 12.0KB/s |

包内确认：`scripts/` 只剩 `migrate-locked.ts`；`seed/`、`.agent/`、根级 md、dev-story 页面与演示组件均不在包内；
`Dockerfile`、`src/test/factory/roles.ts` 仍在。

## 按云端构建方式复现

1. 解压改后的包到空目录，补 `build-info.json`。
2. 照 Dockerfile builder 阶段：`pnpm install --frozen-lockfile` →
   `pnpm generate:types && pnpm payload generate:importmap && pnpm build`（构建期环境变量与 Dockerfile 一致，不连库）。
   结果：Compiled successfully，TypeScript 通过，exit 0。构建期 `[city]` 静态参数取库失败走既有降级
   （`city_static_params_unavailable`），与本改动无关。
3. 照 Dockerfile CMD：`pnpm exec tsx scripts/migrate-locked.ts && exec pnpm start`，连空 PG 库。
   全部迁移从零跑完（含 import `src/test/factory/roles` 的迁移），`/api/health` 200，`version` 回显 `d7ba7b1`。
   本地无 COS，按 CI E2E 的同一口径设 `CI=true` 绕过 config-guard 的 COS 检查。

## 浏览器（Playwright Chromium，`next start` 生产 server，`pnpm seed` 夹具数据）

- `/` 200；hero `<img>` 指向 `/_next/static/media/hero-poster.*.jpg`，naturalWidth×Height = 1600×900，资源 200 / image/jpeg / 157,434B。截图：`home-1440.jpg`、`home-375.jpg`。
  兜底图第二版：从 master 原图裁掉底部 40px（「可灵AI」水印在 y 1050–1079）与左右各 35px（保持 16:9），1600×900 q50，85,914B；重新构建后复验同上，截图 `home-1440-v2.jpg`。
- `/entrust` 200；`og:image` = `https://shangban.cc/_next/static/media/hero-poster.*.jpg`，本地取同路径 200 image/jpeg。
- `/dev-story` 404（与改前生产行为一致：生产环境 `notFound()`）。
- `/admin/login` 200，登录表单渲染。

## 仓库内检查

`pnpm typecheck` 通过；`pnpm lint` 0 error；`pnpm test` 438 文件 / 5974 用例全过。
守卫用例反向验证：删掉 `scripts/migrate-locked.ts -export-ignore` 例外后，该用例按预期变红。
