# 本机生产模式守卫：实机验证

被测：`payload-office-platform/src/lib/runtime/local-production-env-guard.ts`，挂在 `src/payload.config.ts` 顶层
（提交 `32db55e5`）。起因：2026-10-15 OPT-114 在主工作树起 `next start`，读到 `.env.production.local` 连上了生产库。

## 怎么验的

不碰任何真实数据库。`fake-pg-listener.py` 在一个地址上监听，只记录「有没有进程来连」；`DATABASE_URL` 指向它，
`next start` 后请求 `/api/health` 与 `/`，看监听器有没有被连。脚本 `verify-guard.sh` 会在应用目录里临时放 / 删
env 文件，**绝不要对主工作树运行**（脚本发现目录里已有 `.env*` 本地文件会拒绝执行）。

```bash
cd payload-office-platform
CI=1 PAYLOAD_SECRET=<任意 32 位以上> NEXT_PUBLIC_SITE_URL=https://verify.example.test MULTI_CITY_ROUTING_ENABLED=false pnpm build
cd .. && bash artifacts/verification/local-prod-env-guard/verify-guard.sh payload-office-platform artifacts/verification/local-prod-env-guard/out
```

## 结果（`out/summary.txt`，2026-10-15 17:35 +08）

| 场景 | 形态 | 守卫报错 | 假库被连 | HTTP |
| --- | --- | --- | --- | --- |
| A | 主工作树：`.env.production.local` + 非环回库主机 | 4 行 | **0 次** | 500 / 500 |
| B | 对照组：同 A，加 `ALLOW_LOCAL_PRODUCTION_ENV=1` | 0 | 3 次 | 503 / 500 |
| C | 干净 worktree：`.env.local` + `127.0.0.1` | 0 | 3 次 | 503 / 500 |
| D | 线上容器：没有任何 env 文件，库主机非环回（进程环境变量） | 0 | 3 次 | 503 / 500 |
| E | 带着 A 的 `.env.production.local` 跑 `next build` | 0 | — | 退出码 0 |

- A 的 0 次连接是守卫拦下的，不是别的原因：B 只多了放行开关，同一个监听器就被连了 3 次。
- B / C / D 的 503 / 500 是假库收到连接即断开（`ECONNRESET`）所致，与守卫无关；要看的是「连了」。
- A 中 server 照常打出 `Ready`，守卫在第一个用到 Payload 的请求时抛错，此后每个请求都 500 并重复打印同一报错
  （脚本的就绪探测本身也是请求，所以报错行数多于表里的两次 HTTP）。不连库也就不会起 jobs autoRun。
- E 的构建日志第 2 行是 `Environments: .env.production.local`，证明文件确实被读到，NEXT_PHASE 跳过生效。
- `summary.txt` 第一行记的是 `HEAD 6777dec2 + src 有未提交改动`（先跑后提交）；其下两行 blob 哈希
  `4a7258d5…`（守卫）/ `13a2feaa…`（payload.config.ts）与提交 `32db55e5` 中的文件逐一相同，可用
  `git rev-parse 32db55e5:payload-office-platform/src/lib/runtime/local-production-env-guard.ts` 对账。
