# 本机生产模式守卫：实机验证

被测：`payload-office-platform/src/lib/runtime/local-production-env-guard.ts`，挂在 `src/payload.config.ts` 顶层
（首版提交 `32db55e5`；PR #222 评审后改为同时查应用目录与 cwd，见下）。起因：2026-10-15 OPT-114 在主工作树起
`next start`，读到 `.env.production.local` 连上了生产库。

## 怎么验的

不碰任何真实数据库。`fake-pg-listener.py` 在一个地址上监听，只记录「有没有进程来连」；`DATABASE_URL` 指向它，
`next start` 后请求 `/api/health` 与 `/`，看监听器有没有被连。脚本 `verify-guard.sh` 会在应用目录里临时放 / 删
env 文件，**绝不要对主工作树运行**（脚本发现目录里已有 `.env*` 本地文件会拒绝执行）。

```bash
cd payload-office-platform
CI=1 PAYLOAD_SECRET=<任意 32 位以上> NEXT_PUBLIC_SITE_URL=https://verify.example.test MULTI_CITY_ROUTING_ENABLED=false pnpm build
cd .. && bash artifacts/verification/local-prod-env-guard/verify-guard.sh payload-office-platform artifacts/verification/local-prod-env-guard/out
```

## 结果（`out/summary.txt`）

| 场景 | 形态 | 守卫报错 | 假库被连 | HTTP |
| --- | --- | --- | --- | --- |
| A | 主工作树：`.env.production.local` + 非环回库主机 | 有 | **0 次** | 500 / 500 |
| B | 对照组：同 A，加 `ALLOW_LOCAL_PRODUCTION_ENV=1` | 无 | 3 次 | 503 / 500 |
| C | 干净 worktree：`.env.local` + `127.0.0.1` | 无 | 3 次 | 503 / 500 |
| D | 线上容器：没有任何 env 文件，库主机非环回（进程环境变量） | 无 | 3 次 | 503 / 500 |
| E | 带着 A 的 `.env.production.local` 跑 `next build` | 无 | — | 退出码 0 |
| F | 从上一级目录 `next start payload-office-platform`，其余同 A | — | — | 000：server 未就绪，无结论 |

- A 的 0 次连接是守卫拦下的，不是别的原因：B 只多了放行开关，同一个监听器就被连了 3 次。
- B / C / D 的 503 / 500 是假库收到连接即断开（`ECONNRESET`）所致，与守卫无关；要看的是「连了」。
- A 中 server 照常打出 `Ready`，守卫在第一个用到 Payload 的请求时抛错，此后每个请求都 500 并重复打印同一报错
  （脚本的就绪探测本身也是请求，所以报错行数多于表里的两次 HTTP）。不连库也就不会起 jobs autoRun。
  报错里「检测到」的是应用目录的绝对路径且只出现一次——应用目录与 cwd 相同时去重生效，运行时路径解析也指对了地方。
- E 的构建日志第 2 行是 `Environments: .env.production.local`，证明文件确实被读到，NEXT_PHASE 跳过生效。
- `summary.txt` 头部记的是 HEAD、`src` 是否有未提交改动，以及守卫与 payload.config.ts 的 blob 哈希，
  可用 `git rev-parse <提交>:payload-office-platform/src/lib/runtime/local-production-env-guard.ts` 对账。

## PR #222 评审：`next start <目录>` 从别处起时只看 cwd 会漏拦

评审指出 Next 从 `next start <目录>` 的目录读 env 文件，而首版守卫只查 `process.cwd()`。已改为同时查两处：

- **应用目录**：守卫模块用自己的 `import.meta.url` 往上三级求出（`APP_DIR`）。Turbopack 产物里它被编译成
  `file://${e.P("src/lib/runtime/local-production-env-guard.ts")}`，`e.P` 是 `[turbopack]_runtime.js` 的
  `resolveAbsolutePath`，按 chunk 所在位置在运行时算出项目根，所以指向的是 Next 实际读 env 的目录，与 cwd 无关。
- **cwd**：payload CLI 按 cwd 读 env，这一处保留。

F 场景在本仓库**目前不可达**：`next.config.ts` 有相对 TS import（`./src/lib/build-info`），cwd 不在应用目录时 Next
加载配置失败（`Cannot find module './src/lib/build-info'`），server 根本起不来。`out-review-f-unfixed-build/` 是在
**未修复**构建上跑的同一场景，结果相同——说明首版在当前仓库里并没有实际漏洞，这次修复是不依赖 next.config 写法的
纵深防御。目录解析由单测覆盖（`tests/local-production-env-guard.test.ts` 的 `listPresentEnvFiles` 与 `APP_DIR`）；
F 留在脚本里，哪天 next.config 不再依赖 cwd，它就自动变成有效的实机用例。
