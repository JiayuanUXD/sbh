# OPT-037 Task 11c：证明「只改预取行为，不改渲染输出」这条硬约束**成立**（实测，不是断言）。
#
# 做法：同一台机、同一套 env、同一个端口，分别用「改前」与「改后」的 `next build`
# 起 `next start`，对同一批 URL 各抓一份 HTML，剥掉 `<script>`/`<link>`、归一
# `data-supply-as-of` 后逐字节比对。归一化与哨兵的实现都在 `lib/domdiff.py`。
#
# **2026-08-22 终审第 3 轮改动**：
#   1. 原本三支 domdiff（11c/11d/11e）是三份逐行相同的副本，且**三份都没有
#      「页面真的渲染了」的哨兵**——两侧都是 404/500 页会打印「DOM 完全一致」。
#      判据已收敛进 `lib/domdiff.py` + `lib/sentinel.json`，本文件只留 PAGES。
#   2. 本轮用 `final-fix-3/capture-html.mjs`（带状态码落盘）重建了 11c 那一轮
#      丢失的 HTML 输入：`final-fix-3/r7c-{before,after}-html/`。
#
# 两个取样陷阱（原脚本已记，保留）：
#   1. 楼盘详情页的「周边配套 POI 面板」依赖高德 web service，**冷启动后的第一次
#      请求常常拿不到 POI**，整块面板不渲染，HTML 少 6KB。必须先预热再取样。
#   2. `data-supply-as-of` 是 asOf 快照时刻，两次取样必然不同，须归一。
#
# 用法：python task11c-domdiff.py <before 目录> <after 目录> [--mask-poi] [--allow-missing-status]
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
import domdiff  # noqa: E402

PAGES = [
    "listings.html",
    "listings-row.html",
    "buildings.html",
    "listing-detail.html",
    "building-detail.html",
]

sys.exit(domdiff.run(PAGES, sys.argv, task="Task 11c"))
