# Task Packet：OPT-115 楼盘物业类型选项改为五类办公业态

> 状态：**实施中**
> 创建日期：2026-10-15
> 分支：`feat/opt-115-building-type-options-62dd`
> 来源：用户需求「把物业类型的选项值改为：传统办公、联合办公、整层办公、独栋办公、商务园区」

**目标：** 楼盘「物业类型」（`buildings.buildingType`）的选项换成五类，存量数据按确认的映射迁过去。

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
- **D2 存量映射（用户确认「推荐映射」）**：`office_building → traditional_office`、`serviced_office → coworking`、`business_park` 不变、`commercial_complex → 空`（无对应项，留给运营重选）。生产实际只影响 8 行（写字楼 → 传统办公），无清空。
- **D3 迁移写法**：`migrate:create` 生成，在「列转 text」与「转新枚举」之间插入值映射 `UPDATE`（up / down 两向），生成的 DDL 不改。照 `20260725_130727_m2_1_locations_geo_node` 先例；与宪章「迁移正文不可手改」的张力已向用户说明并获同意。
- **D4 回滚**：反向映射 `traditional_office → office_building`、`coworking → serviced_office`；`full_floor` / `standalone_building` 无旧对应，回滚置空；`commercial_complex` 在 up 时已清空，回滚不恢复（生产为 0 行，无实际损失）。
- **D5 不改写历史**：审计日志里旧值的前后快照保持原样。
- **D6 不在范围**：「楼宇等级」里的「创意园区」「服务式办公」与新选项语义有重叠，本项不动，另议。

## 3. 范围

1. `src/domain/supply/building.ts`：选项与标签。
2. 迁移：`src/migrations/<时间戳>_opt_115_building_type_options.{ts,json}`。
3. 测试与夹具里的旧值：单测、`src/test/frontend/payload-documents.ts`、`tests/helpers/opt035-fixtures.ts`、`scripts/seed-test-data.ts`、两个 dev-story 演示页。

## 4. 验证

- [ ] 单测先红后绿（选项、标签、守卫拒收旧值、字典注册表、前台映射）。
- [ ] 本地 `migrate:dry-run` → `migrate` → `migrate:verify`；核对本地 5 行 → 传统办公、1 行 → 联合办公。
- [ ] 回滚往返：`migrate:down` 后值回到旧值，再 `migrate` 回到新值。
- [ ] `typecheck` / `lint` / `test` / `build`。
- [ ] 浏览器：楼盘编辑页下拉 5 项、楼盘列表标签、前台楼盘详情「物业类型」。
