# Task Packet：OPT-040 跨城/legacy 路由的筛选参数白名单补齐

> 状态：**待排期**（从 OPT-036 Task 12 显式延期而来，不是遗漏）
> 创建日期：2026-08-21
> 来源：OPT-036 列表页改版 Task 12 接线 + 该任务的 code review（I3）
> 编号说明：OPT-037（详情页改版）/ OPT-038（城市招募页改版）已被本轮改版预留，
> OPT-039 是装修维度，故取 040

---

## 1. 一句话

`src/lib/frontend/city-routes.ts` 的 `selectBuildingQuery` 只放行 `grade` 一个参数，
而 OPT-036 刚给楼盘列表页新增了 5 个真实筛选维度——**用户在产品内切换城市、或从
legacy `/buildings` 被重定向到 `/<city>/buildings` 时，6 个维度里有 5 个被静默丢弃**。

## 2. 现状与证据

```ts
// src/lib/frontend/city-routes.ts
function selectBuildingQuery(params: URLSearchParams): URLSearchParams {
  const value = readSingle(params, 'grade')
  return value !== null && BUILDING_GRADE_VALUES.has(value)
    ? new URLSearchParams([['grade', value]])
    : new URLSearchParams()
}
```

这一个函数同时服务**两条真实产品路径**：

| 调用点 | 路径 | 现在的后果 |
|---|---|---|
| `prefixedCanonicalPath` | legacy `/buildings?...` → 307 → `/shanghai/buildings?...` | 除 `grade` 外全丢。实测：`/buildings?onlyWithStock=1` → `/shanghai/buildings`（开关没了） |
| `buildCitySwitchPath` | 用户在页面上点「切换城市」 | 同上。上海页面上叠了「甲级 + 2010 年后 + 仅看有在租」，切到杭州只剩「甲级」 |

**`buildCitySwitchPath` 才是这个工作项的分量所在**（OPT-036 全批次终审补记）。
legacy 307 是一条历史兼容路径，而「切换城市」是产品内的常驻控件、用户主动点的按钮。
把它说清楚：一个已经按**五个维度**收窄过的用户（区域 / 等级 / 地铁 / 在租面积 /
竣工年代 / 仅看有在租，六选五），点一下「切换城市」，除 `grade` 外**全部静默丢失**
——没有提示、没有回退入口，用户只会以为「杭州什么都没筛出来」或「筛选坏了」。

其中 `onlyWithStock` 尤其不能丢：它是这一页的**招牌控件**（本批次唯一获准使用
accent 底色的筛选项，理由见 `FilterFormC.FilterSwitch` 的注释——「暂无在租的楼盘
被降权分组到列表末尾，这个开关是那条产品判断的正面出口」）。整页最醒目、最被鼓励
去点的那个开关，一换城市就悄悄复位，这不是「少保留了一个参数」，是把一条明确的
产品主张在跨城场景里撤销掉。裁定跨城维度取舍时，它应当排在 `grade` 之前考虑。

OPT-036 Task 12 之后，楼盘列表页的六个维度是：
`district` / `grade` / `metro` / `leasableAreaMin`+`leasableAreaMax` / `completedAfter` / `onlyWithStock`。
其中 5 个是本轮新增的。

房源页的对应函数 `selectListingQuery` 需要一并核对是否有同样的形状
（OPT-036 Task 11 也给那一页接了 8 个维度）。

## 3. 为什么当时没做（review 已认可延期，但理由要写准）

不是「非本任务引入所以不管」——那样说低估了它：`buildCitySwitchPath` 是**产品内的真实
交互**，不是历史遗留死代码。延期的真实理由是：

1. **这个白名单是多城工作项定的口径**（注释与测试里称「Task 1 批准的筛选」），
   `citySwitchPreservedFilters` 的语义与既有测试都挂在它上面；在一个「把组件接成页面」
   的接线任务里悄悄改它，等于跨工作项改语义且不会被那边的评审看到。
2. **两条路径对同一个丢弃行为的期望不同**（见下一节），需要先裁定再动代码。

## 4. 需要裁定的问题

**跨城切换时，哪些维度应该跟着走？**

- `district` / `metro`：**必须丢**。上海的行政区 slug、地铁站 slug 在杭州不存在，
  带过去只会得到 0 结果（甚至是别的城市恰好同名的区）。现状正确。
- `grade` / `leasableAreaMin` / `leasableAreaMax` / `completedAfter` / `onlyWithStock`：
  **城市无关**，都是纯语义档位或布尔开关，跟着走没有任何歧义。现状是纯损失。
- `sort` / `page`：`sort` 城市无关（可带），`page` 应当丢（换城市后页码无意义，现状正确）。

**legacy 重定向要不要用同一套规则？** 那条路径不跨城（只是补上默认城市前缀），
理论上**任何**合法参数都该原样保留。若两条路径的正确答案不同，就不该继续共用一个函数。

**`citySwitchPreservedFilters` 的语义要不要跟着改？** 它现在报告「切换是否至少保留了
一个被批准的筛选」，维度变多后这个判据的意义需要重新确认。

## 5. 需要改什么

- [ ] `src/lib/frontend/city-routes.ts`：`selectBuildingQuery` 按裁定结果放行相应参数
      （复用 `parseBuildingSearchInput` 的白名单与边界校验，**不要在这里写第二份取值域**）
- [ ] 同一文件的 `selectListingQuery`：核对房源页 8 个维度是否有同样的缺口
- [ ] 视裁定结果决定是否把「legacy 重定向」与「跨城切换」拆成两个函数
- [ ] `citySwitchPreservedFilters` 及其测试
- [ ] `tests/city-routes.test.ts`、`tests/city-switcher.test.ts`、`tests/city-route-pages.test.ts`
      （后者有一条断言 `/buildings?grade=grade-a&page=2` → `/shanghai/buildings?grade=grade-a`，
      改口径后需要同步更新，注意**保留其断言意图**：page 必须被丢弃）

## 6. 验收

- 在 `/shanghai/buildings?grade=grade-a&completedAfter=2010&onlyWithStock=1` 上点「切换城市」
  到杭州，落地 URL 仍带这三个条件（`district`/`metro` 若有则被丢弃）；
- legacy `/buildings?onlyWithStock=1` 重定向后开关仍生效；
- 房源页同款验证一遍。

## 7. 坑

- **别把取值域抄第三份**：`BUILDING_GRADE_VALUES` 已经在这个文件里，新维度的校验应当
  复用 `parseBuildingSearchInput`（`src/domain/public-catalog/building-search.ts`）而不是
  再写一套白名单——同义常量一多必然漂移（本仓库反复出现的教训）。
- **`readSingle` 只取单值**：楼盘筛选目前是每行单选，但解析层支持多值数组；
  如果将来筛选改成多选，这个函数会静默只保留第一个。
