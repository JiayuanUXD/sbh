# Task Packet：OPT-048 迁移快照链回退，`migrate:create` 凭空生成重复迁移

> 状态：**已修**（2026-08-24：修复迁移 + CI 漂移守卫）
> 创建日期：2026-08-24
> 来源：OPT-046 §7.5「顺带发现」，当时标注「需单独排期」
> 编号说明：OPT-047 是房源列表页缓存超 2MB，故取 048

---

## 1. 一句话

`payload migrate:create` 比对的是「当前 config」与「**最后一份 `.json` 快照**」，
**从不看真实数据库**。有人在旧基线上生成过迁移，新快照丢掉了旧快照已有的列，
于是此后任何人跑 `migrate:create` 都会凭空得到一条**重复的、且不带 `IF NOT EXISTS` 的**
`ADD COLUMN`——误提交并部署就会在生产库上直接失败，服务起不来。

## 2. 实测确认（2026-08-24）

在干净工作树上跑 `payload migrate:create`，生成：

```ts
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" ADD COLUMN "avg_response_hours" numeric;`)
}
```

**这一列生产早就有了**（`20260820_110024` 加的，已验证生产存在）。容器 CMD 是
`migrate-locked.ts && pnpm start`，迁移失败即短路，`pnpm start` 根本不执行。
这与 2026-08-23 那次部署失败（裸 `CREATE TYPE` 撞上已存在的类型）**是同一种死法**。

## 3. 快照链体检

逐对比较相邻快照（`tables` / `columns` 集合差集）：

| 快照 | 变化 | 判定 |
|---|---|---|
| `20260813_060037` → `20260817_172754` | 102 → 83 表，丢 19 张 `*_rels` | 见 §5 |
| `20260820_055534_drop_listing_merchant_relations` | −1 表 | ✅ 正常，它就是干这个的 |
| `20260820_110024`（只加一列） | **+1 表 +11 列** | ❌ 把已删的 `listing_merchant_relations` 加回来了 |
| `20260821_161534`（OPT-041） | 再删一次该表、**丢掉 `avg_response_hours`** | ❌ 基线早于 `20260820_110024` |
| `20260822_010308` | 无变化 | — |

**两次独立的旧基线事故**：OPT-035 那条基于早于 `20260820_055534` 的基线，
OPT-041 那条基于早于 `20260820_110024` 的基线。正是 CLAUDE.md
「永远从最新 master 开分支」那条规则要防的事。

另有 4 条迁移没有配套 `.json`：`20260815_140000`、`20260817_180000`、
`20260822_001600`、`20260822_001700`。这是**正常的**——手写的数据/索引迁移不经
`migrate:create`，Payload 不会为它们生成快照。§7.5 当时把这条也算作问题，是误判。

## 4. 与生产真实 schema 的差距

用只读连接比对（生产 106 张表 vs 最新快照 84 张）：

- **反向差集为 0** —— 快照里没有生产不存在的表，不存在「幻影表」；
- 生产有、快照没有的 22 张：19 张 `*_rels` + `inquiry_rate_limit` + 2 张
  `tencentdb_tbl_dial_test_*`。

逐条判定：

| 类别 | 判定 |
|---|---|
| 2 张 `tencentdb_tbl_dial_test_*` | 腾讯云自己的拨测表，**本就不该进快照**，忽略 |
| `inquiry_rate_limit`（1 行，限流器在用） | 裸 SQL 迁移建的，**本就不进 Payload 快照**，正常 |
| 19 张 `*_rels`（行数 0–14，基本空） | 历史残留，见 §5 |

**关键结论：这 22 张都不影响 `migrate:create`**——它们不在 config 里，不会被生成。
真正会造成伤害的只有 `avg_response_hours` 这一处 config↔快照分叉。

## 5. 已修

### 5.1 `20260824_101016_opt048_snapshot_chain_repair`

语义上**什么都不做**的迁移：

```sql
ALTER TABLE "city_site_profiles" ADD COLUMN IF NOT EXISTS "avg_response_hours" numeric;
```

- 生产库、以及任何跑过 `20260820_110024` 的库：列已存在 → 跳过；
- 全新库：跑到这里时 `20260820_110024` 已建过该列 → 同样跳过。

真正的产出是它**配套的新快照**——含 `avg_response_hours`，于是链重新对齐。
`down()` 故意留空：该列归 `20260820_110024` 所有，回滚它不是这条的职责。

实测新快照相对上一份 **只多这一列**（表数 84→84，列数 979→980，无删除），
没有任何附带改动。修复后 `migrate:create` 报 **`No schema changes detected`**。

### 5.2 CI 漂移守卫 `pnpm migrate:drift`

`scripts/migrate-drift-check.ts`，接在 `quality.yml` 的 `postgres-migrations` job 里
（`migrate:dry-run` 之后、`payload migrate` 之前）。

跑真命令、断言真输出（`No schema changes detected`），不碰 drizzle 未导出的内部 API——
那些是实现细节，版本间会变。守卫自己会备份 `index.ts`、记录目录快照，
跑完无论成败都还原，不污染工作树（已实测：探针文件被清理、`index.ts` 被还原）。

**双向验证过**：干净状态退出 0；人为从快照里删掉那一列后退出 1，
并打印指向修法的提示。

### 5.3 未处理：19 张残留 `*_rels`

不影响 `migrate:create`，行数 0–14，属历史残留。清理它们是**破坏性操作**、
且需先确认没有任何代码路径还在读（`media_rels` 有 14 行、`listings_rels` / `leads_rels`
各 1 行，不能想当然当空表删）。**本工作项不动**，需要时单独立项评估。

## 6. 验收

- `pnpm migrate:drift` 在干净树上退出 0；人为制造漂移后退出 1 —— ✅ 已双向验证；
- `payload migrate:create` 报 `No schema changes detected` —— ✅；
- CI `postgres-migrations` job 全绿（含全新库跑全量迁移 + 填充数据后重跑）；
- 生产部署后 `city_site_profiles.avg_response_hours` 仍在、无数据变化。

## 7. 坑

- **`migrate:create` 不看数据库。** 它只比 config 和最后一份快照。所以
  「本地跑通了」「生产有这列」都不能说明快照是对的——必须直接比对快照本身。
- **重复迁移的危害不在于重复，在于不幂等。** Payload 生成的 `ADD COLUMN` /
  `CREATE TYPE` 都是裸语句，撞上已存在的对象直接报错。而容器用 `&&` 串联迁移与启动，
  迁移失败 = 服务不启动。
- **别用「CI 绿了」判断快照健康。** 在本守卫加入之前，CI 跑的是「全新库能不能
  从零跑完全部迁移」——快照回退完全不影响这件事，所以两次事故都一路绿灯合进了 master。

## 8. 相关

- OPT-046 §7.5 —— 本工作项的来源（那份记录把「4 条迁移无快照」误判为问题，见 §3）
- `scripts/migrate-drift-check.ts` —— 守卫实现
- `src/migrations/20260824_101016_opt048_snapshot_chain_repair.ts` —— 修复迁移
- CLAUDE.md「永远从最新 master 开分支」—— 两次事故的共同成因
