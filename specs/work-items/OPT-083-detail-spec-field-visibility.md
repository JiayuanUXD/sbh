# Task Packet：OPT-083 详情页参数字段后台可配

> 状态：**实施中**
> 创建日期：2026-09-10
> 来源：用户要求「楼盘和房源详情页的参数字段做成可配置的，通过后台选择哪些在前台展示、哪些不展示」

> **编号沿革**：本工作项最初编为 OPT-082，实施期间 master 上另一个工作项
> （`OPT-082-card-media-ratio-unification.md`，卡片媒体比例统一）先落地占用了该号，
> 遂改为 OPT-083。改号时把代码注释、测试文件名、规格路径引用一并改了；
> **迁移文件也一起改名**（`..._opt_083_detail_spec_visibility`），因为它当时只在本地
> 库跑过、生产从未执行，重命名不会造成「同一迁移两个名字」。

---

## 1. 一句话

把楼盘详情页「楼盘参数」面板与房源详情页「房源概况」面板里**硬写在代码数组中**的行清单，
提取成一份共享的参数登记表（registry），由「站点设置」Global 里的开关决定每一项是否在
前台展示；同时把「值缺失渲染 `—`」改为「值缺失不渲染该行」。

## 2. 产品裁定（用户逐条确认，不要在实施中自行改口径）

| 议题 | 裁定 | 备注 |
| --- | --- | --- |
| 配置粒度 | **全站一套** | 不按城市、不按单条记录，也不做「全站默认 + 单条覆盖」两层 |
| 配置能力 | **显隐 + 增减** | 不做排序、不做改标签、不做重组分组。注：§4.2 在**代码侧**新增一个分组，那是实现裁定，不是开放给后台的能力 |
| 「增」的边界 | **只从代码已知的候选池里勾选** | 不做自定义字段、不做自由键值行；值仍来自各自数据 |
| 空值行 | **没值就不显这行**（推翻现有不变量） | 见 §6 |
| 楼盘首屏「关键参数」 | **不受配置影响**，保持写死 | 已知会出现「参数区关了物业费、首屏还挂着」，被接受 |
| JSON-LD 结构化数据 | **不跟随隐藏**，照常输出 | 结构化数据是给机器的事实声明，与版面展示是两件事 |
| 后台入口 | **归到「站点设置」新开一个 tab** | 不新建 Global、不做成字典 collection |

## 3. 现状：这份清单今天在哪

- 数据源：`mappers.ts` 的 `mapBuildingFactGroups` / `mapListingFactGroups` 把 collection
  字段拍成 `factGroups`（带中文标签的扁平事实清单）。
- 展示层：`BuildingSpecPanel.buildBuildingSpecGroups`（4 组 23 行）与
  `ListingOverviewPanel.buildListingOverviewGroups`（4 组 22 行）**各自在代码里硬写一份行
  清单**，按中文标签去 `factGroups` 里捞值。
- 因此「展示哪些参数」这件事今天只存在于这两个 `.tsx` 的数组字面量里，改一次要发一次版。
- 关键问题：**取值逻辑与展示决策揉在一起**——`{ label: '得房率', value: fact('得房率') }`
  这一行同时回答了「这行取什么值」和「这行列不列」。要做成可配，必须先把两者拆开。

## 4. 核心改动：参数登记表

新增 `src/domain/detail-spec/`，楼盘与房源**各一份 registry**（不做统一抽象——两者的取值
上下文本就不同：楼盘要 `factGroups` + `amenityGroups` + `minLeasableArea`，房源要
`factGroups` + `price` + `availableFrom` + `building`；强行统一只会造出一个什么都装的
ctx）：

```ts
type BuildingSpecFieldDef = {
  key: string          // 稳定键，同时是配置键与 DB 列名基
  label: string        // 前台标签
  group: BuildingSpecGroupId
  defaultVisible: boolean
  resolve: (ctx: BuildingSpecContext) => string | null
}
```

`resolve` 里放的就是现在数组里那些表达式（`fact('得房率')`、
`combineFacts(groups, '客梯', '货梯')`、`publicCertificationsText(amenityGroups)`、
`formatAvailableDate(listing.availableFrom)` …），**一行不改地搬过去**，语义不变。

两个面板改成「读 registry → 按配置过滤 → 交给 `SpecTable`」，不再自己攥着行清单。

### 4.1 候选池（楼盘 23 项）

| 组 | 项 |
| --- | --- |
| `structure` 建筑（8） | 物业类型、楼盘等级、竣工年份、总建筑面积、总楼层、标准层面积、层高 / 净高、得房率 |
| `mep` 机电与设施（7） | 客梯 / 货梯、空调、供电、网络、门禁、电梯分区、服务时间 |
| `cost` 费用与管理（5） | 物业费、物业公司、开发商、停车位、停车费 |
| `qualification` 资质与运营（3） | 认证、可注册、最小可租面积 |

楼盘侧 `mapBuildingFactGroups` 产出的事实已被面板用尽（其中「标准层高 / 净层高」「客梯 /
货梯」各合并成一行），**没有可增补的富余项**——候选池 = 现状清单，全部 `defaultVisible: true`。

### 4.2 候选池（房源 24 项）

| 组 | 项 |
| --- | --- |
| `space` 面积与格局（8） | 建筑面积、套内参考面积、得房率、净层高、工位估算、房源楼层、朝向、可分割 |
| `terms` 租赁条件（4） | 合同单价、起租期、押金、付款方式 |
| `delivery` 交付与资质（6） | 装修状态、家具、交付时间、可注册、空调、网络 |
| `cost` 费用明细（4） | 物业费、停车费、发票、其他固定费用 |
| `verification` 信息时效（2，**新增组**） | 信息核验时间、价格核验时间 |

前 22 项 `defaultVisible: true`（即现状）。

**新增的 `verification` 组**：`mapListingFactGroups` 一直在产出 `信息核验时间`
`价格核验时间`（`id: 'verification'`, `title: '信息时效'`），但概况面板从没展示过。它们
语义上不属于现有四组任何一组，硬塞进「交付与资质」是为了少开一个组而牺牲语义。
实现裁定：**新增第 5 组，两项默认 `false`**——默认全关 ⇒ 该组无可见行 ⇒ 整组不渲染
（见 §6），所以 §8 的「上线零变化」守卫仍然成立。

> **这两项的值是 ISO 字符串**，`mapListingFactGroups` 没做展示格式化（与「竣工时间」同一
> 个坑，`fact-lookup.ts` 已有 `formatCompletionYear` 先例）。接进候选池时必须顺手补格式
> 化，不能把 `2026-03-14T00:00:00.000Z` 直接甩给用户。这是把它们纳入候选池的**前置条件**，
> 不是后续优化。

## 5. 后台形态

`SiteSettings` 新增 tab「详情页参数」，下设「楼盘参数」「房源参数」两个 group，组内按
registry 的语义分组排开 checkbox，label 即前台标签。运营看到的是 9 组勾选框，共 **47 个开关**。

硬约束：

- 47 个 checkbox 字段**由 registry 生成**，不在 `SiteSettings.ts` 里手抄一遍。手抄必然与
  registry 漂移；本仓库「同一判断逻辑多处」已栽 7 次，同义清单也是同一类问题。
- 每个 checkbox 的 `defaultValue` = registry 的 `defaultVisible`，取值即当前代码的展示
  现状。**上线当天前台零变化。**
- 权限复用 `site_settings:manage`，不新增权限码。
- `access.update` 已在 `SiteSettings` 显式声明（缺它等于对所有登录账号开放 PATCH，见该文件
  头部注释与 OPT-051 / OPT-055），本项不动它，但也不要因为「加了个 tab」就重写 access。
- 费用披露类字段（房源的「其他固定费用」「物业费」「停车费」）在 `admin.description` 里标注
  「关闭前请确认合规口径」。**不做硬禁止**——运营有权决定，但要让他知道自己在关什么
  （`ListingOverviewPanel` 头部注释：删一条费用条款与删一条装修状态不是一个量级）。

## 6. 空值行改为隐藏

推翻 `SpecTable` 现有不变量（「`value: null` 必须渲染 `—` 且保留该行」）。连带行为一次
定清楚，不留半截：

| 情形 | 行为 |
| --- | --- |
| 勾选了、但这条记录没值 | 不渲染该行 |
| 一组内所有行都没值 | 连组标题一起不渲染 |
| 所有组都没可见行 | 整个参数面板不渲染，**不留空白卡片** |
| 未勾选 | 不渲染 |

实现位置：过滤放在 `build*Groups`（现改名为 registry 消费函数）里，**`SpecTable` 保持
「给什么渲什么」**——它不该知道隐藏规则。

> **必须改写 `SpecTable.tsx` 头部那段解释「为什么不隐藏」的长注释**，写清规则变了、搬去
> 哪了、为什么变（运营编辑决策 ≠ 数据缺失）。留着不动，下一个人会照注释把行为「修」回来。
> 同理 `ListingOverviewPanel` / `BuildingSpecPanel` 头部关于「整组全缺仍渲染该组」的段落。

## 7. 读取链路

复用现成管道，不新建：

- `getCachedSiteSettings()`（`unstable_cache` + `afterChange` 主动失效，改完最长 60 秒、
  单实例下即时）。
- 两个详情页**已经在读** `siteSettings` 取免责声明（`[city]/buildings/[slug]/page.tsx`、
  `[city]/listings/[slug]/page.tsx` 及对应 legacy 路由），把可见性配置一起往下传即可，
  同请求内由 `unstable_cache` 去重，不多打一次库。
- 三层兜底照 OPT-053 既有约定：配置值 → checkbox `defaultValue` → registry 的
  `defaultVisible`（Global 表在迁移执行前不存在时走这层；dev-story 演示页与单测也不该被迫
  传这个 prop）。

## 8. 测试

- 改写 `tests/building-spec-panel.test.ts`、`tests/listing-overview-panel.test.ts` 里 4 条
  「缺失不隐藏 / 整组全缺仍渲染」的守卫用例，按新口径反向重写。
- **新增零变化守卫（本改动最重要的安全网）**：用 registry 的默认配置产出的行清单，逐字
  等于改造前的两份硬编码清单（组序、行序、标签、取值全部对齐）。这条挡住重构过程中的
  静默增删——本仓库两次「接线造成的静默内容删除」（楼盘丢 6 条、房源丢 5 条）都是这么发生的。
- **新增 registry 覆盖守卫**：`SiteSettings` 生成的配置字段与 registry 一一对应，不许有
  孤儿键、不许有漏生成（照 collection 写侧 access 收口时那次全量覆盖守卫的写法，PR #160）。
- E2E：改后台不影响导航，但 `tests/e2e/` 里若有断言详情页参数行的用例需同步核查
  （**pre-push 只跑 typecheck + test，E2E 不在本地闸门里**，必须自查，否则本地全绿 CI 才炸）。

## 9. 迁移

一次迁移，加 47 个 boolean 列（带默认值），按 `.agent/migrations.md`。
生产 DB 是 `push: false`，只走显式迁移。

## 10. 完成前必须在浏览器里实际走一遍

单测全绿 + typecheck 干净 ≠ 可用（OPT-053 的教训：3823 个单测全绿，菜单点进去是「没有找到
任何东西」）。

- 起 dev server，用 `scripts/seed.ts` 的 E2E 夹具账号登录后台。
- 后台勾掉几项 → 保存 → 前台确认对应行消失；勾回来 → 确认恢复。
- **本地验之前先 `pnpm exec payload migrate`**，否则会看到「缺列导致 500 → 页面降级」这类
  与代码无关的假象。
- 至少验一次「整组关光 → 组标题也不见」与「某条记录数据很少 → 面板整体不渲染」两种边界。

## 11. 已知代价（用户已确认接受）

1. **「未勾选」与「没值」在前台不可区分**。运营关掉某项后，无法从页面判断是配置关的还是
   数据缺的，排查要回后台对配置。这是配置化 + 空值隐藏叠加的固有代价。
2. **「这栋楼资料不全」的信号被弱化**。资料不全的楼盘参数区会明显变短，但页面上不再有
   `—` 提示读者「这个维度我们披露、只是这栋楼没有可核实的值」。不加补偿机制（YAGNI）。
3. **首屏与参数区可能自相矛盾**：关掉参数区的「物业费」后，楼盘首屏「关键参数」仍可能挂着
   物业费。按裁定保持现状，不做联动。

## 12. 工作量

registry 提取是大头（把两份硬编码清单重构成数据，且要保证零变化），估 **1.5–2 天**含浏览器验证。
