# OPT-096 本地走查记录（2026-09-12）

环境：worktree `E:\wt-096`，分支 `feat/opt-096-building-form-nav-submenu-2db1`（基于 `origin/master` `291e4a5`，含 OPT-095），`next dev -p 3728`，**独立任务库 `sbh_dev_096`**（`CREATE DATABASE … TEMPLATE postgres` 克隆夹具库，本迁移已 `payload migrate` 执行）。夹具库没有出售房源，走查前在任务库里 `update listings set business_type='sale' where id=4`（外滩源大厦）；房源 1 的建筑形态由后台真点选写入（见下）。截图与 DOM 判据由 Playwright（chromium）脚本一次产出。

## 后台（夹具账号 `e2e-adm@example.com`，`/admin/logout` 后经 API 登录）

| 操作 | 结果 | 证据 |
|---|---|---|
| `/admin/collections/listings/1` | 基本信息区出现「建筑形态」react-select 多选，描述文案「可多选。独栋 / 双排 / 联排；与「类型」互不干扰，不填不影响发布。」 | `admin-building-form-field.png` |
| 点控件输入「独栋」回车、再「联排」回车 → 保存 | `PATCH /api/listings/1` **200**；`GET /api/listings/1?depth=0` 回读 `buildingForm: ["detached","townhouse"]` | `admin-building-form-selected.png`、`admin-building-form-saved.png` |
| 点掉两个 tag → 保存 | 200；回读 `[]` | — |
| 站点设置 → 详情页参数 → 房源「建筑形态」 | 迁移列 `detail_spec_fields_listing_building_form DEFAULT true`；用 API `POST /api/globals/site-settings {detailSpecFieldsListing:{buildingForm:false}}` 关掉 → 详情该行消失（`null`）；改回 true → 「独栋、联排」回来 | 脚本输出 `settingsToggle` |

## C 端

| 路由 / 视口 | 结果 | 证据 |
|---|---|---|
| `/shanghai/listings/jingan-serviced-office-42-seats` 1440 | 「房源概况」参数表「建筑形态：独栋、联排」 | `listing-detail-spec-building-form-1440.png` |
| `/shanghai/listings` 1440 | 筛选条多一行「建筑形态：独栋 1 · 联排 1」（计数 = 有效房源里带该形态的数） | `listings-filter-form-1440.png` |
| `/shanghai/listings?form=detached` | 结果只剩 `jingan-serviced-office-42-seats` 一套；「独栋」pill 高亮，底栏 chip「建筑形态：独栋 ×」 | 同上 |
| `/shanghai` 1440，hover「找楼盘」 | `.site-nav__menu` `visibility: hidden → visible`，子项 `租赁 → /shanghai/buildings`、`出售 → /shanghai/buildings?business=sale`；鼠标移开恢复 hidden；父项 `focus()` 同样展开，再按 Tab 焦点落到「租赁」 | `nav-dropdown-hover-1440.png` |
| `/shanghai/sale` | 顶层只有「找办公室」`aria-current`，子项只有「找办公室>出售」高亮 | 脚本输出 `navOnSale` |
| `/shanghai/buildings?business=sale` 1440 | 只列外滩源大厦 1 栋（任务库唯一有出售房源的楼盘），卡片「1 套在售 · 合计 120 ㎡」；页面无「套在租」「仅看有在租」；无紧凑行分组；H1「上海写字楼出售」；`<title>` 「上海在售写字楼楼盘 · 商办买卖 · 商办租赁」；`robots: noindex, follow`；导航「找楼盘」+「出售」高亮 | `buildings-sale-head-1440.png`、`buildings-sale-cards-1440.png` |
| `/shanghai/buildings` 1440 | 与改前一致：「套在租」「仅看有在租」都在，H1「上海写字楼」，`robots: index, follow`，导航「找楼盘」+「租赁」高亮 | 脚本输出 `buildingsLease` |
| `/shanghai` 375 抽屉 | 「找办公室」下缩进两行「租赁 / 出售」（padding-left 40px vs 16px，字号 14），「找楼盘」同；点「出售」→ 抽屉关闭、URL `/shanghai/sale` | `drawer-submenu-375.png` |

走查中发现并修掉一处：抽屉二级项的 CSS 起初插在基础规则之前被 `padding` 简写压掉（截图里没缩进），挪到基础规则之后重截确认（`d35e2ea`）。

## 闸门

- `typecheck` 干净；`lint` 0 error / 35 warning（与 master 基线相同）
- `migrate:dry-run`：`20260912_144311_opt_096_building_form` `up/down/json` 齐全、无禁用模式（4 条 warning 为既有迁移）
- `test:changed`：193 files / 2456 passed
- E2E 自查：`landing-pages.spec.ts`「只有一项激活」改为只数顶层 `.site-nav__link`，并加子项「租赁」高亮断言；其余 E2E 未引用改动的选择器 / 文案。全量 E2E 留 CI
- 发布兼容：扫描行经 `unstable_cache` 落盘，发布后 5 分钟内旧行没有 `buildingForm`——`listing-scan.ts` 对缺字段按空数组处理（`5868712`），否则新版上线即列表页 500
