# OPT-037 Task 11d：证明「只改预取行为，不改渲染输出」这条硬约束**成立**（实测，不是断言）。
#
# 归一化与哨兵实现见 `lib/domdiff.py`（2026-08-22 终审第 3 轮从三份副本收敛而来；
# 三份副本原先都缺「页面真的渲染了」的哨兵，两侧 404 会打印「DOM 完全一致」）。
#
# 本轮的 HTML 输入 `task11d-{before,after}/` 已入库，但它们是在 `status.json`
# 这条纪律之前抓的，**没有状态码**，所以复核时要带 `--allow-missing-status`
# （退出码恒 2，关键标记仍然全查）。
#
# 两个取样陷阱（原脚本已记，保留）：
#   1. 楼盘详情页 POI 面板依赖高德 web service，冷启动首个请求常拿不到，整块不渲染。
#   2. `data-supply-as-of` 是 asOf 快照时刻，两次取样必然不同，须归一。
#
# 用法：python task11d-domdiff.py <before 目录> <after 目录> [--mask-poi] [--allow-missing-status]
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
import domdiff  # noqa: E402

PAGES = [
    "news.html",
    "building-detail.html",
    "building-detail-empty.html",
    "listing-detail.html",
    "listings.html",
    "buildings.html",
]

sys.exit(domdiff.run(PAGES, sys.argv, task="Task 11d"))
