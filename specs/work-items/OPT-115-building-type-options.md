# Task Packet：OPT-115 楼盘物业类型选项改为五类办公业态

> 状态：**第一期（扩展）已实施，待合并；第二期（收敛）待第一期全量上线后另开**（PR #224 评审 P1 后改为两期，见 §2 D3）
> 创建日期：2026-10-15
> 分支：`feat/opt-115-building-type-options-62dd`
> 来源：用户需求「把物业类型的选项值改为：传统办公、联合办公、整层办公、独栋办公、商务园区」

**目标：** 楼盘「物业类型」（`buildings.buildingType`）的选项换成五类，存量数据按确认的映射迁过去；发布过程中新旧版本都能正常读写。

---

## 1. 现状（2026-10-15，master `d3b52313`）

| # | 事实 | 位置 |
|---|---|---|
| E1 | 选项是代码里的固定枚举：写字楼 / 商务园区 / 商业综合体 / 服务式办公；注释写「合理默认值域，待产品确认」 | `src/domain/supply/building.ts` 的 `BUILDING_TYPES` / `BUILDING_TYPE_LABELS` |
| E2 | 后台下拉、楼盘列表标签、前台详情「物业类型」、字典注册表都读同一张标签表 | `Buildings.ts`、`BuildingsListView*.tsx`、`public-catalog/mappers.ts`、`dictionary/enum-registry.ts` |
| E3 | 库里是 PG 枚举 `enum_buildings_building_type`，只有 `buildings.building_type` 一列用它；楼盘未开版本，无版本表 | 本地与生产 `information_schema` 核对 |
| E4 | 供给导入、外部数据同步（汇租选址）、小程序都不读写该字段 | 全仓 `rg` |
| E5 | 写入时 `building-protect` 再校验一次取值 | `src/domain/supply/building-protect.ts` |

存量分布：

| 旧值 | 生产（2026-10-15 只读核查） | 本地 |
|---|---|---|
| 空 | 4434（+1 回收站） | 3（+1 回收站） |
| `office_building` 写字楼 | 8 | 5 |
| `business_park` 商务园区 | 4 | 0 |
| `commercial_complex` 商业综合体 | 0 | 0 |
| `serviced_office` 服务式办公 | 0 | 1 |

## 2. 决策

- **D1 新选项（顺序即下拉顺序）**：传统办公 `traditional_office`、联合办公 `coworking`、整层办公 `full_floor`、独栋办公 `standalone_building`、商务园区 `business_park`。存储值沿用既有的 snake_case 风格。
- **D2 存量映射（用户确认「推荐映射」）**：`office_building → traditional_office`、`serviced_office → coworking`、`business_park` 不变、`commercial_complex → 空`（无对应项，留给运营重选）。生产实际只涉及 8 行（写字楼 → 传统办公），无清空。第一期不改数据（这 8 行在运营编辑保存时、或第二期回填时转换，期间前台与后台列表已按映射显示「传统办公」）。
- **D3 分两期发布（2026-10-15 PR #224 Codex 评审 P1 后修订）**：
  - 原方案（单个迁移：删旧值 + 映射数据）**作废**。原因已核实：Dockerfile CMD 先跑 `migrate-locked.ts` 再起服务；`deploy.yml` 新容器就绪后才切 10% 灰度，冒烟失败只回滚流量、不执行 down。迁移跑完时旧版本仍承接全部流量——旧版后台选「写字楼」保存会被 PG 拒绝，已迁成新值的楼盘在旧版后台也存不了（选项校验），回滚后长期如此。违背 `.agent/migrations.md`「扩展 → 回填 → 双读 → 切换 → 收敛」。
  - **第一期（本 PR，扩展 + 双读）**：迁移 `20261015_115450_opt_115_building_type_options_expand` 由 `migrate:create` **纯生成、未手改**，枚举变为新旧值并集（新 5 + 旧 3），数据不动；旧版本照常读写。新代码的兼容层 `src/domain/supply/building-type-legacy.ts`：读到旧值按映射显示新名称（前台详情、后台列表）；下拉默认只给新值，当前值是旧值时保留并标注「保存后改为……」；`beforeValidate` 钩子在保存时把旧值换成新值。字段 `options` 同时列新旧值，保证配置与库内枚举一致（`migrate:drift` 通过）。
  - **第二期（收敛，另开 PR）**：第一期全量上线、确认不再有旧版本承接流量后，迁移回填剩余旧值（映射同 D2）并重建只含新值的枚举，删除兼容层与旧选项。
- **D4 回滚**：第一期 down 重建只含旧值的枚举，**仅在尚无行被存成新值时可执行**（新代码一旦保存过新值，cast 会失败，需先人工映射回旧值）。发布链路失败只回滚流量、不跑 down，旧版本在并集枚举上照常工作，所以发布本身不依赖 down。
- **D5 不改写历史**：审计日志里旧值的前后快照保持原样。
- **D6 不在范围**：「楼宇等级」里的「创意园区」「服务式办公」与新选项语义有重叠，本项不动，另议。

## 3. 范围

1. `src/domain/supply/building.ts`：新选项与标签（规范值，字典注册表与守卫用它）。
2. `src/domain/supply/building-type-legacy.ts`：第一期兼容层（第二期整份删除）；`Buildings.ts` 字段选项 + `filterOptions` + `beforeValidate`；`public-catalog/mappers.ts`、`BuildingsListView.tsx` 读取侧。
3. 迁移：`src/migrations/20261015_115450_opt_115_building_type_options_expand.{ts,json}`（纯生成）。
4. 测试与夹具里的旧值：单测、`src/test/frontend/payload-documents.ts`、`tests/helpers/opt035-fixtures.ts`、`scripts/seed-test-data.ts`、两个 dev-story 演示页。

## 4. 验证

详见 `artifacts/verification/OPT-115/verification.md`。

第一期（扩展，现行方案）：
- [x] 单测先红后绿：`tests/opt115-building-type-legacy.test.ts`（映射、显示名、字段选项与枚举一致、下拉过滤、保存时转换、前台读旧值）。
- [x] 本地先用旧迁移 down 回到 master 状态，再跑扩展迁移：数据逐行不变，枚举为并集；旧值 / 新值写入都被 PG 接受；`migrate:verify` 0 fail；`migrate:drift` 一致；down / up 往返逐行一致。
- [x] `typecheck` / `lint` / `test`（455 / 6235 全过）；`build` 由 PR CI 覆盖（返工后未在本地干净 worktree 重跑）。
- [x] 浏览器：前台详情旧值显示「传统办公」；后台列表旧值显示映射名；编辑页下拉为新 5 项 + 当前旧值；改其他字段保存后旧值转为新值，再打开下拉只剩新 5 项。

原单期方案的验证（已作废，留作记录）：见验证记录 §1–§5。
