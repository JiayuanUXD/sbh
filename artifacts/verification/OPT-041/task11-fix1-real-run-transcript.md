# OPT-041 Task 11 修复第 1 轮：D11 real next-start 实跑证据

环境：`next build && CI=1 NEXT_PUBLIC_SITE_URL=https://sbh-opt041-verify.local PORT=3718 pnpm start`
（DATABASE_URL 取自 .env.local，指向 sbh_dev_opt041；CI=1 绕过生产 COS 强制要求，
https 非 localhost 的 NEXT_PUBLIC_SITE_URL 满足 config-guard，二者均不改变 D10/D11
本身的代码路径，只是让 `next start` 能在本地通过 fail-closed 生产配置守卫启动）。

服务器完整日志：`task11-fix1-next-start-server.log`（全程 grep
`public-cache-revalidation` 零命中，见文末）。

## 1. 登录

```
$ curl -s -c cookies.txt -X POST http://localhost:3718/api/users/login \
    -H "Content-Type: application/json" \
    -d '{"email":"e2e-adm@example.com","password":"Test1234!"}'
HTTP 200，e2e-adm（ADM 角色，与 tests/e2e/bulk-import.spec.ts 用的同一账号）
```

## 2. 预检（D10 验证）

```
$ curl -s -b cookies.txt -X POST "http://localhost:3718/api/bulk-import/preflight?type=listings" \
    -F "file=@opt041-d11-verify.xlsx"
{"ok":true,"batchId":57,"report":{"rowCount":1,"validCount":1,"errorCount":0,"rowErrors":[]}}
HTTP 200
```
一行房源引用楼盘 `west-nanjing-premium-center`（真实种子楼盘，city=1 上海），
`validCount:1/errorCount:0`——D10 商户解析在预检层通过（该楼盘已有当前生效且合格的
商户关系，#1，验证脚本查库确认，未新建）。

## 3. 执行

```
$ curl -s -b cookies.txt -X POST "http://localhost:3718/api/bulk-import/batches/57/execute"
{"ok":true,"batchId":57,"status":"queued"}
HTTP 200
```

## 4. 轮询（D11 触发点）

```
$ curl -s -b cookies.txt "http://localhost:3718/api/bulk-import/batches/57"
{"ok":true,"batch":{"id":57,"type":"listings","status":"completed","fileName":"opt041-d11-verify.xlsx",
 "rowCount":1,"validCount":1,"errorCount":0,
 "stats":{"processed":1,"created":1,"updated":0,"failed":0},
 "startedAt":"2026-08-22T04:59:57.022Z","finishedAt":"2026-08-22T05:00:00.382Z", ...}}
HTTP 200
```
第一次轮询即观察到 `completed`（Jobs Queue cron 每 10s 一轮，入队后很快被领取）。
直接查批次文档确认 `affectedIds:[157]`、`validRows[0].cityId:1`——本次修复要触发的
条件（终态 + affectedIds 非空）成立。

## 5. 前台立即可见（核心断言）

```
$ curl -s "http://localhost:3718/listings/opt-041-d11-zhen-shi-yan-zheng-fang-yuan-opt041-d11-verify-1787374770"
HTTP 307 → Location: /shanghai/listings/opt-041-d11-zhen-shi-yan-zheng-fang-yuan-opt041-d11-verify-1787374770

$ curl -s "http://localhost:3718/shanghai/listings/opt-041-d11-zhen-shi-yan-zheng-fang-yuan-opt041-d11-verify-1787374770"
HTTP 200，页面 <title> 与正文含「OPT-041 D11 真实验证房源 OPT041-D11-VERIFY-1787374770」
```
**紧接在上一步轮询之后**（同一秒级窗口内，没有任何等待/sleep），前台详情页直接
200 并渲染出新导入的房源——不是靠 cached-queries.ts 的 5 分钟 TTL 自然过期后才可见。

## 6. 回滚侧对照（未改动，验证仍然有效）

```
$ curl -s -b cookies.txt -X POST "http://localhost:3718/api/bulk-import/batches/57/rollback"
{"ok":true,"batchId":57,"unpublished":1,"skipped":0,"failed":0}
HTTP 200

$ curl -s "http://localhost:3718/shanghai/listings/opt-041-d11-zhen-shi-yan-zheng-fang-yuan-opt041-d11-verify-1787374770"
HTTP 404（紧接在 rollback 之后，同样没有等待）
```

## 7. 日志核验

```
$ grep -c "public-cache-revalidation" task11-fix1-next-start-server.log
0
```
全程服务器日志（build 完成到测试结束）里 `[public-cache-revalidation] failed`
**零命中**——之前 import-task.ts 里 Job handler 直接调用会在非请求上下文抛错并被
吞成这条日志；现在挪到 GET /batches/:id（真实请求上下文）之后，同一条链路真实跑
下来没有触发任何一次失效失败。
