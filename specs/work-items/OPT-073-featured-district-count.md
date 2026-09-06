# Task Packet：OPT-073 首页热门商圈显示数量——按城市可配（3 张 / 5 张）

> 状态：**已实施**（2026-09-06）
> 创建日期：2026-09-06
> 来源：用户「可以做成可配置的么，根据运营需要，灵活设置」
> **前置依赖**：`OPT-053`（城市站点配置「精选区域」接首页）与 `OPT-060`（商圈卡候选池扩到 20 张）均已上线。

---

## 1. 一句话

首页「热门商圈」现在固定显示 5 张（`CityHomeView.tsx` 的 `HOME_BENTO_SLOTS` 常量），
运营要能按城市选 3 张或 5 张。

## 2. 已定的决策

用户在 2026-09-06 的需求梳理里选定：

1. **只开 3 和 5 两档，不开放任意数量。** 现有 bento 本来就有「5 张两行」与「3 张一行」两种形态
   （`HomeDistrictBento.tsx` 的降级规则），两档都不用动布局与 CSS。任意数量意味着重做首页视觉，
   代价与需求不成比例。
2. **配置放在城市站点配置（`CitySiteProfiles`），每城各配。** 与「精选区域」同一页签：
   运营挑完主推商圈顺手定数量。七城供给量差异大，小城可能凑不出 5 张有在营楼盘的商圈，
   全局一个值会让小城被动降级、运营控制不了。
3. **默认 5，等于现状。** 迁移执行后所有城市首页零变化，只有运营主动改成 3 的城市才变。

## 3. 配置形态

`CitySiteProfiles` 「首页」页签，紧挨 `featuredRegions`（精选区域）之后新增：

| 字段 | 类型 | 说明 |
|---|---|---|
| `featuredDistrictCount` | select：`'5'`（默认） / `'3'` | 标签「热门商圈显示数量」，选项文案「5 张」「3 张」 |

后台描述文案：**「首页热门商圈展示 3 张或 5 张。该城可见且有在营楼盘的商圈不足时会自动减少。」**

用 select 而不是 number：运营面对的是两个档位，不是一个数字；number 输入框会引来 4、6、10 这类
无对应布局的值，校验拦下来也只是徒增翻车面。PG 侧会生成一个 enum 类型，走显式迁移
（`push: false`，见 `.agent/migrations.md`），新列带默认值 `'5'`，存量七城 profile 自动回填。

## 4. 公开契约与映射

`PublicCitySiteProfile`（`src/domain/city-site-profile/public-contract.ts`）新增：

```ts
/** 首页热门商圈显示张数（OPT-073）。只会是 3 或 5；缺失 / 非法一律回落到 5。 */
featuredDistrictCount: 3 | 5
```

映射在 `src/app/(frontend)/_lib/city-context.ts` 的 profile 组装处：`'3'` → 3，其余（`'5'`、null、
undefined、任何意外值）→ 5。**这一项不参与「全有或全无」校验**——与 `typeCardOverrides` 同一口径：
一个展示数量的枚举值不该让整座城市的 SEO 标题、Hero 文案、精选区域一起降级为 null。

## 5. 前台改动

`src/components/frontend/city/CityHomeView.tsx`：

- 删除 `HOME_BENTO_SLOTS` 常量，改为 `city.profile.featuredDistrictCount`。
- 顺序保持 **先按精选区域重排、再截取**（OPT-060 修的就是「先截再排拉不进第 6 名」，别倒回去）。

`HomeDistrictBento.tsx` 与 `home.css` **不动**：

| 配置 | 候选池可供张数 | 实际渲染 |
|---|---|---|
| 5 | ≥5 | 大卡 + 两小卡 + 两宽卡（现状） |
| 5 | 3~4 | 只渲染首行三张（现状降级规则，第 4 张不展示） |
| 3 | ≥3 | 大卡 + 两小卡 |
| 任一 | 1~2 | 等分一行 |
| 任一 | 0 | 整段不渲染 |

「选 5 但只凑出 4 张时显示 3 张」是既有行为，本工作项不改。

## 6. 还要改的地方

- `src/collections/CitySiteProfiles.ts`：加字段（§3）。
- `src/migrations/`：新增迁移（enum 类型 + 列 + 默认值），`pnpm exec payload migrate:create`
  生成后人工核对 `down` 会把 enum 一并删掉。
- `src/domain/city-site-profile/public-contract.ts`、`src/app/(frontend)/_lib/city-context.ts`：§4。
- `src/components/frontend/city/CityHomeView.tsx`：§5。
- 构造 `PublicCitySiteProfile` 的四个测试夹具补 `featuredDistrictCount: 5`：
  `tests/city-home-view.test.ts`、`tests/city-metadata.test.ts`、`tests/city-context-resolver.test.ts`、
  `tests/coming-soon-city-view.test.ts`。
- `payload-types.ts` 重新生成（不跟踪，`pnpm generate:types`）。
- `.agent/` 各文档已核对，没有「热门商圈固定 5 张」的表述，不需要订正。

## 7. 测试

`pnpm test` 新增覆盖：

1. **映射**：`'3'` → 3；`'5'` / null / undefined / `'7'` → 5；非法值不会让 profile 变 null。
2. **首页视图**：候选池 8 张、配置 3 → 只渲染 3 张商圈卡；配置 5 → 渲染 5 张。
3. **与精选区域叠加**：候选池第 6 名在精选区域里、配置 3 → 它在前三张之内
   （证明「先排后截」没被改坏）。

既有的 `tests/featured-regions-ordering.test.ts` 不动。

## 8. 验收判据

1. 本地 `pnpm exec payload migrate` 后起 dev，用 `scripts/seed.ts` 的 E2E 夹具账号登录后台，
   城市站点配置里能看到「热门商圈显示数量」下拉，默认「5 张」。
2. 把上海改成「3 张」保存，前台上海首页热门商圈只剩首行三张；改回「5 张」恢复两行。
   **用浏览器实际点一遍**，按 `CLAUDE.md`「完成前必须在浏览器里实际走一遍」执行，不可用 CI 全绿顶替。
3. 未改过配置的城市首页与改动前逐像素一致（默认值 = 现状）。
4. `typecheck` + `pnpm test` 全绿；`tests/e2e/` 若有后台城市站点配置的用例需自查（E2E 不在本地闸门里）。
