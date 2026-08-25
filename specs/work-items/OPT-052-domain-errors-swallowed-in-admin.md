# Task Packet：OPT-052 钩子抛出的领域错误在后台一律显示为「Something went wrong.」

> 状态：**已实施**（2026-08-24，方案 A，浏览器实测两条路径）
> 创建日期：2026-08-24
> 来源：OPT-050 的本地浏览器验证——守卫拦住了，但运营看不到原因
> 编号说明：OPT-051 是删除权限，故取 052

---

## 1. 一句话

`DomainError` 没有 `isPublic` / `status` 标记，于是在 Payload **自己 catch 错误的
那些路径**（批量删除 / 批量更新）上，消息被 `isErrorPublic()` 判为不可公开、
替换成「Something went wrong.」。

> **⚠️ 立项时的判断有一半是错的，已订正——见 §2.5。**
> 项目**早已有** `domainErrorAfterError` 这个 `afterError` 钩子在做映射，
> 单条操作路径上文案是能正常透传的。真正漏的只是 Payload 自行兜底的批量路径。

## 2. 怎么发现的

OPT-050 给楼盘加删除守护，文案写的是：

> 楼盘「陆家嘴江景甲级写字楼」下还有 8 套房源，不能删除。请先把这些房源删除或
> 转移到其它楼盘，再删楼盘。

本地浏览器实测，后台实际显示：

```json
{"errors":[{"id":3,"isPublic":false,"message":"Something went wrong."}]}
```

**拦截成功、文案丢失**，而当时 10 条单测全绿——它们只断言「抛了错」，
没断言「错误能不能被运营看到」。

## 2.5 订正：项目早已有映射钩子，漏的是批量路径

立项时我写「全仓搜 `isPublic` 零命中 → 所有钩子错误都被吞」——**这个推断错了**。
实施前复核发现：

`src/domain/shared/payload-after-error.ts` 的 `domainErrorAfterError` 已在
`payload.config.ts:388` 注册，把 `DomainError` 映射成 403/404/409/422 并透传文案，
还带「匿名请求不透传」的保护。实测该钩子对 `InvalidOperationError` 返回：

```json
{"status":422,"response":{"errors":[{"message":"楼盘下还有 8 套房源"}]}}
```

**那 OPT-050 为什么还是看到「Something went wrong.」？**

因为当时走的是**批量删除**（`DELETE /api/buildings?where=...`）。
`payload/dist/collections/operations/delete.js:223` 自己 catch 每一条错误：

```js
const isPublic = error instanceof Error ? isErrorPublic(error, config) : false
errors.push({ id: doc.id, isPublic, message: ... })
```

这发生在 `afterError` 钩子**之前**，钩子根本轮不到。而 `isErrorPublic` 的判据是：

```js
if (config.debug) return true
if (payloadError.isPublic === true) return true
if (payloadError.isPublic === false) return false
if (payloadError.status && payloadError.status !== 500) return true
return false          // ← DomainError 落在这里
```

`DomainError` 既没有 `isPublic` 也没有 `status`，直接落到最后的 `return false`。

**结论：方案 A 仍然是对的修法**，而且比立项时以为的更值——它能覆盖
`afterError` 钩子够不到的批量路径；但影响面**不是** 135 处全部，只是走批量操作的那些。

## 3. 影响面

`src/domain/**` 里 **135 处** `throw new (InvalidOperationError | VersionConflictError |
ForbiddenError | NotFoundError)`，其中落在 `beforeChange` / `beforeDelete` /
`beforeValidate` 钩子里的分布在 **21 个文件**：

| 文件 | 处数 |
|---|---|
| `domain/geography/location-protect.ts` | 12 |
| `domain/workflow/task-protect.ts` | 11 |
| `domain/audit/audit-protect.ts` | 9 |
| `domain/report/report-protect.ts` | 9 |
| `domain/supply/building-merchant-relation-protect.ts` | 9 |
| `domain/supply/building-protect.ts` | 8 |
| `domain/workflow/workflow-protect.ts` | 7 |
| `domain/geography/business-area-extension-protect.ts` | 7 |
| `domain/supply/merchant-protect.ts` | 6 |
| …另外 12 个文件 | 各 1–5 |

**全仓搜 `isPublic` 零命中**（除 OPT-050 刚加的那处）。

## 4. 为什么 endpoint 不受影响

自定义 endpoint **自己 catch 并把 `err.message` 直接塞进响应**，例如
`building-operational-toggle-endpoint.ts`：

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : '权限不足'
  const status = message.includes('未登录') ? 401 : 403
  return Response.json({ ok: false, error: message }, { status })
}
```

而**钩子抛出的错误由 Payload 的错误处理器接管**，那里才有 `isPublic` 这道闸。
所以问题只在钩子路径上——但那恰恰是所有 `*-protect.ts` 的所在地。

## 5. 修法（需裁定）

### 方案 A：给 `DomainError` 加 `isPublic`（推荐）

在 `domain/shared/errors.ts` 的 `DomainError` 上加 `isPublic` 与 `status` 两个
公开属性，`isOperational: true` 的默认置 `isPublic: true`。

- **一处改动覆盖 135 处**，无需逐个文件改；
- 语义天然吻合：`isOperational` 的定义就是「业务可预期错误」，这类错误的文案
  本来就是写给用户看的；
- 风险：**必须逐条复核这些消息是否适合展示给用户**——有没有夹带内部 id、
  表名、SQL 片段之类。这是本方案的主要工作量，也是不能跳过的一步。

### 方案 B：逐处改用 Payload 的 `APIError`

OPT-050 就是这么做的。语义最直白，但 135 处逐个改，且引入了对 `payload` 包的
直接依赖——领域层此前是干净的（只 `import type`）。

### 方案 C：在 collection 层包一层错误转换钩子

保持领域层不变，在钩子外围把 `DomainError` 转成 `APIError`。避免了领域层依赖
Payload，但需要给每个 collection 都接上，容易漏。

**倾向 A**，但 §5 那条「逐条复核消息」必须真的做，不能只改基类就宣布完成。

## 5.5 实施记录（方案 A）

用户 2026-08-24 裁定方案 A。

**消息复核（§5 要求的那步，已做）**：导出 `src/domain` 下全部错误消息，
去重 **221 条**，逐类筛查——**无连接串、无密钥、无文件路径、无堆栈、
无原始错误对象拼接**。唯一命中「疑似内部标识」的 5 条是 `immutableCode`，
那是运营在后台真实看得到的业务字段（有专门的命名规范文档），不是实现细节。

**改动**：
- `DomainError` 加 `isPublic`（绑定 `isOperational`）与 `status`（默认 400）
- 五个子类补与 `payload-after-error.ts` 的 `STATUS_BY_CLASS` **同源**的状态码
- 收回 OPT-050 的 `APIError` 特例，统一走领域错误

**为什么绑 `isOperational` 而不是无条件 true**：`isOperational: false` 是系统异常，
message 可能来自底层库、含连接串与堆栈，必须继续隐藏——这正是 Payload 默认
行为的理由。

**浏览器实测**（两条路径都验，因为它们走的代码完全不同）：

| 路径 | 结果 |
|---|---|
| 批量删除（`deleteMany` 自己 catch，afterError 够不到） | HTTP 400，`isPublic: true`，文案完整 |
| 单条删除（走 `afterError` 钩子） | HTTP 422，文案完整 |

**守卫**：`tests/domain-error-public.test.ts` 24 条，其中一条复刻 Payload 的
`isErrorPublic` 判据、另一条断言「错误类的 status 与 afterError 钩子的映射一致」
——两处不同源就会漂。

## 6. 验收

- 随机抽 5 条不同 `*-protect.ts` 的规则，在**浏览器里**触发，确认运营看到的是
  真实文案而不是「Something went wrong.」；
- 加一条守卫：断言 `DomainError` 的实例带 `isPublic === true`
  （或所选方案的等价契约）；
- **不得回归**：`pnpm test` 全绿。

## 7. 坑

- **只跑测试发现不了这个问题。** 单测断言的是「抛了什么错」，而缺陷在于
  「错误怎么被序列化给客户端」——那一层在 Payload 内部，测试碰不到。
  OPT-050 就是这样：10 条单测全绿，浏览器一验就露馅。
  **验收必须在浏览器里做。**
- **别无差别地把所有错误设成 public。** `isOperational: false` 的系统异常
  （连库失败、空指针）消息里可能有连接串、堆栈、表结构，那些不能给用户看。
  这也是 Payload 默认隐藏的原因。
- 状态码同样重要：业务规则用 4xx，用 500 会进错误告警，且 Payload 对 500
  默认隐藏消息（`isPublic` 的缺省值就是 `status !== 500`）。

## 8. 相关

- OPT-050 §4.3「错误文案必须可操作」——本问题的发现现场
- `src/domain/shared/errors.ts` —— `DomainError` 基类
- `payload/dist/errors/APIError.js` —— `isPublic` 的契约
