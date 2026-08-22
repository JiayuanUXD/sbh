# OPT-037 Task 11d：`building-detail-empty.html` 的 before/after 差异是否**只**来自
# 高德 POI 面板（已知冷启动陷阱），而不是本次改动的回归。
#
# 背景：11c 已记录该陷阱——楼盘详情页「周边配套」POI 依赖高德 web service，冷启动
# 后前几次请求常拿不到数据，整块面板不渲染。本轮 before 取样时
# `/buildings/empty-building` 就没拿到「交通」这一类 POI（after 拿到了），DOM 多出 2040 字符。
# 遮罩后**面板之外的每一个字节都必须一致**，本次改动才算「只改预取行为」。
#
# **2026-08-22 终审第 3 轮补的对照**：遮罩会一并吞掉真发生在面板内部的回归。
# 所以 `lib/domdiff.py` 在遮罩模式下额外打印两侧的「面板是否存在 / 一级 tab 数」，
# 并在某一侧根本没有面板时判**不通过**——那种情况下遮罩不是解药而是掩盖。
#
# 用法：python task11d-domdiff-maskpoi.py <before 目录> <after 目录> [页面名] [--allow-missing-status]
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))
import domdiff  # noqa: E402

# 第 3 个位置参数若是页面名（不以 -- 开头）就用它，否则用默认页
page = "building-detail-empty.html"
argv = list(sys.argv)
if len(argv) > 3 and not argv[3].startswith("--"):
    page = argv.pop(3)

sys.exit(domdiff.run([page], argv, mask_poi=True, task="Task 11d · POI 遮罩"))
