# OPT-014 迁移清单与预检可信度 · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md` P0 第一项
> 完成标准：迁移目录与索引集合一致；漏项、危险项和不可回滚项能确定性阻断

## 审查发现

1. `src/migrations` 有 18 份迁移文件，`index.ts` 仅注册 16 份，遗漏：
   - `20260726_103800_m6_7_notifications`
   - `20260726_140000_m5_2_leads_inquiry_context`
2. 容器启动 `pnpm exec payload migrate` 只跑索引注册项 → 通知表、询盘上下文字段在生产缺失。
3. `scripts/preflight.ts` 用 `import\s+(\w+)\s+from` 匹配 `import * as name from`，匹配不到，
   且取的是 import 别名而非数组 `name:` 字段，输出“发现 0 个迁移”后仍判通过（假通过）。
4. 无目录/索引集合相等校验；缺 `down()` 仅 warn 不阻断。

## 修复内容

### 1. 补注册漏项（`src/migrations/index.ts`）

按时间戳顺序插入两份迁移到数组与 import 段：

- `20260726_103800_m6_7_notifications` 插在 `m6_4_tasks`（103700）之后、`m5_1_crm_collections`（110000）之前；
- `20260726_140000_m5_2_leads_inquiry_context` 插在 `m5_1_crm_collections`（110000）之后（数组末尾）。

依赖核对：`m6_7_notifications` 仅扩展 `domain_events` 枚举（依赖 103600 已建表）+ 建 `notifications` 表，不依赖 `m5_1`；`m5_2` 给 `leads` 加列（`leads` 在 `init` 已建），不依赖 `m5_1`。位置符合时间戳与依赖。

> 注：迁移文件正文未手改（遵守 CLAUDE.md「迁移文件正文绝不可手改」），只改 `index.ts` 注册。

### 2. 重构预检为纯函数 + 集合相等校验（`scripts/preflight.ts`）

导出可测纯函数：

| 函数 | 作用 |
| --- | --- |
| `listMigrationFiles(dir)` | 扫描目录 `*.ts`（排除 `index.ts`、`.d.ts`），返回排序后的迁移名 |
| `parseRegisteredMigrationNames(indexContent)` | 解析数组 `name: '...'` 字段（Payload migrate 实际执行名），**不再**解析 import 别名 |
| `diffMigrationSets(dir, reg)` | 双向差异：`missingFromIndex`（漏注册）+ `missingFromDirectory`（悬空引用） |
| `checkMigrationShape(content)` | 校验 `export async function up/down` 存在 |
| `extractMigrationUpBody(content)` | 提取 up 函数体（到 down 之前），风险扫描只扫 up |
| `scanMigrationRisks(content)` | DROP TABLE/COLUMN → fail；ADD COLUMN NOT NULL 无 DEFAULT / ALTER COLUMN SET DATA TYPE → warn |

阻断规则：

- 漏注册（目录有、索引无）→ **fail**：容器不会执行该迁移
- 悬空引用（索引有、目录无）→ **fail**
- 缺 `up` → **fail**
- 缺 `down` → **fail**（升级自 warn：不可回滚项确定性阻断）
- up() 含 DROP TABLE/COLUMN → **fail**
- down() 的 DROP 不再误判（只扫 up body，修复 init down 的 DROP TABLE 误报）

模块顶层无副作用，`main()` 仅在直接运行时执行（`process.argv[1]` 守卫），单元测试可安全导入纯函数。

## 验证

### 单元测试

```
pnpm exec vitest run tests/preflight-migrations.test.ts
```

9 项通过，覆盖：
- `listMigrationFiles` 扫描真实目录返回 18 项、排除 index.ts
- `parseRegisteredMigrationNames` 解析 18 个 name 字段、不含 import 别名
- `diffMigrationSets` 漏注册 / 悬空引用 / 一致 三场景
- `checkMigrationShape` up/down 识别
- `extractMigrationUpBody` 只返回 up body、排除 down 的 DROP
- `scanMigrationRisks` DROP TABLE/COLUMN fail、NOT NULL warn、安全内容无风险
- 真实目录与 index.ts 集合完全一致（双向空）
- 每份迁移都有 up 与 down
- 无迁移 up() 含 DROP TABLE/COLUMN

### 真实预检

```
node --import tsx scripts/preflight.ts migrations
```

输出（关键）：

```
通过: 3
警告: 1
失败: 0
  ⚠️  migrations.20260725_130727_m2_1_locations_geo_node.risk: WARN: 修改字段类型
       ↳ ALTER COLUMN "type" SET DATA TYPE
── 结果: 有警告 ──
exit 0
```

- 发现 18 个目录文件 + 18 个索引注册（“发现 0 个迁移”假通过已消除）
- 集合一致校验通过
- 唯一 warn 是 `m2_1_locations_geo_node` up() 真实的 `ALTER COLUMN SET DATA TYPE`，warn 不阻断（属预期提示，非新引入）

### 类型检查

```
pnpm typecheck  # exit 0
```

## 完成标准对照

| 标准 | 证据 |
| --- | --- |
| 迁移目录与索引集合一致 | 补注册 2 项；`diffMigrationSets` 真实双向空；9 项测试 |
| 漏项能确定性阻断 | `missingFromIndex` → fail；`diffMigrationSets` 漏注册场景测试 |
| 危险项能确定性阻断 | up() DROP TABLE/COLUMN → fail；`scanMigrationRisks` 测试 |
| 不可回滚项能确定性阻断 | 缺 `down` → fail（升级自 warn）；`checkMigrationShape` + 真实 18 份都有 down |
