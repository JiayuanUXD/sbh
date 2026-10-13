#!/bin/bash
# 复现与验证 deploy.yml 冒烟 / 全量后验证在网络层失败下的行为（2026-10-13）。
# 用法（仓库根目录）：bash artifacts/verification/deploy-hardening-20261013/run-smoke-scenarios.sh <改前 ref>
# 依赖：python3 + PyYAML、curl、jq。脚本把超时缩到 2s、轮数缩到 8/6，便于本地快速跑。
set -u
D=$(cd "$(dirname "$0")" && pwd); W=$(mktemp -d); OLD=${1:-origin/master}
for ref in "$OLD" WORKTREE; do
  for step in "Smoke test" "全量发布后验证"; do
    tag=$([ "$ref" = WORKTREE ] && echo new || echo old)_$([ "$step" = "Smoke test" ] && echo smoke || echo verify)
    python3 -I "$D/extract-deploy-step.py" .github/workflows/deploy.yml "$ref" "$step" "$W/$tag.sh" http://127.0.0.1:38xx
  done
done
run() { # $1=假服务模式 $2=脚本 $3=端口 $4=假服务返回的 version
  MODE=$1 VER=${4:-abc} python3 -I "$D/fake-health-server.py" "$3" & sp=$!; sleep 0.5
  sed "s#http://127.0.0.1:38xx#http://127.0.0.1:$3#g" "$W/$2" > "$W/run_$3.sh"
  RUNNER_TEMP=$W GITHUB_SHA=abc bash -e "$W/run_$3.sh" > "$W/out_$3.log" 2>&1; rc=$?
  kill $sp 2>/dev/null; wait $sp 2>/dev/null
  printf '%-11s %-15s exit=%s\n' "$1" "$2" "$rc"
}
run first_hang old_smoke.sh 3901    # 改前：第 1 个请求超时即 exit 28（复现 run 38364936280）
run first_hang new_smoke.sh 3902    # 改后：通过
run all_hang   new_smoke.sh 3903    # 改后：网络层失败超过 5 次判失败
run ok         new_smoke.sh 3904    # 改后：通过
run first_hang old_verify.sh 3905   # 改前：promote 后第 1 个请求超时即 exit 28
run first_hang new_verify.sh 3906   # 改后：通过
run ok         new_verify.sh 3907 wrong  # 改后：版本不符仍判失败
run all_hang   new_verify.sh 3908   # 改后：判失败
