# Task Packet：OPT-051 `Listings` / `Buildings` 没配 `delete` 权限，默认任何登录用户可永久删

> 状态：**已实施**（2026-08-24，按方案 B）
> 创建日期：2026-08-24
> 来源：排查 OPT-050 时顺带核查权限配置
> 编号说明：OPT-050 是楼盘删不掉，故取 051

---

## 1. 一句话

供给侧最核心的两个集合 `Listings` / `Buildings` 的 `access` 里**只配了 `read`**，
`delete` 缺省——Payload 的默认是「任何登录用户都能删」。而其余十个集合都显式
收了口（`delete: () => false` 或绑权限码）。**这两个例外恰恰是最不该开放的。**

## 2. 证据

```ts
// src/collections/Listings.ts:220
access: {
  read: () => true,
},
```

`Buildings.ts` 同样只有 `read`。对照其它集合：

| 集合 | delete 配置 |
|---|---|
| `AuditLogs` / `CityPartnerApplications` / `CitySiteProfiles` / `DomainEvents` / `FollowUps` / `InformationCorrections` / `LeadOwnershipHistory` / `ListingReviews` | `delete: () => false` |
| `ListingReports` | `delete: 'report:manage'` |
| `LocationAliases` | `delete: 'location:manage'` |
| **`Listings` / `Buildings`** | **（缺省 → 任何登录用户）** |

## 3. 真实影响

两个集合都设了 `trash: true`，所以后台的「删除」是移至回收站——但：

1. **回收站里的「永久删除」同样受 `access.delete` 管**，缺省即对所有登录用户开放；
2. **本项目 `payload.delete` 恒为硬删**（`trash` 参数只是查询过滤器，
   见记忆条目「payload-delete-is-always-hard」），任何直接调 API 的路径都是真删；
3. **这个库上已经真实发生过一次房源硬删**。

也就是说：一个只该看看数据的低权限账号，可以永久删掉生产房源与楼盘。

## 4. 裁定：方案 B（绑权限码）

用户 2026-08-24 授权按推荐方案执行。与 `ListingReports` / `LocationAliases` 的既有
口径一致，且删除是低频高危操作，值得一个独立权限码。

### 4.1 意外发现：权限码早就存在，是死代码

`listing:delete` / `building:delete` **早在 `permission-codes.ts` 里定义好了**——
`access.ts` 的文档注释甚至直接拿 `listing:delete` 当用法示例。但它们：

- 从未被任何 collection 消费；
- 从未在任何迁移里授予任何角色；
- 也不在 `src/test/factory/roles.ts` 里。

一对彻底的死代码。所以本次**不需要新增权限码，也不需要迁移**——
只要把已有的码接上即可。

### 4.2 当前谁能删

只有 ADM（`operationPermissions: ['*']`，通配符由 `hasOperationPermission` 内部处理）。
将来要放给 OPS，走迁移授权 + 同步 `roles.ts` 工厂（不同步会被 seed 擦掉）。

## 4.9 原「需要裁定的问题」（保留备查）

`delete` 该收到什么程度？三个选项，**需要用户裁定**：

| 方案 | 含义 | 代价 |
|---|---|---|
| A. `delete: () => false` | 谁都不能删，只能下架 | 最安全；但脏数据（如导入测试数据）只能靠 DBA 清 |
| B. 绑权限码（如 `listing:delete` / `building:delete`） | 只有显式授权的角色能删 | 与其它集合口径一致；需新增权限码 + 迁移给角色授权 |
| C. 收到 ADM 独有 | 只有管理员能删 | 简单；但 ADM 是 `['*']`，等于「谁是管理员谁能删」 |

倾向 **B**：与 `ListingReports` / `LocationAliases` 的既有做法一致，
且删除是低频高危操作，值得一个独立权限码。

⚠️ 注意与 **OPT-050** 的关系：OPT-050 会让「有房源的楼盘」删不掉。
本工作项管的是「谁有资格发起删除」，两者正交，都要做。

## 5. 需要改什么

- [ ] 裁定 §4 的方案
- [ ] `src/collections/Listings.ts` / `Buildings.ts`：补 `delete`
- [ ] 若选 B：`permission-codes.ts` 加码 + 迁移给角色授权 + `src/test/factory/roles.ts` 同步
      （⚠️ 工厂不同步会被 seed 擦掉，见 OPT-045 §9 的实测教训）
- [ ] 测试：无权限用户删被拒；有权限用户可删

## 6. 验收

- 无 `delete` 权限的角色在后台看不到删除入口，直接调 API 也返回 403；
- 有权限的角色可正常删除（受 OPT-050 的业务规则约束）；
- `pnpm test` 全绿。

## 7. 坑

- **别只改 collection 不改工厂**：`scripts/seed.ts` 的角色 update 分支无条件用
  `BUILTIN_ROLES` 覆写，工厂没同步的权限会在「先迁移再 seed」时被擦掉，
  且只掉部分角色（ADM 是 `['*']` 不受影响），这种失效最难发现。
- **`trash: true` 不等于安全**：它只影响后台按钮的语义，不影响 `access.delete`
  的判定，也不影响直接调 API 的硬删路径。

## 8. 相关

- OPT-050 —— 楼盘删不掉（同域，独立问题：一个管「能不能删成功」，一个管「谁有资格删」）
- 记忆条目「payload-delete-is-always-hard」
