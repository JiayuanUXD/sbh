# Task Packet：OPT-080 房源面积输入支持两位小数

> 状态：**实施中**
> 创建日期：2026-09-09
> 来源：用户「后台面积输入改为支持小数点后两位，当前只能输入一位」

---

## 1. 一句话

`src/collections/Listings.ts` 的面积字段 `decimalScale` 由 1 改为 2。

## 2. 根因

`NumberField(..., { decimalScale: 1 })` 把 `decimalScale` 透传给 `react-number-format`，
它**截断输入**而不只是格式化显示——运营敲「288.75」当场变成「288.7」，且不给任何提示。

同表价格字段（`rent`、`price.amount`）本来就是 `decimalScale: 2`，面积是唯一的 1。

## 3. 范围：只有一处

后台六个面积输入里，只有 `Listings.area` 走 `NumberField` 并带 `decimalScale`；
`Buildings.grossFloorArea` / `typicalFloorArea`、`SupplySubmissions` 的出租面积、
`Leads.areaMin` / `areaMax` 都是原生 `type: 'number'`，本来就不限小数位；
`Leads.area` 是 `text`，不适用。清单见走查证据 §2。

## 4. 不需要迁移，但会触发 pre-commit 闸门

- 库列 `"area" numeric`（`20260723_160143_init.ts:123`）**无精度约束**，两位小数存得下。
- `decimalScale` 只进 admin 组件 props，不参与 schema 生成。
- **实测**：改动前后各跑一次 `pnpm generate:types`，`src/payload-types.ts` **零 diff**。

`.githooks/pre-commit` 第 4 条按路径匹配拦「改了 `src/collections/` 却没新增迁移」，
它区分不了纯 UI 改动，因此本次用了它自带的逃生舱 `SKIP_MIGRATION_CHECK=1`
（该条自己的提示语就是「纯 UI 改动：SKIP_MIGRATION_CHECK=1 ...（仅当确实不涉及表结构）」）。
用它的依据就是上面那条零 diff 的实测，已写进提交信息。

## 5. 验收

真实键盘输入（`decimalScale` 在按键处生效，JS 赋值会得到假阳性）：

| 输入 | 显示 | 判定 |
|---|---|---|
| `288.75` | `288.75` | 不再被截断 |
| `288.755` | `288.75` | 截到两位——证明是**放宽到 2** 而非关掉限制 |

保存三步铁证：请求体 `area: 288.75` → 响应 200 且文档 `area: 288.75` →
强刷重载后输入框回显 `288.75`、`GET /api/listings/1` 返回 `288.75`（number）。

C 端列表卡显示「288.75 ㎡」（`formatArea` 只做插值、不舍入）。

测试数据已还原（房源 1 的面积改回 360）。

闸门：`pnpm typecheck` 干净，`pnpm test` 343 文件 / 4705 用例通过。
