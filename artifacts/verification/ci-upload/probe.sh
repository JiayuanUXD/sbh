#!/usr/bin/env bash
# usage: probe.sh <name> <urlfile> <blob> <limit-rate>
name="$1"; url=$(cat "$2"); blob="$3"; rate="$4"
S="${PROBE_DIR:-.}"
out=$(curl --http1.1 -sS -o "$S/probe-$name.body" -w '%{http_code} %{time_total} %{size_upload} %{speed_upload} %{exitcode}' --connect-timeout 20 --max-time 600 --limit-rate "$rate" --upload-file "$blob" "$url" 2>"$S/probe-$name.err")
code=$(grep -o '<Code>[^<]*' "$S/probe-$name.body" 2>/dev/null | sed 's/<Code>//')
echo "$name rate=$rate http/time/size/speed/exit=[$out] cos_code=${code:-none} err=$(cat "$S/probe-$name.err")"
