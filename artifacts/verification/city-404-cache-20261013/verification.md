# 查库失败被缓存成 404 修复 验证记录（2026-10-13）

## 现象

Deploy run 38393504548（#211 合并后）冒烟期间，生产 `/api/health` 大量约 10s 后 503（等连接超时），
`GET /` 两次 404。首页 404 的成因：`createCityContextResolver` 把查库异常吞成 `null`（「城市不存在」），
外层 `unstable_cache`（300s）缓存 resolve 值 → 页面 `notFound()`；数据库恢复后该实例上首页 / 城市页仍 404。

## 修复

`src/domain/city-site-profile/resolver.ts`：查库异常向上抛出，不再返回 `null`。
「不存在 / 未启用 / slug 不符」仍返回 `null`（fail closed 不变）。`unstable_cache` 不缓存 reject：
未命中时下一次请求照常重查；已有缓存时后台刷新失败、继续用旧值。

## 复现对照（`repro-cached-404.sh`，生产构建 + 本地 PG，57,552 条房源放大数据）

把 `city_site_profiles` 临时改名模拟查库失败，空缓存起步：

| 步骤 | 修复前（`5349c38` 构建） | 修复后 |
|---|---|---|
| 查库失败期间 `/shanghai/coworking` | 500 | 500 |
| 恢复后 `/shanghai/coworking` | **404** | 200 |
| 恢复后 `/shanghai` | **404** | 200 |

修复前跑了两次，结果一致。

## 其它

- 浏览器（Playwright，修复后构建）：首页 200、hero 图正常、`/entrust`、后台登录页正常；
  `/shanghai`、`/shanghai/listings`、`/shanghai/coworking` 200；不存在的城市 `/no-such-city` 仍 404。
- 单测：`city-context-resolver` 新增「查库失败向上抛出」与「数据库恢复后立即解析出城市」两例
  （按 Next 语义模拟只缓存 resolve 值的 `unstable_cache`），修复前两例均红。
- `pnpm typecheck` 通过；`pnpm lint` 0 error（35 项既有 warning）；`pnpm test` 440 文件 / 5987 用例全过。

## 未在本次修改（同类、较轻）

`src/lib/frontend/site-settings.ts` 的 `readSiteSettings` 在缓存函数内把查库异常吞成默认设置，
会被缓存 60s（logo、免责声明等回落默认值，不会 404）。
