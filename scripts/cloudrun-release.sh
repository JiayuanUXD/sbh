#!/usr/bin/env bash
#
# CloudBase CloudRun 本地发布脚本
#
# 存在的理由：GitHub 托管 Runner 上传代码包到 CloudBase 会 180 秒超时且 0 字节
# （2026-07-27 实测：连续 5 次重试全部超时），同一个包从本地网络 2.4 秒传完。
# 在 CI 上传通道修好之前，生产发布走这个脚本。
#
# 用法：
#   ./scripts/cloudrun-release.sh status          查看服务状态与流量分配
#   ./scripts/cloudrun-release.sh deploy          打包上传并创建灰度版本（0% 流量），等到 normal
#   ./scripts/cloudrun-release.sh canary 10       把 10% 流量切给灰度版本
#   ./scripts/cloudrun-release.sh smoke           冒烟检查（/api/health + 页面可达性）
#   ./scripts/cloudrun-release.sh promote         全量发布（灰度版本吃 100% 流量）
#   ./scripts/cloudrun-release.sh rollback        回滚流量到稳定版本
#   ./scripts/cloudrun-release.sh release         完整流程：deploy → canary 10 → smoke → promote → 验证
#
# 前置：tcb CLI 已登录（tcb login），本机能访问腾讯云。
#
set -eo pipefail
# 刻意不用 set -u：macOS 自带 bash 3.2 下空数组展开 ${arr[@]} 会直接报错。

ENV_ID="${TCB_ENV_ID:-sbh-d9gnr8h5ef7e22e30}"
SERVICE="${TCB_SERVICE:-sbh}"
APP_DIR="${TCB_APP_DIR:-payload-office-platform}"
SITE_URL="${TCB_SERVICE_URL:-https://sbh-286300-10-1253925058.sh.run.tcloudbase.com}"

# COS 对单次 PUT 的时长上限（秒）：实测 200.1s 的传输 200，202.1s 起一律
# 400 UserNetworkTooSlow，与体积、速率本身无关（300KB 用 10KB/s 传 30s 照样 200）。
# 与 .github/workflows/deploy.yml 同值，证据见 artifacts/verification/ci-upload/README.md。
COS_PUT_CAP=200

# 非交互模式：让 CLI 的确认提示自动走默认值，否则无 tty 时会以 exit 130 中断
export CLOUDBASE_CI=1

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log()  { printf '\033[36m>>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# tcb CLI 会在 stdout 混入 "- 数据加载中..." 之类的 spinner，必须从第一个 { 开始截取
tcb_api() {
  local service="$1" action="$2" api_version="$3" body="$4" out
  out="$(tcb api "$service" "$action" --api-version "$api_version" --json --body "$body" 2>/dev/null | sed -n '/^{/,$p')"
  if [ -z "$out" ]; then
    die "$action 无响应（tcb CLI 是否已登录？跑一次 tcb login）"
  fi
  if echo "$out" | jq -e '.error' >/dev/null 2>&1; then
    die "$action 失败：$(echo "$out" | jq -r '.error.message')"
  fi
  echo "$out"
}

require_tools() {
  for t in tcb jq curl git; do
    command -v "$t" >/dev/null 2>&1 || die "缺少依赖：$t"
  done
}

# ---------- 打包 ----------
build_package() {
  local archive="$WORK_DIR/source.zip"

  # 必须用 git -C 从仓库根跑：在子目录里执行时 `HEAD:payload-office-platform`
  # 会被相对解析，静默产出一个 22 字节的空 zip（2026-07-27 踩过）。
  git -C "$REPO_ROOT" archive --format=zip "HEAD:$APP_DIR" > "$archive"

  local size file_count
  size="$(wc -c < "$archive" | tr -d ' ')"
  file_count="$(unzip -l "$archive" 2>/dev/null | tail -1 | awk '{print $2}')"

  # 空包会构建失败甚至发布出一个坏版本，宁可在这里挡住
  [ "$size" -gt 100000 ] || die "代码包异常（仅 $size 字节），检查 APP_DIR=$APP_DIR 是否正确"
  # pipefail 下不能使用 `grep -q`：命中后 grep 提前退出会让 unzip 收到 SIGPIPE，
  # 整条管道返回 141，把真实存在的 Dockerfile 误判为缺失。
  unzip -Z1 "$archive" 2>/dev/null | grep -Fx "Dockerfile" >/dev/null ||
    die "代码包里没有 Dockerfile"

  log "代码包：$(du -h "$archive" | cut -f1)，$file_count 个文件，commit $(git -C "$REPO_ROOT" rev-parse --short HEAD)" >&2
  echo "$archive"
}

# ---------- 上传 ----------
# 与 .github/workflows/deploy.yml「上传代码包并提交灰度版本」同一套逻辑，改一处要同步另一处。
# COS 对**单次 PUT 的总时长有 200s 上限**（COS_PUT_CAP），超过就在收完整个请求体后回
# `400 <Code>UserNetworkTooSlow</Code>`；预签名 URL 本身 7 天有效，不是病根。
# 本地网络通常几秒传完，但一旦慢下来：
# - 不带 --fail：它会把 COS 的 XML 错误体整个丢掉，只剩 `curl: (22) 400`，病根没法猜
#   （CI 就这么猜错过两轮）。状态码走 --write-out 自判，响应体落盘，失败时原样打出来。
# - 不用 curl --retry：不带 --fail 时 400 是 exit 0，--retry 根本不会重试，且它复用
#   同一条连接。改成循环，每次重新拉预签名 URL（换新连接）。
# - --max-time 钉在上限 +10s，传不完就别陪它耗到 400；--speed-limit 钉在「按上限算出的
#   必要速率」，明显达不到的连接 30s 内断掉换 URL。
upload_package() {
  local archive="$1" info="$WORK_DIR/upload.json" upload_resp="$WORK_DIR/upload-resp.xml"
  local archive_bytes need_bps attempt upload_url header_args key value
  local curl_exit stats http_code time_total size_upload speed_upload uploaded=0

  # 在上限内传完本包所需的最低平均速率。低于它持续 30s 的连接注定过不了线，
  # 提前断掉换 URL，而不是陪它传满上限再收 400。
  # curl 的判定是「最近 ~5s 的瞬时速率连续 30s 低于阈值」，偶尔抖一下不会误杀。
  archive_bytes="$(wc -c < "$archive" | tr -d ' ')"
  need_bps=$(( archive_bytes / COS_PUT_CAP + 1 ))
  log "COS 单次 PUT 上限 ${COS_PUT_CAP}s → 本包至少需要 ${need_bps} B/s（约 $(( need_bps / 1024 )) KB/s）" >&2

  for attempt in 1 2 3 4 5; do
    # 每次调用都会分配新的 PackageName/PackageVersion 与配套预签名 URL；上传成功后
    # 必须用**同一次**调用返回的包名/版本提交部署（$info 即当前成功那次）。
    log "上传尝试 $attempt/5：拉取新预签名 URL" >&2
    tcb_api tcb DescribeCloudBaseBuildService 2018-06-08 \
      "$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" '{EnvId:$envId,ServiceName:$svc}')" > "$info"
    upload_url="$(jq -r '.data.UploadUrl' "$info")"
    [ -n "$upload_url" ] && [ "$upload_url" != "null" ] || die "没拿到上传地址"

    # UploadHeaders 目前为空数组；留着按需拼接，注意 bash 3.2 下不要展开空数组
    header_args=""
    while IFS=$'\t' read -r key value; do
      [ -n "$key" ] && header_args="$header_args --header '$key: $value'"
    done < <(jq -r '.data.UploadHeaders[]? | [.Key,.Value] | @tsv' "$info")

    # --max-time 比上限多留 10s：上限内传不完的由 COS 回 400（错误体是证据），
    # 这里只兜底，别让一条 8KB/s 的连接拖到 5 分钟。
    : > "$upload_resp"
    curl_exit=0
    stats="$(eval curl --http1.1 --silent --show-error \
      --connect-timeout 20 \
      --max-time $(( COS_PUT_CAP + 10 )) \
      --speed-limit "$need_bps" --speed-time 30 \
      $header_args \
      --upload-file "'$archive'" \
      --output "'$upload_resp'" \
      --write-out "'%{http_code} %{time_total} %{size_upload} %{speed_upload}'" \
      "'$upload_url'")" || curl_exit=$?
    read -r http_code time_total size_upload speed_upload <<< "${stats:-000 0 0 0}"
    # http=100 = 只收到 100 Continue 就被 --speed-limit/--max-time 断了（还没等到终态）；
    # http=000 = 连接都没建起来。
    printf '   curl exit=%s http=%s 用时=%ss 已传=%sB 均速=%sB/s（需 %sB/s）\n' \
      "$curl_exit" "$http_code" "$time_total" "$size_upload" "$speed_upload" "$need_bps" >&2
    if [ "$curl_exit" -eq 0 ] && [ "$http_code" = "200" ]; then
      uploaded=1
      break
    fi
    if [ -s "$upload_resp" ]; then
      # COS 错误体是 XML：<Code>/<Message>/<RequestId>，拿 RequestId 可以找腾讯云工单。
      warn "COS 响应体：" >&2
      cat "$upload_resp" >&2
      echo >&2
    fi
    warn "上传尝试 $attempt 失败（curl exit=$curl_exit http=$http_code），3s 后换新 URL 重试" >&2
    sleep 3
  done
  [ "$uploaded" = "1" ] ||
    die "5 次上传全部失败。若响应体里是 UserNetworkTooSlow：本机到腾讯云的吞吐低于 ${need_bps}B/s，换个网络再试。"

  ok "上传完成（尝试 $attempt）" >&2
  echo "$info"
}

# ---------- 创建灰度版本（0% 流量）----------
submit_gray_deploy() {
  local info="$1" pkg_name pkg_ver body

  pkg_name="$(jq -r '.data.PackageName' "$info")"
  pkg_ver="$(jq -r '.data.PackageVersion' "$info")"

  # ReleaseType=GRAY：新版本初始 0% 流量，稳定版继续承接线上请求。
  # 不传 EnvParams：环境变量走 SDK 的加密通道，管控面明文传会被静默忽略，
  # 改环境变量请到 CloudBase 控制台操作（2026-07-27 验证过）。
  body="$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" --arg pn "$pkg_name" --arg pv "$pkg_ver" '{
    EnvId:$envId, ServerName:$svc,
    DeployInfo:{DeployType:"package", PackageName:$pn, PackageVersion:$pv, ReleaseType:"GRAY"},
    Items:[
      {Key:"AccessTypes",ArrayValue:["OA","PUBLIC","MINIAPP"]},
      {Key:"Port",IntValue:80}
    ]
  }')"

  tcb_api tcbr UpdateCloudRunServer 2022-02-17 "$body" | jq -r '.data.TaskId'
}

# ---------- 等待版本就绪 ----------
wait_ready() {
  local task_id="$1" attempt version_name deploy_id status task_json records_json

  for attempt in $(seq 1 80); do
    task_json="$(tcb_api tcbr DescribeServerManageTask 2022-02-17 \
      "$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" --argjson taskId "$task_id" \
        '{EnvId:$envId,ServerName:$svc,TaskId:$taskId}')")"
    version_name="$(echo "$task_json" | jq -r '.data.Task.VersionName // empty')"

    if [ -z "$version_name" ]; then
      printf '[%s/80] 等待平台分配版本号\n' "$attempt" >&2
      sleep 15
      continue
    fi

    records_json="$(tcb_api tcbr DescribeCloudRunDeployRecord 2022-02-17 \
      "$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" '{EnvId:$envId,ServerName:$svc}')")"
    deploy_id="${version_name##*-}"
    status="$(echo "$records_json" | jq -r --arg d "$deploy_id" \
      '.data.DeployRecords[] | select(.DeployId==$d) | .Status')"
    printf '[%s/80] %s -> %s\n' "$attempt" "$version_name" "$status" >&2

    case "$status" in
      normal)
        ok "$version_name 已就绪（0% 流量）" >&2
        echo "$version_name"
        return 0
        ;;
      build_failed|deploy_failed)
        die "$version_name 部署失败：$status（查构建日志：tcb cloudrun list / CloudBase 控制台）"
        ;;
      *) sleep 15 ;;
    esac
  done
  die "等待版本就绪超时（20 分钟）"
}

# ---------- 子命令 ----------
cmd_status() {
  local detail
  detail="$(tcb_api tcbr DescribeCloudRunServerDetail 2022-02-17 \
    "$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" '{EnvId:$envId,ServerName:$svc}')")"
  echo "服务状态：$(echo "$detail" | jq -r '.data.BaseInfo.Status')"
  echo "流量分配："
  echo "$detail" | jq -r '.data.OnlineVersionInfos[] | "  \(.VersionName) -> \(.FlowRatio)%"'
}

wait_traffic() {
  local expected="$1" attempt detail actual

  for attempt in $(seq 1 20); do
    detail="$(tcb_api tcbr DescribeCloudRunServerDetail 2022-02-17 \
      "$(jq -cn --arg envId "$ENV_ID" --arg svc "$SERVICE" '{EnvId:$envId,ServerName:$svc}')")"
    actual="$(echo "$detail" | jq -r \
      '[.data.OnlineVersionInfos[].FlowRatio | tonumber] | sort | map(tostring) | join(",")')"

    if [ "$actual" = "$expected" ]; then
      ok "流量已收敛：$actual"
      return 0
    fi

    printf '[%s/20] 等待流量收敛：当前 %s，期望 %s\n' "$attempt" "$actual" "$expected"
    sleep 3
  done

  die "流量在 60 秒内未收敛：期望 $expected"
}

cmd_deploy() {
  local archive info task_id version
  archive="$(build_package)"
  info="$(upload_package "$archive")"
  task_id="$(submit_gray_deploy "$info")"
  log "部署任务已提交，TaskId=$task_id（平台在线构建镜像，约 5–10 分钟）"
  version="$(wait_ready "$task_id")"
  echo
  ok "灰度版本 $version 就绪，当前 0% 流量，稳定版继续承接线上请求"
  echo "  下一步：$0 canary 10 && $0 smoke && $0 promote"
}

cmd_canary() {
  local pct="$1" stable expected
  [ -n "$pct" ] || die "用法：$0 canary <百分比>"
  echo "$pct" | grep -qE '^[0-9]+$' || die "百分比必须是整数"
  [ "$pct" -ge 0 ] && [ "$pct" -le 100 ] || die "百分比需在 0–100 之间"
  stable="$((100 - pct))"
  if [ "$stable" -le "$pct" ]; then
    expected="$stable,$pct"
  else
    expected="$pct,$stable"
  fi

  log "切 $pct% 流量给灰度版本"
  tcb -e "$ENV_ID" cloudrun traffic -s "$SERVICE" --stable "$stable" --canary "$pct"
  wait_traffic "$expected"
  ok "流量已调整"
  cmd_status
}

cmd_smoke() {
  local fail=0 code health canary_ok=0 i

  log "冒烟：/api/health ×20"
  for i in $(seq 1 20); do
    health="$(curl -sS --max-time 15 -w '\n%{http_code}' "$SITE_URL/api/health" 2>/dev/null || echo $'\n000')"
    code="$(echo "$health" | tail -1)"
    case "$code" in
      200)
        if echo "$health" | sed '$d' | jq -e '.status == "ok"' >/dev/null 2>&1; then
          canary_ok=$((canary_ok + 1))
        else
          warn "第 $i 次 200 但 status 不是 ok"; fail=1
        fi
        ;;
      # 灰度期间命中的旧稳定版可能还没有这个路由，404 可接受
      404) ;;
      *) warn "第 $i 次 -> HTTP $code"; fail=1 ;;
    esac
  done
  echo "  健康返回 status=ok 次数：$canary_ok/20"
  [ "$canary_ok" -ge 1 ] || { warn "20 次请求均未命中健康的新版本"; fail=1; }

  log "冒烟：页面可达性"
  for p in / /admin /listings; do
    code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$SITE_URL$p" 2>/dev/null || echo 000)"
    echo "  $p -> HTTP $code"
    [ "$code" = "200" ] || fail=1
  done

  [ "$fail" = "0" ] || die "冒烟失败（回滚：$0 rollback）"
  ok "冒烟通过"
}

cmd_promote() {
  log "全量发布"
  tcb -e "$ENV_ID" cloudrun traffic promote -s "$SERVICE"
  wait_traffic "100"
  ok "全量发布完成"
  cmd_status
}

cmd_rollback() {
  warn "回滚流量到稳定版本"
  tcb -e "$ENV_ID" cloudrun traffic rollback -s "$SERVICE" || true
  cmd_status
}

cmd_release() {
  # 完整流程与 .github/workflows/deploy.yml 的发布纪律一致：
  # 先 0% 候选，再小比例灰度冒烟，通过才全量；任一步失败立即回滚。
  cmd_deploy
  cmd_canary 10
  if ! cmd_smoke; then
    cmd_rollback
    die "灰度冒烟失败，已回滚"
  fi
  cmd_promote
  log "全量后复验"
  if ! cmd_smoke; then
    cmd_rollback
    die "全量后复验失败，已回滚"
  fi
  ok "发布完成"
}

main() {
  require_tools
  case "${1:-}" in
    status)   cmd_status ;;
    deploy)   cmd_deploy ;;
    canary)   cmd_canary "${2:-}" ;;
    smoke)    cmd_smoke ;;
    promote)  cmd_promote ;;
    rollback) cmd_rollback ;;
    release)  cmd_release ;;
    *)
      # 只打印顶部注释里的说明块（第 2–18 行），别把下面的实现注释也带出来
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 1
      ;;
  esac
}

main "$@"
