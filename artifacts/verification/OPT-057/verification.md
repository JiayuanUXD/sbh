# OPT-057 出售频道功能开关移除 — 验证证据

日期：2026-08-27 · 分支 `refactor/sale-channel-flag-removal-0afe` · 本地 dev(3717) 浏览器实测

## 如何复现（脚本随证据提交，证据不自证）

```bash
# 前提：被测服务必须在环境里**没有** NEXT_PUBLIC_SALE_CHANNEL_ENABLED 的情况下启动
ALLOW_MUTATE=1 node artifacts/verification/OPT-057/verify-sale-channel-always-on.mjs http://localhost:3717 > artifacts/verification/OPT-057/verify.output.json
```

- 脚本：`verify-sale-channel-always-on.mjs`；本次输出：`verify.output.json`（`verdict.pass: true`）。
- 脚本**先自证前提**（`premise.flagInProcessEnv` 必须为 null），前提不成立直接非 0 退出——
  否则「功能可用」可能只是因为变量还在，结论无意义。
- `ALLOW_MUTATE=1` 那段夹具会把一条房源临时改成 `sale` 验字段组、随后在 `finally` 里还原，
  输出中 `mutationProbe.restored` 记录还原结果（本次 `true`，listing 56：lease → sale → lease）。
- 下文所有实测数字均来自该 JSON，不是手抄。

**另有两类证据是自动化的、每次 CI 都会重跑**：
- `tests/sale-channel-always-on.test.ts`（26 条源码级契约，防开关回流）；
- `tests/e2e/sale-channel.spec.ts` —— 本 PR 已从 `quality.yml` 删掉该变量，
  所以 CI 的 e2e 现在跑在**无开关**环境下并断言两条出售路由 200，
  等价于在 CI 里持续复现本文第 1 节的核心结论。

## 0. 前置事实核对（改动前，线上实测）

```
CloudRun sbh 服务 EnvParams（MCP 拉取）：
  DATABASE_URL / PAYLOAD_SECRET / NODE_ENV / COS_* / AMAP_WEB_SERVICE_KEY /
  PAYLOAD_DISABLE_JOB_AUTORUN / MULTI_CITY_ROUTING_ENABLED
  → 不含 NEXT_PUBLIC_SALE_CHANNEL_ENABLED
Dockerfile：builder 与 runner 两个阶段各有一处 ENV ...=true
线上 https://<domain>/shanghai/sale → 200（关闭时为 notFound）
```

结论：开关是**启用**语义（不设即关闭），且线上已开；它烤在镜像里，不在服务级变量里。
「删掉这个变量」会关闭功能，与用户诉求相反——真实诉求是让功能永久常开、开关退休。

## 1. 关键验证：无该环境变量时功能依然可用

本地 `.env.local` 原本设了 `NEXT_PUBLIC_SALE_CHANNEL_ENABLED=true`，会掩盖差异，
故**先把它删掉**（改动后它已是死配置）再重启 dev server 验证：

| 检查 | 结果 |
|---|---|
| `/shanghai/sale` | **200** ✓（关键证明：无变量仍可用） |
| `/sale` | 307 → 重定向到默认城市（多城市路由行为，符合预期） |
| `/sitemap.xml` | 200；无出售条目 ✓ —— 库里出售房源 `totalDocs=0`，`shouldListSaleChannelInSitemap` 阈值 >0，**属正确行为而非回归** |

## 2. 后台字段（创建页，e2e-adm）

| 检查 | 结果 |
|---|---|
| 租售类型 `field-businessType` | 存在 ✓（开关移除后恒显示，不再带 condition） |
| 价格分节标题 | 「价格与交易参数」✓（不再回退成「租赁参数」） |
| 非出售房源的 `field-saleTerms` | 不显示 ✓（按 businessType 分流仍在） |

按 businessType 分流的正向验证（把本地 listing 56 临时改为 `sale`）：

```
PATCH /api/listings/56 {businessType:'sale'} → 200, businessType: lease→sale
编辑页：{"businessType":"出售","hasSaleTerms":true,
        "sections":[...,"空间明细","出售信息","费用条款",...]}
→ 「出售信息」字段组正常出现 ✓
随后已还原为 lease（PATCH 200）
```

## 3. 质量门（quality.yml 同序）

- `pnpm generate:types` + `generate:importmap` ✓（`grep -c prefix` = 2）
- `pnpm typecheck` ✓ 0 错
- `pnpm lint` ✓ 0 error / 23 处历史 warning
- `pnpm test` ✓ **3843 passed**（新增 26 条常开契约断言）
- `pnpm migrate:dry-run` ✓ 0 阻断（4 警告均为历史迁移既有）
- `pnpm exec payload migrate:create` → **No schema changes detected**（无迁移）
- `pnpm build` ✓

## 4. 新契约测试抓到的真问题

`tests/sale-channel-always-on.test.ts` 首轮红灯，暴露两点，均已修：

1. 我最初的断言 `not.toContain("title: '页面未找到'")` 写得过宽——城市页里
   `if (!city) return { title: '页面未找到' }` 是**合法的真 404**（访问不存在的城市），
   不是功能开关。断言改为锚定判定条件是 `!city`，把「为什么这个 404 要留着」写进契约。
2. 该处上方有一句注释「功能开关关闭时与页面不存在表现一致」，在开关删除后已过期，
   一并订正为「城市不存在时按页面不存在处理」。

## 5. 残留与去向

- `src/collections/Listings.ts` 保留一句提及旧变量名的**沿革注释**（说明为何这里只剩
  businessType 分流）。契约测试刻意断言「函数与 env 读取」而非字符串出现，
  就是为了不把这类有价值的历史逼掉。
- `specs/work-items/OPT-045-*.md` 与 `.superpowers/` 下的历史报告提及该变量，属当时的
  事实记录，不改。
- 本地 `.env.local` 的该行与其上方 OPT-045 注释已删（死配置，且该文件不进 git）。
