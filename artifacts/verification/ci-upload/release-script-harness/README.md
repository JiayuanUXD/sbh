# `scripts/cloudrun-release.sh` 上传函数与 deploy.yml 对齐后的本地走查（2026-09-13）

病根与取证见上一级目录 `../README.md`（COS 单次 PUT 200s 上限 → `400 UserNetworkTooSlow`，
`--fail` 吞掉错误体）。本目录只证明 **本地发布脚本的 `upload_package()` 改成同一套逻辑后真的按设计跑**，
尤其是 `eval` 拼参数那段（自定义头、`--write-out`、`--output` 的引号在 eval 二次解析后是否还对）。

## 做法

不碰真 COS（本机 tcb 未登录）。`run.sh` 把脚本去掉末行 `main "$@"` 后 source 进来，桩掉 `tcb_api`
（返回指向本地假 COS 的 URL，带一个值含空格的自定义头，每次调用 `PackageVersion` 递增），
直接调 `upload_package`。`server.mjs` 是假 COS，按参数决定每次 PUT 的行为：

| 模式 | 行为 | 验的是 |
|---|---|---|
| `slow` | 真正的传输层背压：不进入 flowing，每 100ms 只从请求流取 1KB（≈10KB/s）；node 在 IncomingMessage 超过 highWaterMark 时 `readStop` 底层 socket，内核缓冲满后 curl 的 send 阻塞 | `--speed-limit "$need_bps" --speed-time 30`：30s 内断开，**只传了一部分** |
| `hang` | 收完整个请求体但永不响应 | curl 在「等响应」阶段照样按 `--speed-limit` 计速（速率 0），30s 断开，**轮不到 `--max-time`** |
| `bad` | 收完请求体回 `400` + COS 风格 XML（`<Code>UserNetworkTooSlow</Code>`） | 不带 `--fail` 时错误体落盘并打进日志 |
| `ok` | 收完请求体回 `200` | 成功路径、`$info` 与成功那次拉取一致 |

夹具参数：包 **64MB**（真包 2.6MB 会被 Windows 回环的内核缓冲整个吃掉，curl 的 `size_upload` 就是全量，
验不出背压——第一版夹具就栽在这，见下）；`COS_PUT_CAP` 压到 40s → `need_bps` = 1.6MB/s，slow 模式
必然达不到，且 `--max-time` 50s > `--speed-time` 30s，两条兜底可各自归因。本机没有 jq，`bin/` 里的
垫片只认脚本上传路径用到的三种调用；有 jq 的机器不会用到它。`run.sh` 末尾对 `slow*` 场景**断言**
第 1 次是「too slow」断开且 `size_upload` < 包体积，不满足退 2。

```bash
bash artifacts/verification/ci-upload/release-script-harness/run.sh slow,hang,bad,ok
```

## 结果

| 场景 | 日志 | 结论 |
|---|---|---|
| `slow,hang,bad,ok` | `scenario-slow-hang-bad-ok.log` | #1 slow：32.1s `Operation too slow. Less than 1600001 bytes/sec ... last 30 seconds`，`已传=4915200B`（**7%**，≈ Windows 回环缓冲容量），服务端以 ~9.4KB/s 消费；#2 hang：收完 64MB 不响应，36.1s 同样按 speed-limit 断开，`已传=全量`、http=100；#3 bad：http=400，XML 的 `<Code>/<Message>/<RequestId>` 原样打出；#4 ok：200，`上传完成（尝试 4）`，返回的 `$info` 是第 4 次拉取的（`PackageVersion=v4`），`tcb_api` 被调 4 次；断言通过 |
| `bad`（5 次全 400） | `scenario-bad.log` | 5 次各自换 URL 重试后 `die`，函数退 1，下游拿不到 `$info` |
| `ok` | `scenario-ok.log` | `上传完成（尝试 1）`，`v1` |

各场景里自定义头 `x-test: harness 1`（值带空格）都原样到达假 COS，URL 里的 `%26` / `%3D` 未被改写；
函数 stdout 只含 `$info` 路径，所有日志都在 stderr（`cmd_deploy` 用 `$(...)` 捕获 stdout，混进去会坏）。

## 两条在夹具里学到的事

1. **第一版 `slow` 没有造成背压**（Codex 审阅 PR #188 指出）：`socket.resume()` / `setImmediate(pause)`
   每秒一次挡不住回环上的突发读取，3MB 整个进了内核缓冲，`size_upload=3000000`，第 1 次失败其实是
   `--max-time` 到期——当时的日志和 README 说「等 curl 按 --speed-limit / --max-time 断开」，
   把两条兜底混在一起，没验到 `--speed-limit`。现在拆成 `slow`（背压）与 `hang`（不响应）两种，
   并在 `run.sh` 里断言部分上传。
2. **`--speed-limit` 在等响应阶段也计速**：服务端收完不响应时速率为 0，30s 就断，`--max-time` 只兜
   「速率忽高忽低、没有连续 30s 低于阈值、但总时长超了」的情况。deploy.yml 同一组 flag 的 max-time
   兜底证据在 `../harness-max-time-backstop.txt`。

另：文本守卫 `payload-office-platform/tests/production-deploy-config.test.ts`
「本地发布脚本的上传与 deploy.yml 同一套」对改前脚本红（卡在 `--fail`）、改后绿；`bash -n` 通过。
