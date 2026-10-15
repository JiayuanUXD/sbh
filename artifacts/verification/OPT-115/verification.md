# OPT-115 验证记录

> **2026-10-15 修订**：PR #224 Codex 评审 P1 指出单期迁移在灰度窗口内与旧版本不兼容，方案改为两期。
> 现行方案（第一期：扩展 + 双读）的证据见文末 §7；§1–§5 是原单期方案的记录，**已作废**，保留作对照。

> 工作项：`specs/work-items/OPT-115-building-type-options.md`
> 分支：`feat/opt-115-building-type-options-62dd`（实现提交 `81954960`）
> 日期：2026-10-15，本机 macOS，Node v24.14.0（项目要求 22.x，只报 engine 警告）

## 1. 生产存量（只读核查，用户授权）

只读连接（`default_transaction_read_only=on`，10 s 语句超时，连接串不落输出）：

| 旧值 | 未删除 | 回收站 |
|---|---|---|
| 空 | 4434 | 1 |
| `office_building` | 8 | 0 |
| `business_park` | 4 | 0 |
| `commercial_complex` / `serviced_office` | 0 | 0 |

枚举 `enum_buildings_building_type` 在生产只被 `buildings.building_type` 一列使用。
→ 迁移在生产的实际影响：**8 行写字楼 → 传统办公；商务园区 4 行存储值不变；无数据被清空。**

## 2. 单测（TDD）

- 先改测试：`tests/building.test.ts` 加「选项与顺序」「旧值不再合法」；`tests/building-protect.test.ts` 合法组合改新值、加「旧值写入被拒（INVALID_BUILDING_TYPE）」→ 7 条红（枚举未改）。
- 改 `src/domain/supply/building.ts` → 相关 3 个文件 51 条全绿。
- 夹具与断言里的旧值同步：`frontend-mappers.test.ts` 的「物业类型」期望值 写字楼 → 传统办公（楼盘简介里的「写字楼」文字不动）。

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 error，35 warning（全部既有） |
| `pnpm test` | 454 个文件 / 6213 条全过 |
| `pnpm migrate:drift` | OK —— config 与最新快照一致 |
| `pnpm generate:types` | `buildingType` 为新的 5 值联合；`grep -c prefix` = 2 |
| 生产构建（干净 worktree，见 §5） | 通过 |
| E2E | 未跑：`tests/e2e` 无任何物业类型的值或中文名引用，本项未改页面结构 |

## 3. 迁移（本地库 `sbh_dev_geo`）

所有 payload 命令显式 `NODE_ENV=development DATABASE_URL=<.env.local 的本地库>`（payload CLI 在 `NODE_ENV=production` 时会读 `.env.production.local`，见 OPT-114 §7）。

1. `migrate:dry-run`：新迁移 `up/down/json` 齐全，1 条 WARN「ALTER COLUMN SET DATA TYPE」（`migrate-dry-run-opt115.txt`），与先例 `m2_1_locations_geo_node` 同类；无禁止项、不触发破坏性批准清单。
2. `payload migrate` → `local-02-after-up.txt`：#7 `serviced_office → coworking`，#8–#12 `office_building → traditional_office`，空值不动；枚举取值为新的 5 个。
3. `payload migrate:down` → `local-03-after-down.txt`：与迁移前快照 `local-01-before.txt` **逐行 diff 一致**，枚举回到旧的 4 个。
   - 注：Payload 日志写「Rolling back batch 9 consisting of 96 migration(s)」，实测只回滚了本迁移（`payload_migrations` 批次 1–8 共 95 行仍在、`migrate:status` 只剩本迁移待执行）。
4. 再 `payload migrate`：结果与第 2 步逐行一致；`migrate:verify` 336 项 0 fail（26 warn 均为既有「手写迁移缺 .json」）；`migrate:status` 0 待执行。

## 4. 浏览器验收（dev server 冷重启后）

登录 `e2e-adm@example.com`（`scripts/seed.ts` 公开夹具）。

- **编辑页**（楼盘 #9 陆家嘴，原写字楼）：物业类型显示「传统办公」；展开下拉恰为「传统办公 / 联合办公 / 整层办公 / 独栋办公 / 商务园区」五项、顺序一致（`light-01-edit-dropdown.jpg`）。
- **保存三步**：选「独栋办公」→ 保存 → `PATCH /api/buildings/9` 200，响应 `doc.buildingType = "standalone_building"`，库内同值；整页刷新后下拉回显「独栋办公」。
- **前台详情** `/shanghai/buildings/lujiazui-grade-a-river-view`「楼盘参数」：物业类型 = 独栋办公（`light-03-public-detail-standalone.jpg`）——保存后公开缓存正确失效。
- **楼盘库列表**「等级 / 类型」列：独栋办公 ×1、传统办公 ×4、联合办公 ×1（`light-02-buildings-list.jpg`）。
- 还原：#9 改回「传统办公」并保存，库内状态与迁移后逐行一致（`local-04-after-browser.txt`）。

观察（不在本项范围，见工作项 D6）：南京西路高端商务中心在列表里并排显示「服务式办公」（楼宇等级）与「联合办公」（物业类型），两个字段语义重叠。

## 5. 生产构建（干净 worktree）

在 detached worktree `~/wt-opt115`（提交 `81954960`，不含 `.env.production*`，只复制 `.env.local`）里
`pnpm install --frozen-lockfile` → `generate:types` → `CI=1 pnpm build`。

结果：worktree 内 env 文件只有 `.env.example` / `.env.local`；`✓ Compiled successfully`、静态页 27/27 生成，exit 0。量完已删除该 worktree。

## 6. 文件

| 文件 | 内容 |
|---|---|
| `local-01-before.txt` / `local-02-after-up.txt` / `local-03-after-down.txt` / `local-04-after-browser.txt` | 本地 `buildings` 各阶段的 id / building_type / 是否回收站 |
| `migrate-dry-run-opt115.txt` | dry-run 中本迁移的检查输出 |
| `light-0*.jpg` | 编辑页下拉、楼盘库列表、前台详情截图 |


## 7. 第一期（扩展 + 双读）返工验证

### 7.1 评审前提核实

- `payload-office-platform/Dockerfile` CMD：`pnpm exec tsx scripts/migrate-locked.ts && exec env ... pnpm start`——新容器先跑迁移再起服务。
- `.github/workflows/deploy.yml`：新版本就绪后才切 10% 灰度 → 冒烟 → 全量；失败 `traffic rollback`，不执行迁移 down。
- 结论：迁移执行时旧版本仍承接全部流量，原单期迁移（删旧值）会让旧版写旧值被 PG 拒绝、已迁新值的楼盘在旧版存不了，回滚后持续。评审成立。

### 7.2 迁移（本地）

1. 先用**旧**迁移文件 `migrate:down`，本地回到 master 状态（4 个旧枚举值，#7 `serviced_office`、#8–#12 `office_building`）。
2. 删旧迁移文件、`index.ts` 还原为 master；字段改为新旧值并集后 `migrate:create opt_115_building_type_options_expand`——生成结果为「转 text → 删类型 → 建并集类型（新 5 + 旧 3）→ cast 回枚举」，**未手改**。
3. `migrate:dry-run`：1 条 WARN（ALTER COLUMN SET DATA TYPE，同类先例），无禁止项。
4. `payload migrate` → `expand/local-02-after-up.txt`：数据与 `expand/local-01-before.txt` **逐行一致**，枚举为 8 值并集。
5. 兼容写入（事务内执行后 ROLLBACK）→ `expand/local-03-old-and-new-writes.txt`：旧值 `serviced_office`、`commercial_complex` 与新值 `standalone_building` 均写入成功——旧版本在新结构上照常可写。
6. `migrate:verify` 336 项 0 fail；`migrate:drift` OK；down → up 往返后数据逐行一致；`migrate:status` 0 待执行。

### 7.3 自动化

- 新增 `tests/opt115-building-type-legacy.test.ts`（22 条）：先红（模块不存在 / 列表显示表缺失）后绿。覆盖映射、显示名、字段选项 = 新 + 旧（与库枚举一致）、`filterOptions`（默认只新值，当前旧值保留）、`beforeValidate` 转换（不凭空写入）、前台读旧值显示新名称、列表显示表。
- `typecheck` 通过；`lint` 0 error（35 warning 既有）；`pnpm test` **455 文件 / 6235 条全过**。
- `build` 未在本地重跑（返工改的是配置与 TS，typecheck 覆盖类型；PR CI `quality.yml` 会跑 build）。

### 7.4 浏览器（dev server 冷重启；先清 `.next/dev/cache/fetch-cache` 与 `.next/cache/fetch-cache`）

清缓存的原因：前面多次直接改库（迁移往返）不经 Payload，公开缓存未失效，首次打开详情仍显示旧测试值「独栋办公」；库内实为 `office_building`。清缓存重启后：

| 检查 | 结果 | 证据 |
|---|---|---|
| 前台 `/shanghai/buildings/lujiazui-grade-a-river-view`（库内 `office_building`） | 物业类型 = 传统办公 | `expand/01-public-detail-legacy-shows-new-label.jpg` |
| 后台楼盘库列表 | 旧值行显示「传统办公」「联合办公」，无英文值 | — |
| 编辑页 #9（旧值） | 当前显示「写字楼（旧选项，保存后改为传统办公）」；下拉 = 新 5 项 + 该旧选项，另两个旧选项隐藏 | `expand/02-admin-dropdown-legacy-current.jpg` |
| 未改动时「保存」 | 按钮禁用（Payload 未修改不可存）——转换发生在运营改任一字段保存时 | — |
| 改「推荐排序」0 → 1 保存 | `PATCH /api/buildings/9` 200，响应 `buildingType = traditional_office`，库内同值 | `expand/local-04-after-browser-save.txt` |
| 再打开 | 显示「传统办公」，下拉只剩新 5 项 | — |
| 还原 | 推荐排序改回 0；物业类型保持转换后的 `traditional_office`（预期行为） | — |

### 7.5 已知限制

- 灰度期间新版本（10%）若把某楼盘存成新值，旧版本（90%）再保存**该楼盘**会被旧选项校验拦下，直到全量切换。影响面：灰度那几分钟内两版本交替编辑同一楼盘的物业类型，实际概率很低。
- 第二期之前，生产 8 行仍存 `office_building`（显示已是「传统办公」）。
