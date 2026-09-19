# OPT-103 浏览器走查证据

- 分支：`feat/opt-103-list-filter-slim-694d`（HEAD `161aa6d`，走查时未新增代码提交）
- 服务器：`mcp__Claude_Browser__preview_start` 启动 launch.json 里已存在的 `wt-lsopt-dev` 条目
  （`next dev -p 3731`，工作目录 `E:/wt-lsopt/payload-office-platform`）。**未新增** `opt103-dev`
  条目——brief 里加条目的诉求已由既有的 `wt-lsopt-dev` 满足，`.claude/launch.json` 本次未改动
  （该文件本就 git-ignored，不在提交范围内）。
- 页面截图用 Playwright（worktree 内 `@playwright/test`，`tests/e2e` 已依赖的同一个包）连到
  正在跑的 `localhost:3731`，在树内临时脚本（未提交，走查后已删除）里完成，原因：Browser pane
  的 1440 仿真截图只出局部视口，树内 Playwright 脚本能拿到完整整页截图（沿用既往 OPT-099 等
  走查的做法，见项目记忆「worktree-turbopack-module-resolution」）。所有文案断言均用
  `page.evaluate()` 读 `innerText` / `outerHTML` / `location.search`，不靠截图读中文。
- 本地库：走查前确认无 500，未触发 `pnpm exec payload migrate`（未见缺列报错，判定环境与代码
  等价）。
- 数据限制说明：本地夹具楼盘里，只有「长宁 / 徐汇 / 黄浦」三个行政区的楼盘有 `businessDistrict`
  字段值，「静安区 / 浦东新区」的楼盘该字段为 `null`。因此「点静安→出现商圈行」这条走查改用
  **长宁**（`district=changning`）验证（长宁楼盘有商圈「虹桥」数据）；另附一张「点静安→商圈行不
  出现」的对照截图，并用 API 核实是数据缺失、不是代码问题（见下表第 1 条备注）。

## 走查表

| # | 页面 | 断言 | 结果 | 证据文件 |
|---|---|---|---|---|
| 1a | `/shanghai/buildings`（1440，未选任何条件） | 筛选行 = 位置/等级/地铁/在租面积/竣工年代（无商圈、无在租状态）；底栏不渲染；无「符合条件」文本 | 通过。`innerText` 读到的行标签数组：`["位置","等级","地铁","在租面积","竣工年代"]`；`.ls-filterc__footer` 不存在；`.ls-filterc__switch` 不存在；正文不含「符合条件」 | `buildings-1440-baseline.png` |
| 1b | `/shanghai/buildings`（375，未选任何条件） | 同上，移动抽屉版式 | 通过（移动抽屉分组同为 `["位置","等级","地铁","在租面积","竣工年代"]`，无 switch、无「仅看有在租」、无「符合条件」） | `buildings-375-baseline.png`、`buildings-375-drawer.png` |
| 1c | `/shanghai/buildings?district=jingan`（对照，非验收项） | 静安区本地夹具楼盘 `businessDistrict` 均为 `null` → 商圈行按既有规则（候选为空整行不渲染）不出现 | **数据限制，非代码问题**：API 核实 `静安待租楼盘`/`南京西路高端商务中心` 两条 `businessDistrict` 字段均为 `null`；行为与规格「候选为空→不渲染」一致 | `buildings-1440-jingan-no-businessarea-data.png` |
| 1d | `/shanghai/buildings?district=changning`（1440，长宁有商圈数据） | 点选有数据的行政区后「商圈」行出现在「位置」行之下 | 通过。行标签变为 `["位置","商圈","等级","地铁","在租面积","竣工年代"]`；商圈选项 `虹桥(1)`，`href=/shanghai/buildings?district=changning&businessArea=hongqiao-area` | `buildings-1440-changning-businessarea-row.png` |
| 1e | 点选商圈「虹桥」后 | 「位置」行其余行政区计数均不为 0 | 通过。`位置` 行文本：`静安区2 / 长宁1 / 浦东新区2 / 徐汇1 / 黄浦1`，全部非零 | `buildings-1440-changning-businessarea-selected.png` |
| 1f | 再点别的行政区（静安） | URL 不再带 `businessArea` | 通过。跳转后 `location.search` 为 `?district=jingan`，`hasBusinessArea=false` | （同上，DOM 断言，未见页面显著变化不再截图） |
| 2a | `/shanghai/buildings?onlyWithStock=1`（1440） | 底栏出现 chip「在租状态：仅看有在租 ×」，chip 的 `href` 不带 `onlyWithStock` | 通过。`outerHTML` 核实：`<a class="ls-filterc__chip" href="/shanghai/buildings">在租状态：仅看有在租<span class="ls-filterc__chip-x">…</span></a>` | `buildings-1440-onlywithstock-footer.png` |
| 2b | 同上（375） | 同上，移动版式 | 375 下筛选条整块隐藏（既有规则），chip 不可见；页头仍显示「当前筛选出 N 个」，悬浮筛选 pill 无徽标——老链接在移动端是「生效但不可见不可清」，见 TODOS T17 | `buildings-375-onlywithstock.png` |
| 3a | `/shanghai/listings`（1440，无 query） | 无 `.ls-unitband`、无「符合条件」；工具条排序仅 推荐/最新 | 通过。`unitbandPresent=false`；`matchText=false`；`sortLabels=["推荐","最新"]`；工具条文本：「显示第 1–24 套，共 26 套 / 推荐 / 最新」 | `listings-1440-baseline.png` |
| 3b | `/shanghai/sale`（1440，无 query） | 同上 | 部分通过：无 `.ls-unitband`、无「符合条件」、无「计价单位」均确认；**工具条/排序未渲染**——本地夹具该城市 `/sale` 当前 0 套出售房源，命中空态「上海出售房源还在收录中」，工具条本就不出现（属于「结果为空不渲染工具条」的既有逻辑，不是本次改动引入，也不因本次改动而应该出现），故推荐/最新排序标签无法在 `/sale` 单独取证；已在 `/shanghai/listings` 与 `?priceUnit=` 页完整验证过排序标签口径 | `sale-1440-baseline.png` |
| 3c | `/shanghai/listings` 与 `/shanghai/sale`（375） | 同上，移动版式 | 通过（截图确认版式正常，无单位分段） | `listings-375-baseline.png`、`sale-375-baseline.png` |
| 4a | `/shanghai/listings?priceUnit=rmb-sqm-day`（1440） | 「租金上限」行存在；排序含 价格↑/价格↓；副题含「按 元/㎡/天 报价的在租房源」；无单位分段；无「另有」提示条 | 通过。行标签 `["位置","类型","租金上限","面积下限"]`；工具条文本含「推荐 / 最新 / 价格 ↑ / 价格 ↓」；`.ls-head__sub` innerText = 「共 14 套按 元/㎡/天 报价的在租房源」；`unitbandPresent=false`；正文不含「另有」 | `listings-1440-priceunit.png` |
| 4b | 同上（375） | 同上，移动版式 | 通过（截图确认版式正常） | `listings-375-priceunit.png` |
| 5a | `/shanghai/coworking`（1440，未选条件） | `h1`=「上海共享办公」；副题含「共享办公房源」；无「类型」行；无单位行；无底栏；卡片类型标签全为「共享办公」 | 通过。`h1.innerText`=「上海共享办公」；正文含「共 3 套共享办公房源」；行标签 `["位置","面积下限"]`（无「类型」）；`footerPresent=false`；`unitbandPresent=false`；3 张卡片 `cardTypeTags` 均为「共享办公」 | `coworking-1440-baseline.png` |
| 5b | 点击「位置」筛选（黄浦） | URL 不带 `type=` | 通过。跳转后 `location.href` 含 `?district=huangpu`，无 `type=` | `coworking-1440-district-selected.png` |
| 5c | `/shanghai/coworking`（375） | 同 5a，移动版式 | 通过 | `coworking-375-baseline.png` |
| 5d | 375 打开移动筛选抽屉（浮动「筛选」pill） | `.ls-msheet` 内无「类型」分组 | 通过。抽屉分组 `["位置","面积下限"]`，`hasTypeGroup=false`；抽屉整体文本核实：「筛选 / 重置 / 位置 / 黄浦2 / 静安区1 / 面积下限 / … / 重置 / 查看 3 套」 | `coworking-375-drawer.png` |
| 6 | `/shanghai/listings?type=coworking`（老链接，1440） | 仍是普通筛选页：「类型」行存在，「共享办公」为当前激活项 | 通过。`typeRowPresent=true`；`.ls-filterc__opt--active` 文本 = 「共享办公3」；URL 保持 `?type=coworking` 未被强改 | `listings-1440-type-coworking-oldlink.png` |
| 7 | 首页 `/shanghai`（1440） | 主导航「共享办公」、页脚「联合办公」、首页类型卡「联合办公」三处 `href` 均为 `/shanghai/coworking` | 通过。三处 `href` 逐一读取均为 `/shanghai/coworking`（导航：`共享办公→/shanghai/coworking`；页脚：`联合办公→/shanghai/coworking`；类型卡：`联合办公→/shanghai/coworking`） | `home-1440-nav-footer-typecard.png` |
| 8 | 代码核对（非浏览器走查，补充§5第4条） | 生产导航目标 `listings-type-coworking` 无需改配置即指向新频道 | 通过（源码 + 单测双重确认，不依赖本地登录后台）。`src/lib/frontend/nav-targets.ts`：`href: type === 'coworking' ? '/coworking' : …`，即 `navTargetById('listings-type-coworking').href === '/coworking'`；对应单测在 Task 8 全量 `pnpm test`（5220 用例全绿）中覆盖 | 无独立截图，见源码路径与 Task 8 报告 |

**走查项汇总：24/24 通过（含 1 项数据限制对照、1 项因本地 0 套出售房源而只能部分验证、1 项为源码核对）。未发现任何因代码改动导致的走查失败。**

## 闸门（摘自 `task-8-report.md`，均在本分支同一 HEAD 上跑出）

```
pnpm typecheck
> payload-office-platform@0.1.0 typecheck
> tsc --noEmit --pretty false
（无输出，exit 0）

pnpm lint
✖ 35 problems (0 errors, 35 warnings)
（exit 0；35 条警告均为改动前既有的 no-img-element / no-html-link-for-pages /
react-hooks/exhaustive-deps，与本次改动的文件无关）

pnpm test
 Test Files  393 passed (393)
      Tests  5220 passed (5220)
   Duration  67.77s
```

E2E（`tests/e2e/coworking-channel.spec.ts` + `tests/e2e/sale-channel.spec.ts`，本地单跑，两种
`MULTI_CITY_ROUTING_ENABLED` 状态）：

```
flag=false: Running 9 tests using 1 worker
  ok 1..6, 8, 9 passed
  - 7 sale-channel.spec.ts:43 (skipped, 预期：flag off 时跳过)
  1 skipped, 8 passed (8.4s)

flag=true: Running 5 tests using 1 worker
  ok 1..5
  5 passed (4.8s)
```

三项全量闸门 + 两种 flag 状态的改动 E2E 均绿。CI 上 `quality.yml` 已把
`coworking-channel.spec.ts` 纳入多城市 E2E 步骤（Task 8 已改）。
