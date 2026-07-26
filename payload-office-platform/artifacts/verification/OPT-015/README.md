# OPT-015 生产配置 fail-closed · 修复证据

> 关联审查：`docs/reviews/2026-07-26/production-readiness-audit.md` P0 第二项
> 完成标准：生产缺少 PostgreSQL、强密钥或合法站点 URL 时拒绝启动

## 审查发现

`src/payload.config.ts`：

- L65-66 `databaseUrl = process.env.DATABASE_URL || ''` + `usePostgres = databaseUrl.startsWith('postgres')`：缺 `DATABASE_URL` 时静默降级到本地 SQLite 临时文件。
- L182 `secret: process.env.PAYLOAD_SECRET || 'local-dev-secret-change-me'`：缺密钥时使用公开可预测的固定字符串。
- 缺 `NEXT_PUBLIC_SITE_URL` 不阻断。

CloudRun 中这种配置错误表现为“服务健康但使用实例本地临时数据 + 公开可预测密钥”。生产模式必须 fail-closed。

## 修复内容

### 1. 新增纯函数守卫（`src/lib/runtime/config-guard.ts`）

| 导出 | 作用 |
| --- | --- |
| `validateProductionConfig(env)` | 返回违例列表（空=通过）。非 production 直接返回空 |
| `assertProductionConfig(env)` | 违例时抛错，错误信息列出所有违例字段 |

校验规则（仅 `NODE_ENV=production` 生效）：

| 字段 | 规则 |
| --- | --- |
| `DATABASE_URL` | 必须存在且以 `postgres` 开头（禁止 SQLite 降级） |
| `PAYLOAD_SECRET` | 必须存在；非已知弱默认值；长度 >= 32 字符 |
| `NEXT_PUBLIC_SITE_URL` | 必须存在；合法 URL；`https:` 协议；非 localhost/127.0.0.1 |

弱密钥黑名单：`local-dev-secret-change-me`、`change-me`、`secret`、`payload-secret`、`your-secret-key`。

### 2. 挂载到 payload.config.ts 的 onInit（`src/payload.config.ts`）

```ts
onInit: () => {
  assertProductionConfig(process.env)
},
```

挂载点选择依据：

| 阶段 | 是否触发 onInit | 行为 |
| --- | --- | --- |
| 容器 `payload migrate` | 是（getPayload） | 生产 env 缺失 -> 抛错 -> migrate 失败 -> CMD 失败 -> 容器崩溃 -> 不切流量 |
| `next start` 首请求 | 是（getPayload） | 同上，运行时缺失也拒绝 |
| `next build` / `generate:types` | 否（不 getPayload） | 构建期无运行 env 也不阻断（Dockerfile builder stage 不设 NODE_ENV=production） |
| 本地 `next dev` | 是，但 NODE_ENV=development | 守卫跳过，允许 SQLite + 默认密钥 |

> Dockerfile builder stage（L26）跑 `generate:types && generate:importmap && build`，不设 NODE_ENV=production，且 generate:types 不连库；runner stage（L33）才 `ENV NODE_ENV=production`。onInit 仅在 runner 的 `payload migrate` / `next start` 触发，与构建期隔离。

## 验证

### 单元测试

```
pnpm exec vitest run tests/config-guard.test.ts
```

16 项通过，覆盖：

- dev/test 环境不阻断（env 全空也不抛错）
- 生产 DATABASE_URL 缺失 / 非 postgres / 合法 三场景
- 生产 PAYLOAD_SECRET 缺失 / 长度不足 / 弱默认值 / 合法强密钥 四场景
- 生产 NEXT_PUBLIC_SITE_URL 缺失 / 非 https / localhost / 非法 URL / 合法 五场景
- assertProductionConfig 整体：合法不抛错；多项缺失抛错且信息含全部违例字段；缺 DATABASE_URL 抛错

### 全量回归

```
pnpm test  # 100 文件、1932 项通过
pnpm typecheck  # exit 0
```

onInit 挂载未破坏现有测试（vitest NODE_ENV=test，守卫跳过）。

## 完成标准对照

| 标准 | 证据 |
| --- | --- |
| 生产缺少 PostgreSQL 时拒绝启动 | `DATABASE_URL` 缺失/非 postgres -> throw；`config-guard.test.ts` |
| 生产缺少强密钥时拒绝启动 | `PAYLOAD_SECRET` 缺失/短/弱 -> throw；`config-guard.test.ts` |
| 生产缺少合法站点 URL 时拒绝启动 | `NEXT_PUBLIC_SITE_URL` 缺失/非 https/localhost/非法 -> throw；`config-guard.test.ts` |

## 运行时 fail-closed 路径

生产 env 缺失 -> 容器启动 `pnpm exec payload migrate` -> getPayload -> onInit -> `assertProductionConfig` 抛错 -> migrate 退出非 0 -> `CMD` `&&` 短路 -> 容器崩溃 -> CloudRun 健康检查失败 -> 不切流量。fail-closed 达成。
