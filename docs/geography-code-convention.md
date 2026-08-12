# 地理数据 immutableCode 命名规范

本文档是七城地理数据（城市 / 行政区 / 商圈 / 地铁线路 / 地铁站）`immutableCode` 与 `slug` 的**唯一权威命名规范**。导入脚本（`scripts/import-geography.ts`）与种子数据必须遵守。

## 约束（来自代码）

所有 `immutableCode` 必须匹配 `location-hierarchy.ts:102` 的既有正则：

```
^[A-Z0-9][A-Z0-9_-]{1,63}$
```

即：以大写字母或数字开头，后续允许大写字母 / 数字 / 连字符 `-` / 下划线 `_`，总长 2–64。**不允许小写、不允许点 `.`、不允许除 `-`/`_` 外的符号。**

`immutableCode` 由 `protectLocation` hook 保证不可变，是跨环境（本地 / CI / 生产）的**稳定主键**。`slug` 有 DB unique 约束，全局唯一，是 C 端 URL 的一部分。

## 命名规范

| 类型 | `immutableCode` 格式 | 示例 |
|---|---|---|
| 城市 | `CITY-<城市拼音缩写>` | `CITY-SH`、`CITY-HZ`、`CITY-JX` |
| 行政区 | `<城市>-D-<统计局行政区划代码后6位>` | `SH-D-310106`、`HZ-D-330102` |
| 商圈 | `<城市>-BA-<商圈拼音>` | `SH-BA-NANJINGXILU`、`HZ-BA-WULINGUANGCHANG` |
| 地铁线路 | `<城市>-ML-<线路号>` | `HZ-ML-2`、`SH-ML-16` |
| 地铁站 | `<城市>-MS-<站点拼音>` | `HZ-MS-FENGQICHENGZHAN` |

### 城市缩写

1. 上海 `SH`、南京 `NJ`、杭州 `HZ`、苏州 `SZ`、无锡 `WX`、宁波 `NB`、嘉兴 `JX`（拼音首字母，遇 `S/SH/SZ` 等二义用常见惯例，全表见 `seed/geography/*.json` 文件头）。
2. 城市 `immutableCode` 恒为 `CITY-<缩写>`，**不含 `-D` 等后缀**。

### 行政区码

1. 行政区 `immutableCode` 的 6 位码 = 国家统计局行政区划代码的**后 6 位**（去掉省级前 2 位）。这是**唯一权威主键**。
2. 行政区划代码会随撤县设区 / 更名调整，**改名不影响主键**（6 位码不变则 code 不变）。核对截止日期记在 `seed/geography/*.json` 文件头。
3. 含区、县级市、县。去掉 `市辖区` / `省直辖县级行政区划` 等非实体汇总之类不做节点。

### 商圈 / 地铁站拼音

1. 一律用**全拼音大写、无分隔符**（如 `NANJINGXILU`、`WULINGUANGCHANG`）。
2. 「路」「街」「广」等直接连写，不写 `LU`/`JIE` 前缀或后缀标记。
3. 同名商圈 / 站点的消歧见下「冲突处理」。

### 地铁线路码

1. 线路号用阿拉伯数字，无 `号线` 字样：`HZ-ML-1`（1 号线）、`SH-ML-16`（16 号线）。
2. 有字母后缀的线路（如广州 APM）按既有事实编号，本七城暂不涉及。
3. 换乘站入库规则见 `docs/superpowers/plans/2026-08-10-geography-multi-city-admin.md` B1.5：**同名换乘站只存一条，`parent` 为首开线路；同期开通按线路号小的归属。** 在建 / 未开通线路与站点一律不导入。

## slug 命名规范

`slug` 全局唯一，C 端 URL 依赖。命名沿用 `immutableCode` 的小写、`-` 分隔形式：

| 类型 | 示例 |
|---|---|
| 城市 | `hangzhou`、`shanghai` |
| 行政区 | `hangzhou-shangcheng` |
| 商圈 | `hangzhou-wulin` |
| 地铁线路 | `hangzhou-metro-1` |
| 地铁站 | `hangzhou-metro-xianghu` |

## 冲突处理规则

### 同名商圈

- 同一行政区下**不同商圈**（如「武林广场」与「武林路商圈」）是不同节点，`code` 用全拼音区分（`WULINGUANGCHANG` vs `WULINLU`）。
- 不同城市商圈 `code` 天然带 `<城市>-` 前缀，不会撞。
- **同一城市同一商圈只允许一条**。若种子文件内出现重复 `code`，校验器整文件拒绝（见 Task 19）。

### 跨线同名站（换乘站）

- 换乘站只存一条，`parent` 为首开线路（B1.5 口径）。其余线路对该站的关系本期不建模。
- `code` 带 `<城市>-` 前缀全局唯一；同名站不同线路由「归属首开线路」消解，不靠 code 区分。

### 行政区改名

- 迷之改名（撤县设区等）**不改 6 位码**，`code` 保持不变，只更新 `name` 字段。
- `name` 是可变业务字段，`code` 才是主键；改名不产生新节点。

### 与既有存量数据冲突

- 导入按 `immutableCode` 幂等：已存在且字段一致 → 跳过；不一致 → 列出差异并默认跳过（`--update-existing` 才更新，**绝不静默覆盖**）。
- 上海可能存在存量地理数据，导入前必须 dry-run 看冲突清单，逐条比对后决定跳过还是更新（Task 21）。

## 校验

所有 `code` / `slug` / 坐标在导入前由纯函数校验（`src/domain/geography/import-validation.ts`），任一失败整文件拒绝。格式校验复用 `location-hierarchy.ts` 的 `isValidRegionCode` / `isValidLatitude` / `isValidLongitude`。