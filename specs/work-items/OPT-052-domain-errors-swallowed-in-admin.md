# Task Packet：OPT-052 钩子抛出的领域错误在后台一律显示为「Something went wrong.」

> 状态：**待实施**
> 创建日期：2026-08-24
> 来源：OPT-050 的本地浏览器验证——守卫拦住了，但运营看不到原因
> 编号说明：OPT-051 是删除权限，故取 052

---

## 1. 一句话

Payload 只把 `isPublic === true` 的错误消息交给客户端，其余一律替换成
「Something went wrong.」。而项目自己的 `DomainError` 继承原生 `Error`，
**没有这个标记**——于是 21 个 `*-protect.ts` 里精心写的 100+ 条中文提示，
运营一条都看不到。

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
