# OPT-037 Task 11e：证明「只改预取行为，不改渲染输出」这条硬约束**成立**（实测，不是断言）。
#
# 归一化与哨兵实现见 `lib/domdiff.py`（2026-08-22 终审第 3 轮从三份副本收敛而来）。
# `--mask-poi` 把楼盘/房源详情页的 POI 面板整块换成占位再比：该面板依赖高德 web
# service，冷启动/限流时整块拿不到数据，会比出与本次改动完全无关的巨大 diff。
# 遮罩模式现在**配了对照**：两侧面板都必须存在，否则判不通过（否则遮罩只是掩盖）。
#
# 本轮的 HTML 输入 `task11e-{before,after}/` 已入库，但抓取时还没有 `status.json`
# 这条纪律，复核要带 `--allow-missing-status`（退出码恒 2，关键标记仍然全查）。
#
# 用法：python task11e-domdiff.py <before 目录> <after 目录> [--mask-poi] [--allow-missing-status]
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
import domdiff  # noqa: E402

PAGES = [
    "news-detail-related.html",
    "news-detail-plain.html",
    "news.html",
    "building-detail.html",
    "listing-detail.html",
]

sys.exit(domdiff.run(PAGES, sys.argv, task="Task 11e"))
