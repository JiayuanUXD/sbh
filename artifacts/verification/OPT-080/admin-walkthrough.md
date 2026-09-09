# OPT-080 后台走查证据：房源面积支持两位小数

日期：2026-09-09 ｜ 分支：`fix/listing-area-decimals-44b5`
环境：本地 `next dev` 3000 端口（3717 被另一个会话的 worktree 占用），
Payload 后台以 `scripts/seed.ts` 的公开夹具账号 `e2e-adm@example.com` 登录。

## 1. 根因

`src/collections/Listings.ts` 的面积字段用了 `NumberField(..., { decimalScale: 1 })`。
`decimalScale` 透传给 `react-number-format`，它**截断输入**而不只是格式化显示——
敲「288.75」当场变成「288.7」，且无任何提示。

同表价格字段（`rent`、`price.amount`）本来就是 `decimalScale: 2`，面积是唯一的 1。

## 2. 后台六个面积输入的实际状况（确认没有改漏）

| 字段 | 写法 | 小数位 |
|---|---|---|
| `Listings.area` 面积（㎡） | `NumberField` + `decimalScale: 1` | **只能 1 位 ← 本次修的** |
| `Buildings.grossFloorArea` 总建筑面积 | 原生 `type: 'number'` | 不限 |
| `Buildings.typicalFloorArea` 标准层面积 | 原生 `type: 'number'` | 不限 |
| `SupplySubmissions` 出租面积 | 原生 `type: 'number'` | 不限 |
| `Leads.areaMin` / `areaMax` | 原生 `type: 'number'` | 不限 |
| `Leads.area` 需求面积 | `type: 'text'` | 不适用 |

只有一处需要改。

## 3. 不需要迁移（有证据）

- 库列是 `"area" numeric`（`src/migrations/20260723_160143_init.ts:123`），**无精度约束**，
  两位小数存得下。
- `decimalScale` 只进 admin 组件 props，不参与 schema 生成。
- **实测**：改动前后各跑一次 `pnpm generate:types`，`src/payload-types.ts` **零 diff**。

## 4. 真实键盘输入的验证（不是 JS 赋值）

`decimalScale` 正是在按键处生效，用 JS 直接赋值会得到假阳性，所以全部用真实键盘输入：

| 输入 | 输入框显示 | 判定 |
|---|---|---|
| `288.75` | `288.75` | **不再被截断**（改动前会变 288.7）|
| `288.755` | `288.75` | 截到两位 —— 证明限制是**放宽到 2**，不是被关掉 |

## 5. 保存与持久化：三步铁证

1. **抓包**：拦截 fetch，`PATCH /api/listings/1` 的请求体 `area: 288.75`
2. **响应**：HTTP 200，响应文档 `area: 288.75`
3. **强刷重载**：重新进入编辑页，输入框回显 `288.75`；直接查 `GET /api/listings/1?depth=0`
   返回 `area: 288.75`（`typeof` 为 `number`）

## 6. C 端渲染

列表页卡片面积显示「288.75 ㎡」。`formatArea` 只做字符串插值、不舍入，两位小数正常透出。

## 7. 收尾

测试用的房源 1 面积已从 288.75 **还原为原值 360**（`GET` 复核 `area === 360`）。

## 8. 闸门

- `pnpm typecheck`：干净
- `pnpm test`：343 文件 / 4705 用例通过，8 文件 41 用例跳过
