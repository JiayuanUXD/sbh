# OPT-073 浏览器走查记录

- 执行日期：2026-09-06
- 分支：`docs/opt-073-featured-district-count-01ee`（走查时 HEAD = `ac619b6`）
- dev server：`preview_start` 起 `.claude/launch.json` 的 `dev`（`next dev -p 3717`，Turbopack），主工作树，非 worktree
- 数据库：`.env.local` 的本地 PG（`postgres` 库），Task 4 的迁移已执行
- 登录账号：`e2e-adm@example.com`（`scripts/seed.ts` 里的 E2E 公开夹具）

## 0. 先修本地夹具，否则这条特性在本地看不出差别

上海本地夹具里前台可见且有在营楼盘的商圈**只有 3 个**（虹桥、徐家汇、外滩），
陆家嘴与南京西路虽然 `frontendVisible=true`，但它们该挂的楼盘
（`lujiazui-grade-a-river-view`、`west-nanjing-premium-center`）`businessDistrict` 是空的，
被 facade 的质量门槛挡在卡片池外。

这种数据下 5 档与 3 档都只渲染 3 张，**切档位不会有任何可见变化**，走查等于没走。
故临时把这两栋楼挂回各自商圈（只改本地库，走查结束已还原为 NULL，已复核）。

## 1. 默认档位 = 现状（5 张两行）

改配置之前，`/shanghai` 首页：

```
cards: ["虹桥", "徐家汇", "外滩", "南京西路", "陆家嘴"]
classes: [hm-bento__main, hm-bento__small, hm-bento__small, hm-bento__wide, hm-bento__wide]
rows: 2
```

存量七城 profile 的 `featuredDistrictCount` 经 API 读出**全部是 `'5'`**，不是 NULL——
PG 的 `ALTER TABLE ... ADD COLUMN ... DEFAULT '5'` 会回填既有行。
故 Task 4 评审提出的「存量行为 NULL、后台可能显示空白」这条 Minor **实测不成立**，
不需要补回填 UPDATE。

## 2. 后台字段

`/admin/collections/city-site-profiles/1` →「首页内容」页签，可访问性树读出：

```
generic "热门商圈显示数量"
 label "热门商圈显示数量"
 generic "5 张"
 listbox
  option "5 张"
  option "3 张"
 generic "首页热门商圈展示 3 张或 5 张。该城可见且有在营楼盘的商圈不足时会自动减少。"
```

- 位置：在「精选区域」与「按类型浏览」封面之间，符合设计。
- 默认显示「5 张」。
- 描述文案与规格逐字一致。
- 选项只有两个，没有第三档。

文案一律用 `innerText` / 可访问性树核对，未依赖截图（低分辨率截图会误读中文）。

## 3. 三态切换（真实表单操作，非 API 改写）

用 ref 点击下拉 → 点选「3 张」→ 点击右上角「保存」按钮：

| 步骤 | 后台读回值 | `/shanghai` 商圈卡 |
|---|---|---|
| 初始 | `'5'` | 虹桥、徐家汇、外滩、南京西路、陆家嘴（5 张两行） |
| 表单选「3 张」保存 | `'3'` | 虹桥、徐家汇、外滩（3 张单行） |
| 表单选回「5 张」保存 | `'5'` | 恢复 5 张 |

3 张形态是大卡 + 两张小卡的单行布局，正是 `HomeDistrictBento` 既有的降级形态，
展示层与 CSS 未做任何改动。

## 4. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：4545 passed / 41 skipped，exit 0
- E2E 自查：`tests/e2e/admin-navigation.spec.ts` 与 `tests/e2e/geography-admin.spec.ts` 命中「城市站点配置」，
  但两者只断言该入口在菜单里的**分组位置**，不涉及字段，本次改动不影响。
  按仓库惯例未在本地跑全量 E2E。

## 5. 未覆盖 / 如实说明

- **截图未取到**。Browser 面板在本次会话中处于隐藏状态，`screenshot` 反复超时或返回空帧
  （已知现象：面板隐藏时页面不合成帧）。走查改用可访问性树 + `innerText` + DOM 查询完成，
  这些同样跑在真实 dev server 与真实 Payload 后台上，但**没有像素级证据**，
  视觉细节（间距、卡片比例）本次未做视觉核对——不过本工作项未改任何布局与 CSS。
- **生产后台未验**。生产需要用户登录态，agent 不输入密码，未做。
- 走查用的是本地库，非生产数据。
