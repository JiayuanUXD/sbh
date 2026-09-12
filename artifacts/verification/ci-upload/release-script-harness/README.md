# `scripts/cloudrun-release.sh` 上传函数与 deploy.yml 对齐后的本地走查（2026-09-13）

病根与取证见上一级目录 `../README.md`（COS 单次 PUT 200s 上限 → `400 UserNetworkTooSlow`，
`--fail` 吞掉错误体）。本目录只证明 **本地发布脚本的 `upload_package()` 改成同一套逻辑后真的按设计跑**，
尤其是 `eval` 拼参数那段（自定义头、`--write-out`、`--output` 的引号在 eval 二次解析后是否还对）。

## 做法

不碰真 COS（本机 tcb 未登录）。`run.sh` 把脚本去掉末行 `main "$@"` 后 source 进来，桩掉 `tcb_api`
（返回指向本地假 COS 的 URL，带一个值含空格的自定义头，每次调用 `PackageVersion` 递增），
直接调 `upload_package`。`server.mjs` 是假 COS，按参数决定每次 PUT 的行为：

| 模式 | 行为 |
|---|---|
| `slow` | 每秒只放行一小片，等 curl 自己按 `--speed-limit` / `--max-time` 断开 |
| `bad` | 收完请求体回 `400` + COS 风格 XML（`<Code>UserNetworkTooSlow</Code>`） |
| `ok` | 收完请求体回 `200` |

夹具把 `COS_PUT_CAP` 压到 2s（need_bps = 1.5MB/s），slow 模式必然达不到。本机没有 jq，`bin/` 里的
垫片只认脚本上传路径用到的三种调用；有 jq 的机器不会用到它。

```bash
bash artifacts/verification/ci-upload/release-script-harness/run.sh slow,bad,ok
```

## 结果

| 场景 | 日志 | 结论 |
|---|---|---|
| `slow,bad,ok` | `scenario-slow-bad-ok.log` | 第 1 次 curl exit=28 / http=100（被上限断开，`stats` 兜底解析正常）；第 2 次 http=400，XML 的 `<Code>/<Message>/<RequestId>` 原样打出；第 3 次 200，`上传完成（尝试 3）`，返回的 `$info` 是第 3 次拉取的那份（`PackageVersion=v3`），`tcb_api` 被调 3 次 |
| `bad`（5 次全 400） | `scenario-bad.log` | 5 次各自换 URL 重试后 `die`，函数退 1，下游拿不到 `$info` |
| `ok` | `scenario-ok.log` | `上传完成（尝试 1）`，`v1` |

三个场景里自定义头 `x-test: harness 1`（值带空格）都原样到达假 COS，URL 里的 `%26` / `%3D` 未被改写；
函数 stdout 只含 `$info` 路径，所有日志都在 stderr（`cmd_deploy` 用 `$(...)` 捕获 stdout，混进去会坏）。

另：文本守卫 `payload-office-platform/tests/production-deploy-config.test.ts`
「本地发布脚本的上传与 deploy.yml 同一套」对改前脚本红（卡在 `--fail`）、改后绿；`bash -n` 通过。
