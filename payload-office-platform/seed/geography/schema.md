# 地理种子数据格式（seed/geography）

七城地理种子数据按城市分文件存于 `seed/geography/{shanghai,nanjing,hangzhou,suzhou,wuxi,ningbo,jiaxing}.json`。本文件是 JSON 的 schema 说明与约束。命名规范见 `docs/geography-code-convention.md`。

## 顶层结构

```jsonc
{
  "city": { ... },           // 城市节点（必填，恰好 1 个）
  "districts": [ ... ],      // 行政区（可为空）
  "businessAreas": [ ... ],  // 商圈（核心办公商圈，可为空）
  "metroLines": [ ... ]      // 地铁线路，内含 stations（可为空，如嘉兴无地铁）
}
```

数组顺序即导入顺序（脚本严格按 城市 → 行政区 → 商圈 / 线路 → 站点 写入）。文件内 `sortOrder` 不要求连续，脚本按节点内填写的 `sortOrder` 原样写入。

## 节点字段

### city

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | 中文名，如「杭州市」 |
| `immutableCode` | string | ✓ | `CITY-<缩写>`，满足 `^[A-Z0-9][A-Z0-9_-]{1,63}$` |
| `slug` | string | ✓ | C 端 URL，全局唯一 |
| `centerLatitude` | number | | -90 ~ 90 |
| `centerLongitude` | number | | -180 ~ 180 |
| `sortOrder` | number | | 默认 100 |

城市无 `parent`。`status` 默认 `active`，`frontendVisible` 默认 `false`（Task 22 约定，导入节点一律前台不可见）。

### district（行政区）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | |
| `immutableCode` | string | ✓ | `<城市>-D-<统计局6位码>` |
| `slug` | string | ✓ | |
| `centerLatitude` / `centerLongitude` | number | | |
| `sortOrder` | number | | |

`parent` = city（由脚本按文件归属自动连，不写字段）。

### businessArea（商圈）

在 `districts` 之上并不固定挂某区？**否**——商圈按 `districtCode` 挂到已导入的行政区：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | |
| `immutableCode` | string | ✓ | `<城市>-BA-<拼音>` |
| `slug` | string | ✓ | |
| `districtCode` | string | ✓ | 所属行政区的 `immutableCode`（**引用用 code，不用 id**） |
| `centerLatitude` / `centerLongitude` | number | | |
| `sortOrder` | number | | |

### metroLine（地铁线路）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | 如「地铁1号线」 |
| `immutableCode` | string | ✓ | `<城市>-ML-<线路号>` |
| `slug` | string | ✓ | |
| `sortOrder` | number | | |
| `stations` | array | | 该线路的站点 |

线路 `parent` = city。在建 / 未开通线路不导入（B1.5）。

### station（地铁站）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | |
| `immutableCode` | string | ✓ | `<城市>-MS-<拼音>` |
| `slug` | string | ✓ | |
| `centerLatitude` / `centerLongitude` | number | | |
| `sortOrder` | number | | |

站点 `parent` = 所在 metroLine。换乘站只存一条，归属首开线路（B1.5 口径）。

## 引用与约束

1. **引用一律用 `immutableCode`，不用 id**（id 随环境变化，code 是稳定键）。`districtCode` 即此类引用。
2. **`slug` 全局唯一**（`Locations.slug` unique 约束）。跨文件不应出现重复 slug。
3. **`immutableCode` 全局唯一**。文件内自查重 + 与既有库去重（冲突处理见 Task 19）。
4. 坐标越界（纬度不在 [-90,90]、经度不在 [-180,180]）、code 格式非法、`districtCode` 指向不存在的区、文件内重复 code → 整文件拒绝，不做部分导入。
5. 所有校验由 `scripts/import-geography.ts` 的纯函数完成（`src/domain/geography/import-validation.ts`），本文件不承担执行职责。

## 文件头注释

每个种子文件顶部必须含：

```jsonc
// 来源：<民政部/统计局行政区划代码、各地铁集团官方线网图等>
// 采集日期：YYYY-MM-DD
// 核对人：<name>
// 行政区划核对截止：YYYY-MM-DD（行政区划会调整，过期需复查 code/name）
```

JSON 标准不支持注释，文件头注释用 `//` 或 `/* */` 由脚本剥离（`_template.json` 演示）。

## 空数组合法性

- 嘉兴可能无地铁 → `metroLines: []` 合法。
- 城市必然有行政区（`districts` 至少 1 个）；商圈可为空（配额软上限，宁缺毋滥）。