# CI 代码包上传间歇 400 —— 根因取证（2026-09-12）

## 现象

`deploy.yml` 的「上传代码包并提交灰度版本」步骤，`curl --upload-file` 到
`DescribeCloudBaseBuildService` 返回的预签名 URL，传 3.5–4 分钟后 `curl: (22) 400`，
4 次重试（每次换新 URL）全部一样，共 16 分钟；rerun 后成功。

| run | attempt | 包体积 | 各次上传用时 | 均速 | 结果 |
|---|---|---|---|---|---|
| 34699498622 | 1 | 2633089 | 228s / 208s / 249s / 211s | 10.6–12.6 KB/s | 4 次全 400 |
| 34699498622 | 2（rerun） | 2633089 | 183s | 14.4 KB/s | 200 |
| 34702931927 | 1 | 2639940 | 227s / 205s / 206s / 233s | 11.3–12.8 KB/s | 4 次全 400 |
| 34702931927 | 2（rerun） | 2639940 | 167s | 15.8 KB/s | 200 |
| 34691438869 | 1 | 2631790 | 103s | 25.5 KB/s | 200 |
| 34615442373 | 1 | 2619726 | 212s / 205s / **196s** | 12.1 / 12.5 / 13.0 KB/s | 400 / 400 / **200** |
| 34574528849 | 1 | 2551067 | 209s / 167s | 11.9 / 15.7 KB/s | 400 / 200 |
| 34542445647 | 1 | 2546702 | 3s | 723 KB/s | 200 |

用时从各次 `- Loading data...`（`tcb api` 开始）到 `curl:` / `上传成功` 行，含 ~2s API 往返。
CI 侧看得到的分界：**196s 过，205s 挂**。

## 排除项（都有证据）

- **预签名 URL 过期**：`DescribeCloudBaseBuildService` 返回的 URL 带
  `q-sign-time=1789229005;1789833805`、`q-key-time` 同值，窗口 **604800s = 7 天**。
  复现时同一个 URL 反复用了 40 多分钟仍能 200。`deploy.yml` 原注释里「有效窗口短」的归因不成立。
- **签名 / 鉴权**：复现的响应头里先有 `HTTP/1.1 100 Continue` 再传体，鉴权在请求头阶段就过了。
- **换 `tcb cloudrun deploy`**：`@cloudbase/cli` 的 `uploadZip` 就是对同一个 `UploadUrl`
  做一次 `fetch` PUT（`dist/standalone/cli.js` 49045 行起），无重试、无超时。同一通道。
- **全球加速入口**：上传域名 `cloudbaserun-code-cos.cloudbase.net` CNAME 到
  `cloudaccess-run-rp-1258016615.cos.ap-shanghai.myqcloud.com`（CloudBase 自己的桶）；
  `cloudaccess-run-rp-1258016615.cos.accelerate.myqcloud.com` 回 `400 BucketAccelerateNotEnabled`。
- **压缩更狠**：`git archive -9` 只省 6.6KB（0.25%）。包里 93% 是 `.ts/.tsx/.css` 源码，没有可砍的大头。

## 复现（本地，对真实预签名 URL 限速）

拿一个真实的 `UploadUrl`（MCP `callCloudApi tcb/DescribeCloudBaseBuildService`），
用 `--limit-rate` 把同一个 2633089 字节的随机文件拖到不同时长，**不带 `--fail`**、响应体落盘：

| 探针 | 体积 | `--limit-rate` | `time_total` | HTTP | `<Code>` |
|---|---|---|---|---|---|
| A | 307200 | 10k | 30.1s | 200 | — |
| C | 2633089 | 14k | 183.2s | 200 | — |
| B | 2633089 | 13k | 197.1s | 200 | — |
| E | 2633089 | 13232 | 198.2s | 200 | — |
| F | 2633089 | 13100 | **200.1s** | **200** | — |
| G | 2633089 | 12971 | **202.1s** | **400** | UserNetworkTooSlow |
| H | 2633089 | 12720 | 207.2s | 400 | UserNetworkTooSlow |
| D | 2633089 | 12k | 214.1s | 400 | UserNetworkTooSlow |
| 首次 | 2633089 | 10k | 257.2s | 400 | UserNetworkTooSlow |

结论：

1. **COS 对单次 PUT 有 200s 时长上限**：200.1s 过、202.1s 起一律 400。
2. 判的是**时长不是速率**：A 用 10KB/s 传 30s 照样 200。
3. 400 是在**收完整个请求体后**才回的（每次 `size_upload` 都等于全长），所以 CI 里
   `--speed-limit 1024`（只防死连接）抓不到——链路一直在传，只是慢。
4. 原 curl 带 `--fail`，把这个 XML 错误体丢了，日志只剩 `curl: (22) 400`。

原始数据：`probes-raw.txt`；首次复现的完整响应头/体：`cos-400-headers-10kbps-257s.txt` /
`cos-400-body-10kbps-257s.xml`；探针脚本：`probe.sh`。

## 修复后的上传循环本地演练

把 `deploy.yml` 上传循环原样抠出来（只桩掉 `jq` / `fetch_upload_info`），对真实 URL 跑：

- `harness-speed-limit-cut.txt`：用 `curl() { command curl --limit-rate 12k "$@"; }` 模拟 12KB/s 链路，
  `--speed-limit $need_bps`（13199 B/s）在 **30s** 内断掉、`http=100`（只收到 100 Continue）、换 URL 重试，
  不再陪跑到 400。
- `harness-max-time-backstop.txt`：把 `need_bps` 压到 1024 让速率检查失效，12KB/s 链路在
  `--max-time 210` 处被兜底截断（已传 2580480/2639728）。
- `harness-cos-400-body.txt`：12877 B/s → 205s，落在 200–210s 窗口内，COS 的 400 XML 体被原样打进日志。
- 不限速：2639728 字节 0.55s 传完，`上传成功（尝试 1）`。

## 修复内容

`.github/workflows/deploy.yml` 上传步骤：

- 去掉 `--fail`；`--output` 落盘响应体、`--write-out '%{http_code} %{time_total} %{size_upload} %{speed_upload}'`
  自己判状态；非 200 把 XML 体 `cat` 进日志。
- `COS_PUT_CAP=200`，`--max-time $(( COS_PUT_CAP + 10 ))`：上限内传不完的由 COS 回 400（留证据），curl 只兜底。
- `need_bps=$(( archive_bytes / COS_PUT_CAP + 1 ))`，`--speed-limit "$need_bps" --speed-time 30`：
  达不到必要速率的连接 30s 内断掉换新 URL。
- 尝试次数 4 → 5，失败提示直接指向「rerun 换机器」。

守卫：`payload-office-platform/tests/production-deploy-config.test.ts`「上传步骤 / COS 单次 PUT 200s 上限」
（对旧 workflow 4 条红，对新 workflow 全绿）。

## CI 实跑验证（workflow_dispatch，promote 不勾）

分支 `ci/deploy-upload-cos-time-cap-73e8`，run 34705732117（`ci-run-34705732117-upload.log`）：

| 尝试 | 结果 | 用时 | 已传 | 均速 |
|---|---|---|---|---|
| 1 | `curl exit=28 http=100`（--speed-limit 断掉） | 166s | 2031616 / 2639940 B | 12226 B/s（需 13200） |
| 2 | **200** | 145s | 2639940 B | 18212 B/s |

- 尝试 1 这条连接平均 12.2KB/s，按老逻辑会陪跑到 ~216s 然后收 400；现在被速率门断掉。
  断在 166s 而不是 30s，因为 curl 的判定是「瞬时速率**连续** 30s 低于阈值」——这条链路在阈值附近抖动，
  偶尔冒头就把计数清零。这是有意偏向「不误杀刚好过线的连接」，代价是抖动型慢链路要多陪一会。
- 尝试 2 换新 URL / 新连接后 18.2KB/s，145s 传完——同一台 runner 相邻两次连接差 50%，
  「多试几次能碰到过线的」这一假设成立。
- 后续：GRAY 版本 `sbh-186` 构建到 `normal`，`FlowRatio 0`；切流 / 冒烟 / promote 全部 skipped，
  线上仍是 `sbh-185`（100%）。
