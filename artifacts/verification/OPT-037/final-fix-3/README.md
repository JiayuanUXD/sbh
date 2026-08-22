# OPT-037 终审第 3 轮验证证据（证据补测 + 脚本哨兵）

逐条结论见 `.superpowers/sdd/2026-08-21-detail-pages-redesign/final-fix-3-report.md`
（该目录被 `.gitignore` 忽略，**该留在仓库里的结论已迁进
`specs/work-items/OPT-037-detail-pages-redesign.md` §8.6 / §9.7–9.9 与 `.agent/{frontend,testing}.md`**）。

本轮**零产品代码改动**（只有 `DetailPanel.tsx` 与 `detail.css` 各一处**注释**订正，
是终审文档订正表点名要求的，无任何可执行行变化）。

## 环境（复现前先读）

```bash
cd payload-office-platform
CI=1 pnpm build          # NEXT_PUBLIC_SITE_URL 在这一步被内联，见下方 ⚠️

# 关闭态（R2/R3/R4/R5 用）
CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> \
  MULTI_CITY_ROUTING_ENABLED=false PORT=3810 pnpm exec next start -p 3810
# 开启态（R1 用）
CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> \
  MULTI_CITY_ROUTING_ENABLED=true  PORT=3811 pnpm exec next start -p 3811
```

- **不覆盖 `DATABASE_URL`**（默认库 `postgres`，夹具最全）；端口避开别人的 3717。
- `CI=1` 是真开关（`lib/storage/cos-config.ts:86` 用它豁免 COS 检查）；不设就是 config-guard
  fail-closed，实测症状是 `/listings`、`/listings/<slug>`、`/buildings` 全 404 而
  `/buildings/<slug>`、`/news` 仍 200。
- ⚠️ **`NEXT_PUBLIC_SITE_URL` 在 `next start` 时传对页面渲染没用**：`site-config.ts` 读的是静态成员
  表达式，Next 在 `next build` 时把它内联成字面量（本树是 `.env.local` 的 `http://localhost:3717`）。
  所以 canonical / JSON-LD `url` 的 **origin 恒等于构建时的值，断言只能打 path**。
  它在启动时唯一还生效的地方是 `config-guard`（那边把整个 `process.env` 当对象传，是运行时读）。
- 本地 server 挂久了（实测约 40 分钟）楼盘详情会被 job-queue cron 报错拖到超时——**先重启再取样**。

## 共享「页面渲染哨兵」

判据唯一事实源：`../lib/sentinel.json`（状态码 + 每个路由族的关键选择器/标记）。
三个薄读取器（三种运行时无法共用代码，但判据只有一份）：

| 文件 | 给谁用 |
|---|---|
| `../lib/sentinel.mjs` | Playwright / Node（`gotoChecked` / `gotoOrThrow` / `headStatus`） |
| `../lib/sentinel.py` | difflib 侧（读同目录 `status.json`；历史 dump 走 `--allow-missing-status` 降级，退出码恒 2） |
| `../lib/sentinel.sh` | curl 抓取侧（`sentinel_fetch` 真读状态码并写 `status.json`） |
| `../lib/domdiff.py` | 三支 `task11{c,d,e}-domdiff.py` 的公共实现（原本是三份逐行相同的副本，三份都缺哨兵） |

**新写验证脚本一律引用它，不要各写一份。**

## 本轮产物

| 文件 | 内容 |
|---|---|
| `r1-multicity.{mjs,json,txt}` | R1：多城**开启**态 vs 关闭态的 legacy 307 / JSON-LD url / 面包屑前缀 / robots，四断点 |
| `r2r3-task9-recheck.{mjs,json,txt}` | R2：`[data-detail-analytics-event]` 分组计数；R3：移动底栏价格的**真可见性**（页首 + 页尾各一次） |
| `r4-coworking.{mjs,json,txt}` + `r4-*-{375,768,1440}.png` | R4：联合办公组四态重拍（12 张，md5 两两不同）+ 每张截图前的 `scrollWidth === clientWidth` 落盘 |
| `r5-page-overflow.{mjs,json,txt}` + `r5-*-{375,768,1440,1920}.png` | R5：LocationPanel 页与供给区页的**页面级** `documentElement.scrollWidth` + fullPage 截图 + offenders |
| `capture-html.mjs` | 带哨兵与 `status.json` 的 HTML 取样器（页面集 `r6` / `r7c` 写在同一个 SETS 里） |
| `r6-htmldiff.py`、`r6-htmldiff.txt`、`r6-{before10b,after10b,after10b-ctrl}-html/`、`r6-build-*.log` | R6：Task 10b 改前(`39773fa`)/改后(`858d0f7`)双构建 HTML 逐字节比对 + **噪声本底对照组** |
| `r7c-{before,after,after-ctrl}-html/`、`r7-11c-domdiff.txt`、`r7-build-11c-*.log` | R7：重建 Task 11c 丢失的 HTML 输入（`cc58023` vs `5dd653e`）并重跑比对 |
| `r7-11de-domdiff-recheck.txt` | R7：11d/11e 已入库 dump 在新哨兵下的复核（退出码 2 = 一致但状态码不可复核） |
| `r-prefetch-regex-recheck-11c.txt` | 修正 `detailPrefetched` 正则后重跑 11c 预取，确认没有此前被正则藏起来的详情页预取 |

## 复现

```bash
node   artifacts/verification/OPT-037/final-fix-3/r1-multicity.mjs
node   artifacts/verification/OPT-037/final-fix-3/r2r3-task9-recheck.mjs
node   artifacts/verification/OPT-037/final-fix-3/r4-coworking.mjs
node   artifacts/verification/OPT-037/final-fix-3/r5-page-overflow.mjs

# R6 / R7 需要在临时 worktree 上分别构建两个历史提交后取样
node   artifacts/verification/OPT-037/final-fix-3/capture-html.mjs http://localhost:3820 <tag> [r6|r7c]
python artifacts/verification/OPT-037/final-fix-3/r6-htmldiff.py <beforeDir> <afterDir>
python artifacts/verification/OPT-037/task11c-domdiff.py <beforeDir> <afterDir> [--mask-poi]
```
