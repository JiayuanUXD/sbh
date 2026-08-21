# OPT-037 Task 11d：`building-detail-empty.html` 的 before/after 差异是否**只**来自
# 高德 POI 面板（已知冷启动陷阱），而不是本次改动的回归。
#
# 背景：Task 11c 已记录该陷阱——楼盘详情页「周边配套」POI 依赖高德 web service，
# 冷启动后前几次请求常拿不到数据，整块面板不渲染。本轮 before 取样时
# `/buildings/empty-building` 就没拿到「交通」这一类 POI（after 拿到了），
# 于是 DOM 多出 2040 字符。
#
# 本脚本把 `<div class="location-panel__pois" ...> ... <!--POI 面板结束-->` 之间的整块
# 内容替换成占位再比对：**面板之外的每一个字节都必须一致**，本次改动才算「只改预取行为」。
# 之所以能这么做：POI 面板是 `LocationPanel` 的内部产物，与 `BuildingCardMini` /
# `ArticleCard` / `BuildingSummaryCard` 三个改动点没有任何 DOM 交集。
import re, sys, pathlib, difflib, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

def dom_only(path):
    s = path.read_text(encoding="utf-8", errors="replace")
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<script[^>]*/?>", "", s)
    s = re.sub(r"<link[^>]*>", "", s)
    s = re.sub(r'data-supply-as-of="[^"]*"', 'data-supply-as-of="<ts>"', s)
    # 遮掉整个 `<div class="location-panel__poi-panel">…</section>`（tabs / subtabs / list 全在里面）
    s = re.sub(r'<div class="location-panel__poi-panel".*?</section>',
               '<!--POI-PANEL-MASKED--></section>', s, flags=re.S)
    return s

name = sys.argv[3] if len(sys.argv) > 3 else "building-detail-empty.html"
a = dom_only(pathlib.Path(sys.argv[1]) / name)
b = dom_only(pathlib.Path(sys.argv[2]) / name)
if a == b:
    print(f"{name}  遮掉 POI 面板后 DOM 完全一致  len={len(a)}")
    sys.exit(0)
print(f"{name}  遮掉 POI 面板后**仍有差异**  before={len(a)} after={len(b)}")
for line in list(difflib.unified_diff(a.replace("><", ">\n<").splitlines(),
                                      b.replace("><", ">\n<").splitlines(), lineterm="", n=1))[:60]:
    print(line[:220])
sys.exit(1)
