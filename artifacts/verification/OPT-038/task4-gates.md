# OPT-038 Task 4 闸门与实跑证据（商圈布局 + 区位映射补齐）

分支 `feat/opt-038-city-recruit-page-7a3e`，基线 `d47d1fd`。

## 本地闸门

| 闸门 | 结果 |
|---|---|
| `pnpm typecheck` | 通过，零输出 |
| `pnpm test` | **244 passed / 2 skipped**（3442 tests passed / 4 skipped），零失败（基线 243 文件 / 3435 用例，新增 1 个测试文件 + 3 个用例） |
| `pnpm lint` | **22 warnings / 0 errors** —— 与基线 22 持平，未超 |
| `pnpm build` | 成功；路由清单含 `ƒ /dev-story/opt038` |
| `pnpm migrate:dry-run` | 未跑：本任务零 collection 改动、零迁移（`src/migrations/` 一字未动） |

## E2E（本地实跑，生产 server）

环境（照 Task 1–3 跑通的那套）：

- `pnpm build` 与 `next start` 均带 `CI=1` + `NEXT_PUBLIC_SITE_URL=https://sbh-286300-10-1253925058.sh.run.tcloudbase.com`
  + `MULTI_CITY_ROUTING_ENABLED=false`；端口 **3919**（避开 3717）；**未覆盖 `DATABASE_URL`**（默认库 `postgres`）。
- 起 server 后**先真读 HTTP 状态码预热**：

```
/ 200 · /listings 200 · /buildings 200 · /city-partner 200 · /admin 200 · /hangzhou 200
/dev-story/opt038 404（按设计）
```

  房源类 `/listings` 与楼盘类 `/buildings` 同为 200 —— memory 里「房源全 404、楼盘全 200」
  的环境失配指纹不存在。
- 随后跑 Playwright，**不带 `CI=1`**，靠 `reuseExistingServer` 复用已预热的 server。

结果：**140 passed / 1 failed / 14 skipped（2.0m）**。

唯一失败是 `tests/e2e/admin-navigation.spec.ts:664`（「消息通知」叶子入口缺失），
**先于本批存在**，Task 3 已用 stash 全部 `src/` 改动重新 build 复跑证伪其与本批的关联。
本任务改的是 C 端招募页组件 / 招募页样式 / 城市 profile mapper，与后台导航配置无交集。
Task 1/2 报的「141 passed / 0 failed」与本次「140 passed / 1 failed」合计同为 141 条执行用例。

## 四断点实测（`next dev` 3921，`/dev-story/opt038`，**每次改视口后 reload 再取值**）

> reload 是硬要求：只 `resize_window` 不刷新时 `100vw` 出血层保持旧视口宽，会读出整套假数
> （工作项 §5.5.2，Task 2 实地踩过）。

| 视口 | 容器 | 网格列 | 列宽 | 页面横向溢出 |
|---|---|---|---|---|
| 375 | 343（左留白 16） | `343px`（单列） | 343 | `scrollWidth 375 == clientWidth 375` → **0** |
| 768 | 736 | `229.328px ×3` | 229.33 | 761 vs 753 = 8px（全站既有，见下） |
| 1440 | 1024 | `325.328px 325.328px 325.344px` | **325.33** | 1433 vs 1425 = 同上 8px |

- 1920 未单独取值：容器恒被 `--rc-w` 夹到 1024，商圈段在 1440 与 1920 下取值相同，
  差异只有背景带出血宽度，Task 1 已实测过。
- 8px「溢出」：全站 `100vw` 出血与滚动条宽度之差，由 `body { overflow-x: clip }` 兜住、
  不产生实际滚动；首页 `/` 在同一台机器上数值完全相同（Task 1 §5 已证）。**非本任务引入。**

## 取值实测（1440，`getComputedStyle` / `getBoundingClientRect`）

```
section        background rgb(255,255,255)  padding-block 72px / 72px   width 1440
container      width 1024
h2 (.hm-h2)    40px / 600 / 44px(=40×1.10) / letter-spacing normal / margin 0
引导语          21px / 400 / 28.98px(=21×1.38) / letter-spacing 0.231px(=21×0.011em)
               max-width 702px / margin-top 16px / color rgb(110,110,115) / 实测宽 702
网格            grid-template-columns 325.328px 325.328px 325.344px
               row-gap 48px · column-gap 24px · margin-top 48px · list-style none · padding 0
每格            padding-top 20px · border-top 1px solid rgba(0,0,0,0.08)(=--line) · gap 10px
商圈名          24px / 600 / 28.8px(=24×1.2) / letter-spacing normal / rgb(29,29,31)
区位            17px / 400 / 24.99px(=17×1.47) / letter-spacing normal / rgb(110,110,115) / text-wrap pretty
```

行盒实测（1440，`Range.getClientRects`）：第一行三格各 110 高（区位折 2 行），
第二行三格各 85 高（区位 1 行或缺失）；网格总高 243 = 110 + 48 + 85。
375 单列下 `anyCellOverflow === false`，768 三列下同。

## 状态与空态走查

- **六个商圈统一渲染**：`.rc-district-grid` 的 `innerHTML` 实测不含「首批 / 筹备中」任一字样
  （页面上出现这两个词的只有表单城市下拉的「杭州（筹备中）」与预览页说明文字，均先于本任务存在）。
- **区位三态**：`静安区 · 上海高端商务、零售与企业总部办公核心商圈。`（两段都在）/
  `南京西路、苏河湾等高端商务办公聚集区。`（行政区，上级即本城 → 只剩区域介绍，不重复城市名）/
  虹桥（两段都缺）→ `.rc-district__area` 节点**整个不渲染**，6 格里只有 5 个 area 节点，
  且全页无「—」。
- **整段空态**：`districts=[]` 的预览区块下，除外壳自带的标题块外 `children.length === 1`，
  h2 与引导语一并不渲染。

## depth 探测

`payload-office-platform/scripts/verification/opt038-featured-regions-depth-probe.ts`
（随证据提交，输出见 `task4-depth-probe.txt`）。脚本会临时给上海 profile 写入 6 个真实商圈、
探完在 `finally` 里原样还原，并在开头 fail-fast 拒绝非 localhost 的 `DATABASE_URL`。

结论（本地库上海 profile，locations #2–#11）：

| depth | `featuredRegions[i]` | `.parent` |
|---|---|---|
| 1 | 完整 Location（`description` 已在） | **裸 id**（`number(1)` / `number(2)`） |
| 2 | 完整 Location | **完整 Location**（`name` / `type` 都在）→ 区位副标的上级名拿得到 |
| 3 | 完整 Location | 完整 Location，且多展开了 `parent.parent`（本页用不上） |

即现有取数的 `depth: 2` **刚好够用，不需要改取数**。
另实测层级：`business_area.parent` 是行政区、`district.parent` 是城市本身。
