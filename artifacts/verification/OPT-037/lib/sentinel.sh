#!/usr/bin/env bash
# OPT-037 验证脚本共享「页面渲染哨兵」——curl/bash 侧读取器。
#
# 判据在 `sentinel.json`（关键标记的校验交给 sentinel.py，在比对时做）；
# 本文件负责抓取侧的那一半：**真读 HTTP 状态码**，并把它写成 `status.json` 交给 domdiff。
#
# 本批栽过的坑：`task11e-capture.sh:23` 用 `curl -s`（无 `-f`、不查状态码），
# 错误页原样落盘，再交给只比字节的 domdiff —— 两侧都是错误页就打印「DOM 完全一致」。
#
# 用法：
#   source lib/sentinel.sh
#   sentinel_init "$OUT"
#   sentinel_fetch "$ORIGIN" "/listings/xxx" "$OUT/listing-detail.html" "listing-detail"
#   sentinel_finish "$OUT"       # 写 status.json；有任何非 200 时返回非 0

_SENTINEL_OK_STATUS="200"

sentinel_init() {
  local out="$1"
  mkdir -p "$out"
  : > "$out/.status.tsv"
  _SENTINEL_BAD=0
}

# sentinel_fetch <origin> <path> <outfile> <name>
sentinel_fetch() {
  local origin="$1" path="$2" file="$3" name="$4" code
  code="$(curl -s -o "$file" -w '%{http_code}' "$origin$path")"
  printf '%s\t%s\t%s\n' "$name" "$path" "$code" >> "$(dirname "$file")/.status.tsv"
  if [[ " $_SENTINEL_OK_STATUS " != *" $code "* ]]; then
    printf '  !! %-28s %-52s HTTP %s  ← 哨兵未通过，落盘的是错误页\n' "$name" "$path" "$code" >&2
    _SENTINEL_BAD=1
  else
    printf '  %-28s %-52s HTTP %s  %s B\n' "$name" "$path" "$code" "$(wc -c < "$file")"
  fi
}

sentinel_finish() {
  local out="$1"
  awk -F'\t' 'BEGIN{printf "{\n"} {if(NR>1)printf ",\n"; printf "  \"%s\": {\"path\": \"%s\", \"status\": %s}", $1,$2,$3} END{printf "\n}\n"}' \
    "$out/.status.tsv" > "$out/status.json"
  rm -f "$out/.status.tsv"
  if [ "${_SENTINEL_BAD:-0}" != "0" ]; then
    echo "哨兵：有 URL 不是 200，比对结论不成立" >&2
    return 1
  fi
  return 0
}
