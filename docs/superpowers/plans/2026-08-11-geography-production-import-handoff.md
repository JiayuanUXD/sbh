# 七城地理数据·生产导入交接文档

> **执行者须知**：本文件是可独立执行的操作手册，不需要读实现代码。
> 但**必须从头读完再动手**——第 3 节的护栏和第 7 节的红线决定了出错时能不能救回来。
> 全程只有第 5、6 节的两条 `--apply` 命令会写生产库，其余都是只读。

**目标**：把 `payload-office-platform/seed/geography/*.json` 的七城地理数据（上海、南京、杭州、苏州、无锡、宁波、嘉兴）导入生产库，分两波执行。

**背景方案**：`docs/superpowers/plans/2026-08-10-geography-multi-city-admin.md`（Part A 讲为什么这么设计，本文件只讲怎么做）。

---

## 1. 为什么要分两波

生产库**只有上海**，且已有 19 个行政区、206 个商圈，但**一条地铁数据都没有**。其余六城生产完全没有。

所以数据分成两类：

| | 与生产存量的关系 | 处理 |
|---|---|---|
| 六城全部 + 上海地铁 | 生产完全没有，纯新增 | **第一波**，零冲突，无需判断 |
| 上海的行政区与商圈 | 生产大部分已存在，但用的是旧编码 | **第二波**，靠 `legacyCodes` 别名认领存量 |

上海存量的区域代码有三套命名法并存（`LEGACY_LOC_n`、`SH-XXXQU`、`SH-XXX`）。种子文件里已经为它们写好了 **37 个 `legacyCodes` 别名**，导入器命中别名就**沿用存量节点**（不改名、不改码、不改 slug），只把它当作下级的父级。

**如果不带别名直接导入**，会新建约 500 个垃圾节点：第三个上海城市、挂着 18 / 13 个楼盘的静安与浦东的重复行政区、陆家嘴（7 楼盘）与南京西路（11 楼盘）的重复商圈——**而且全程不报错**。别名就是防这个的。

---

## 2. 前置条件（逐条确认，缺一不可）

- [ ] **PR #37 已合并到 master，且 CloudRun 已部署完成**。导入依赖 `locations.city_id` 列，它由本次部署的迁移创建。
- [ ] 部署后核对回填结果（下面第 4 节第 1 条），**结果必须是 0**。
- [ ] 已对生产库做**备份 / 快照**。
- [ ] 代码在最新 master 上：`git fetch && git switch master && git pull`。
- [ ] `cd payload-office-platform && pnpm install --frozen-lockfile`。

### 2.1 生产库连接（先解决这个，否则后面都跑不了）

导入脚本走 Payload Local API（必须过写侧 hook），因此**执行机器要能直连生产 PostgreSQL**。

- 生产库信息：CloudBase env `sbh-d9gnr8h5ef7e22e30`，库名 **`postgres`**。
- 连接串从 CloudBase 控制台 / 运维处获取，**不要写进仓库、不要贴进聊天记录、不要提交**。
- 用环境变量传入，例如 `DATABASE_URL='postgres://...' node ...`。

> ⚠️ **如果本机连不上生产库（TencentDB 常有网络白名单限制），不要绕道**：
> 正确做法是临时开白名单，或在同 VPC 的机器上执行。
> **绝对不要**改用 SQL 直连写库或 CloudBase 的 `managePgDatabase execute` 批量插入——
> 那会绕过 `protectLocation` 写侧校验，层级、启停联动、`city` 字段维护、版本号全部失效，
> 正是本次重构要杜绝的事。宁可等网络，也不要绕过 hook。

---

## 3. 脚本护栏（了解它们，才知道什么时候该停）

| 护栏 | 行为 |
|---|---|
| **dry-run 是默认** | 不加 `--apply` 一律只读，可放心反复跑 |
| **非本地库防护** | `--apply` 对非 localhost 库会拒绝，必须显式加 `--confirm-db postgres` |
| **先校验后写** | 任一校验失败**整文件拒绝**，不做部分导入 |
| **幂等** | 按 `immutableCode` 匹配，已存在且一致 → 跳过；不一致 → 列差异并**默认跳过**，不覆盖 |
| **存量为准** | 命中 `legacyCodes` → 沿用存量节点，不改其名 / 码 / slug |
| **多命中报警** | 一个节点的别名同时命中多条存量记录时显式告警（按声明顺序取首个） |
| **未认领报告** | 每城结束列出「种子没认领的存量节点」，并给同名疑似对应提示 |
| **默认不可见** | 所有导入节点 `frontendVisible = false`，C 端零变化 |

**判读原则：任何一行出现 `✗`、`冲突`、`失败` 或「命中多条」，先停下，不要继续加 `--apply`。**

---

## 4. 第 0 步：部署后体检（只读）

```sql
-- 1. 回填是否完整（必须为 0；非 0 说明有 parent 断链的脏数据，先停下反馈）
SELECT count(*) FROM locations WHERE type <> 'city' AND city_id IS NULL;

-- 2. 记录导入前基线，供事后比对
SELECT type, count(*) FROM locations GROUP BY type ORDER BY type;
-- 导入前预期：city 2 / district 19 / business_area 206（合计 227）
```

第 1 条不为 0 就**停止导入**，把结果反馈回来。

---

## 5. 第一波：六城 + 上海地铁（零冲突）

预计新增约 **1448** 个节点。

### 5.1 dry-run（只读，先全部跑一遍看输出）

```bash
cd payload-office-platform

for c in hangzhou suzhou nanjing ningbo wuxi jiaxing; do
  DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
    --file "seed/geography/$c.json"
done

DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
  --file seed/geography/shanghai.json --only metro
```

**预期输出**

| 城市 | 新建 | 沿用存量 | 冲突 | 失败 | 新建的构成 |
|---|---|---|---|---|---|
| 杭州 | 299 | 0 | 0 | 0 | 1 城 + 13 区 + 15 商圈 + 12 线 + 258 站 |
| 苏州 | 171 | 0 | 0 | 0 | 1 + 10 + 14 + 9 + 137 |
| 南京 | 249 | 0 | 0 | 0 | 1 + 11 + 19 + 12 + 206 |
| 宁波 | 201 | 0 | 0 | 0 | 1 + 10 + 12 + 8 + 170 |
| 无锡 | 95 | 0 | 0 | 0 | 1 + 7 + 12 + 4 + 71 |
| 嘉兴 | 18 | 0 | 0 | 0 | 1 + 7 + 10 + 0 + 0（该市无地铁） |
| 上海（`--only metro`） | 415 | **1** | 0 | 0 | 21 线 + 394 站；沿用的 1 是城市节点 |
| **合计新建** | **1448** | | | | |

- 六城的「沿用存量」应为 **0**（生产没有这些城市）。若不为 0，说明生产已经有同码节点——**停下反馈**。
- 上海那条的「沿用存量 1」是城市节点本身，日志应出现：
  `≡ 沿用存量 city「上海」(存量码 LEGACY_LOC_1 ← 种子码 CITY-SH, id=1)`
  **存量码必须是 `LEGACY_LOC_1`**。如果显示 `SH`，说明挂到了那条停用的空上海记录上——**立即停止**，反馈。
- 嘉兴 0 线路 0 站点是正确的（该市无地铁）。

### 5.2 apply（写库）

dry-run 输出与上表一致后再执行：

```bash
for c in hangzhou suzhou nanjing ningbo wuxi jiaxing; do
  DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
    --file "seed/geography/$c.json" --apply --confirm-db postgres
done

DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
  --file seed/geography/shanghai.json --only metro --apply --confirm-db postgres
```

### 5.3 第一波验收（只读）

```sql
-- 城市应为 8（原 2 条上海 + 新增 6 城），且不能出现第三条上海
SELECT id, name, immutable_code, slug, status FROM locations WHERE type='city' ORDER BY id;

-- 无孤儿
SELECT count(*) FROM locations WHERE type <> 'city' AND city_id IS NULL;   -- 预期 0

-- 上海地铁挂在存量上海（LEGACY_LOC_1）下
SELECT count(*) FILTER (WHERE type='metro_line')    AS 线路,
       count(*) FILTER (WHERE type='metro_station') AS 站点
FROM locations WHERE city_id = (SELECT id FROM locations WHERE immutable_code='LEGACY_LOC_1');
-- 预期 21 / 394

-- 全部新导入节点不可见
SELECT count(*) FROM locations WHERE frontend_visible = true;
-- 预期仍是导入前的数量（26：1 城 + 9 区 + 16 商圈），不应增加
```

**幂等复跑**：把 5.1 的 dry-run 再跑一遍，所有城市应为「新建 0」。不为 0 说明上一步没写全。

---

## 6. 第二波：上海行政区与商圈

**实际只新建 6 个商圈**（虹桥商务区、漕河泾开发区、临港、长风商务区、大虹桥、松江新城），其余 34 个节点全部沿用存量。别名的价值不在新增，在于挡掉 34 个重复。

### 6.1 dry-run

```bash
DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
  --file seed/geography/shanghai.json
```

**预期**：`新建 6 ｜ 沿用存量 37 ｜ 跳过 415 ｜ 冲突 0 ｜ 失败 0`
（沿用 37 = 1 城 + 16 区 + 20 商圈；跳过 415 = 第一波已导入的地铁）

**必须逐行核对这几条「沿用存量」，认错了就是把真实房源挂到错节点上：**

| 种子码 | 应命中的存量码 | 该存量节点挂着 |
|---|---|---|
| `CITY-SH` | `LEGACY_LOC_1` | 71 楼盘 |
| `SH-D-310106`（静安区） | `LEGACY_LOC_2` | 18 楼盘 |
| `SH-D-310115`（浦东新区） | `LEGACY_LOC_3` | 13 楼盘 |
| `SH-BA-NANJINGXILU` | `LEGACY_LOC_4` | 11 楼盘 |
| `SH-BA-LUJIAZUI` | `LEGACY_LOC_5` | 7 楼盘 |

日志末尾会有「未被种子认领的存量节点」清单，**预期约 180 条**（生产自有、种子没覆盖的商圈）。它们保持不动是正确的，不要去处理。但如果清单里出现**本该被认领的节点**（比如某个区或上表中的商圈），说明别名漏了——**停下反馈，不要 `--apply`**。

### 6.2 apply

```bash
DATABASE_URL="$PROD_DB_URL" node --import tsx scripts/import-geography.ts \
  --file seed/geography/shanghai.json --apply --confirm-db postgres
```

### 6.3 第二波验收（只读）

```sql
-- 仍然只有 2 条上海（不能变 3 条）
SELECT count(*) FROM locations WHERE type='city' AND name LIKE '上海%';   -- 预期 2

-- 上海行政区数量不应暴涨（原 19，第二波不新建行政区）
SELECT count(*) FROM locations
WHERE type='district' AND city_id = (SELECT id FROM locations WHERE immutable_code='LEGACY_LOC_1');
-- 预期 19

-- 商圈 206 → 212（只新增 6 个）
SELECT count(*) FROM locations
WHERE type='business_area' AND city_id = (SELECT id FROM locations WHERE immutable_code='LEGACY_LOC_1');
-- 预期 212

-- 楼盘关联未被破坏（数量应与导入前一致）
SELECT count(*) FROM buildings WHERE deleted_at IS NULL;   -- 预期 71

-- 没有出现重名重复的行政区（新旧并存）
SELECT name, count(*) FROM locations WHERE type='district' GROUP BY name HAVING count(*) > 1;
-- 预期只剩生产原有的那几条停用空壳（静安区 2 条、浦东新区 2 条），不应新增
```

---

## 7. 红线（违反了很难救）

1. **不要跳过 dry-run 直接 `--apply`。**
2. **不要加 `--update-existing`。** 它会用种子内容覆盖存量节点的名称、状态、坐标。本次导入的策略是「存量为准」，任何情况下都不该用它。
3. **不要用 SQL 直接写库**（含 CloudBase `managePgDatabase execute` 批量插入）。必须走脚本，让 `protectLocation` hook 生效。
4. **不要改种子文件里的 `legacyCodes`** 来"让它跑通"。别名是按生产实际存量逐条核对出来的，改了就是认错节点。发现不对，反馈。
5. **不要批量开 `frontendVisible`。** 导入完成后所有节点都不可见是**正确结果**，由运营按业务节奏逐个开。
6. **不要修生产存量码的拼音错误**（`SH-MINXINGQU` 应为 minhang、`SH-MINHANG-SHENZHUANG` 应为 xinzhuang）。区域代码创建后不可改，且改码会波及全部引用。
7. 任何一步出现 `✗` / `冲突` / `失败` / 「命中多条」，**停下反馈**，不要试图绕过。

---

## 8. 出错怎么办

- **脚本中途失败**：它是幂等的，修掉原因后重跑同一条命令即可，已成功的会自动跳过。
- **导入了不该导的节点**：不要用 SQL 删。先反馈，节点可能已被业务引用（`protectLocationDelete` 会拦），需要评估是删除还是停用。
- **发现挂错父级**（例如上海地铁挂到了停用的 `SH` 上）：**立即停止后续操作并反馈**。这类问题越往后做越难拆。
- **需要整体回退**：用第 2 节的备份恢复。本次导入没有"一键回滚"，这也是要求先备份的原因。

---

## 9. 完成后请回填

在 `docs/superpowers/plans/2026-08-10-geography-multi-city-admin.md` 的「七城导入登记」表里，把「生产执行」列从 ❌ 改成实际执行日期，并附上：

- 每波的 `新建 / 沿用存量 / 跳过 / 冲突 / 失败` 数字
- 第 5.3 与 6.3 全部验收 SQL 的实际返回值
- 日志文件位置（脚本会写到 `.tmp/geography-import-*.log`）
- 未认领存量节点清单的条数

如果任何数字与本文档的预期不符，**如实写下来并说明**，不要只写"完成"。下游会基于这些数字判断数据可不可信。
