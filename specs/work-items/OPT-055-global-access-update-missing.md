# Task Packet：OPT-055 缺省 `access` 一族——Global 与 14 个 Collection 对登录用户全开

> 状态：**已确认，未修复**
> 创建日期：2026-08-26
> 来源：审查 `OPT-053` 设计时，Codex 指出「照抄 `AdvisorServiceHours` 只声明 `read`」会留越权口；
> 核查 Payload 源码后发现**该 Global 本身现在就是这个状态**
> 编号说明：OPT-054 是导航配置，故取 055

---

## 1. 一句话

`AdvisorServiceHours` 的 `access` 只声明了 `read`，Payload 会把缺失的 `update`
补成 `defaultAccess`——判据仅为 `Boolean(req.user)`。**任何已登录账号都能改平台
顾问服务时间**，而该文件的注释写着「后台读写限管理员」。

## 2. 证据

`src/globals/AdvisorServiceHours.ts:26-29`：

```ts
access: {
  // 读取由前台派生状态使用（overrideAccess），公开访问走页面层；后台读写限管理员
  read: () => true,
},
```

注释声称「后台读写限管理员」，但**没有 `update`**。

`payload@3.86.0` — `dist/globals/config/sanitize.js:33-38`：

```js
if (!global.access.read) {
    global.access.read = defaultAccess;
}
if (!global.access.update) {
    global.access.update = defaultAccess;   // ← 这一条
}
```

`dist/auth/defaultAccess.js:1`：

```js
export const defaultAccess = ({ req: { user } })=>Boolean(user);
```

判据只有「有没有登录」。

## 3. 真实影响

任何持有有效会话的账号——BRK 经纪人、CSR 客服，以及未来任何低权限角色——
都能直接：

```
PATCH /api/globals/advisor-service-hours
```

改掉平台的工作日、服务时段与节假日例外。前台的「当前服务中 / 非服务时段」
状态、`AdvisorCard` 的展示、以及询价链路里的排期提示都由它派生。

**后台菜单里看不见入口不构成防护**：`admin.hidden: true` 只影响 UI 渲染，
REST/GraphQL 端点照常开放。这与 `OPT-051` 的判断完全同型——那次是
「回收站里的永久删除同样受 `access.delete` 管，缺省即对所有登录用户开放」。

生产目前只有 ADM 一个角色（`TODOS.md` T3 在册），**所以现在还没有可利用的
低权限账号**——但那是运气，不是防护。M1 权限系统一落地，这个洞立刻可用。

## 4. 修法

给 `AdvisorServiceHours` 显式声明 `access.update`，绑权限码，
与 `ListingReports`（`delete: 'report:manage'`）/ `LocationAliases`
（`delete: 'location:manage'`）的既有口径一致。

同时**修正那句注释**——它现在描述的是一个不存在的状态，比没有注释更坏。

### 4.1 顺带做一道通用守卫

这不是一次性缺陷，是一类。加测试：**遍历 `payload.config` 里所有 globals 与
collections，断言每个都显式声明了 `create` / `update` / `delete`**（或用
`createCollectionAccess` 工厂）。

`OPT-051` 修的是同一族问题，但只修了 `Listings` / `Buildings` 两个具体集合、
**没有加通用守卫**——于是同一个洞在下面这些地方还开着。

---

## 5. 全库审计（2026-08-26 实测）

`payload/dist/collections/config/defaults.js:6-10` 确认：collection 的
`create` / `read` / `update` / `delete` 缺省全部落到 `defaultAccess`
（判据仅 `Boolean(req.user)`）。逐个扫过 30 个 collection 的结果：

| 严重度 | Collection | 缺什么 | 为什么这么判 |
|---|---|---|---|
| **高** | `Customers` | **整个 access 块都没有** | 连 `read` 都是"任何登录用户"，而它存客户 PII |
| **高** | `Leads` | create / update / delete | 线索 + 客户 PII，且本仓库 `payload.delete` 恒为硬删 |
| **高** | `Media` | create / update / delete | 全站图片都在里面，硬删不可逆 |
| 中 | `Merchants` `Locations` `Teams` `Brokers` `BuildingMerchantRelations` `BusinessAreaExtensions` | create / update / delete | 业务主数据 |
| 中 | `Articles` `Pages` `Amenities` `DisplayTags` | create / update / delete | 内容与字典 |
| 低 | `FollowUps` `LeadOwnershipHistory` | 仅缺 create | **可能是有意的**——任何登录用户能创建跟进记录是合理设计 |

加上 §2 的 `AdvisorServiceHours`（Global 缺 `update`）。

### 5.1 必须逐个判定，不要一把梭

上表的"低"那一档提示了一件事：**缺省不等于错**。`FollowUps` 允许任何登录用户
创建跟进记录很可能就是设计意图。**实施时要逐个确认业务意图，再决定收成什么口径**，
不能拿一条规则批量套上去——那会把正常功能锁死。

### 5.2 审计方法（可复现）

判据是「有没有 `createCollectionAccess`，或显式写了 create/update/delete」：

```bash
for f in src/collections/*.ts; do
  n=$(basename "$f" .ts)
  grep -q "createCollectionAccess" "$f" && continue
  grep -qE "^\s+access:" "$f" || { echo "MISS $n : 无 access 块"; continue; }
  miss=""
  for op in create update delete; do grep -qE "^\s+$op:\s" "$f" || miss="$miss $op"; done
  [ -n "$miss" ] && echo "MISS $n : 缺$miss"
done
```

> 第一版扫描用 `sed -n '/^  access: {/,/^  },/p'` 取 access 块，把
> `access: createCollectionAccess({...})` 这种写法整个漏掉，误报了
> `LocationAliases`（实际四个操作齐全）。**判据要认所有写法，否则审计结果本身不可信。**

## 6. 测试

**必须绕过后台 UI 直接打 API**：用各角色凭据 `PATCH` 该 Global，
断言非授权角色收 403。

只断言「菜单里看不到」或「`admin.hidden` 为 true」测不到这个缺陷——
缺陷恰恰在于 UI 与 API 的防护不是同一回事。

## 7. 与 OPT-053 的关系

`OPT-053` 要新建 `SiteSettings` Global，其 §4.6 已写明必须显式声明
`access.update`，并明确标注**不要整份照抄 `AdvisorServiceHours` 的 `access`**。

两者可以独立进行。若 `OPT-055` 先落地，`OPT-053` 的 §4.6 可以改成
「照抄修好之后的 `AdvisorServiceHours`」，回到最初的意图。
