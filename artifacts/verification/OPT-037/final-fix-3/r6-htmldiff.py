# OPT-037 终审第 3 轮 R6：Task 10b「有图时一个字节都不许变」的 HTML 逐字节比对。
#
# 与第 2 轮 `final-fix-2/html-diff.sh` 同一套归一化，改用 Python 是为了**复用
# `lib/sentinel.py` 的渲染哨兵**：比对之前先证明两侧都真的渲染了。
# （两个 404/500 页比对会打印「DOM 完全一致」——本批已经出过一次这样的假结论。）
#
# 归一化掉三类与代码无关的差异，剩下的必须为 0：
#   1. 构建产物指纹：`/_next/static/chunks/<hash>.(css|js)` 与 BUILD_ID `"b":"<id>"`
#      —— 每次 `next build` 必变。
#   2. **RSC flight 载荷** `<script>self.__next_f.push([...])</script>`：同一份 DOM 的
#      第二份序列化，Next 按到达时机切块，**同一个构建连抓两次切块边界就不同**
#      （第 2 轮实测）。整段剔除、连续多段折叠成一段。
#      Task 10b 新增的 `magnitude` / `unit` 字段也只出现在这里，属序列化不属 DOM。
#   3. 逐请求变化的运行时数据：`data-supply-as-of="<ISO>"`。
#
# 用法：python r6-htmldiff.py <before 目录> <after 目录> [标签]
import io
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))
import sentinel  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FLIGHT = re.compile(r"<script>self\.__next_f\.push\(.*?\)</script>", re.S)


def norm(s: str) -> str:
    s = FLIGHT.sub("<script>FLIGHT</script>", s)
    s = re.sub(r"(?:<script>FLIGHT</script>)+", "<script>FLIGHT</script>", s)
    s = re.sub(r"/_next/static/chunks/[A-Za-z0-9_-]+\.(css|js)", r"/_next/static/chunks/HASH.\1", s)
    s = re.sub(r'"b":"[A-Za-z0-9_-]+"', '"b":"BUILDID"', s)
    s = re.sub(r'data-supply-as-of="[^"]*"', 'data-supply-as-of="ASOF"', s)
    return s


before_dir = pathlib.Path(sys.argv[1])
after_dir = pathlib.Path(sys.argv[2])
label = sys.argv[3] if len(sys.argv) > 3 else f"{before_dir.name} vs {after_dir.name}"

st_before = sentinel.load_status(before_dir)
st_after = sentinel.load_status(after_dir)
if st_before is None or st_after is None:
    print("!! 缺 status.json —— 抓取脚本没记状态码，本次比对的哨兵不可复核，拒绝出结论")
    sys.exit(2)

print(f"=== {label} ===")
exit_code = 0
for name in sorted(st_before):
    fa = before_dir / f"{name}.html"
    fb = after_dir / f"{name}.html"
    if not fa.exists() or not fb.exists():
        print(f"{name:30s} 缺文件")
        exit_code = 1
        continue
    ra = fa.read_text(encoding="utf-8", errors="replace")
    rb = fb.read_text(encoding="utf-8", errors="replace")
    ok_a, why_a, _ = sentinel.check(before_dir, name, ra, st_before)
    ok_b, why_b, _ = sentinel.check(after_dir, name, rb, st_after)
    if not (ok_a and ok_b):
        print(f"{name:30s} 哨兵未通过  before：{why_a}  after：{why_b}")
        exit_code = 1
        continue
    a, b = norm(ra), norm(rb)
    if a == b:
        print(f"{name:30s} 归一化后逐字节一致  len={len(a)}  ({why_a})")
        continue
    # 差异行数：与原报告「diff 行数」同口径（把 `><` 拆行后按行 diff）
    import difflib

    la = a.replace("><", ">\n<").splitlines()
    lb = b.replace("><", ">\n<").splitlines()
    changed = [ln for ln in difflib.unified_diff(la, lb, lineterm="", n=0) if ln[:1] in "+-" and ln[:3] not in ("+++", "---")]
    print(f"{name:30s} 有差异  before={len(a)} after={len(b)}  diff 行数={len(changed)}")
    for ln in changed[:30]:
        print("    " + ln[:200])
    exit_code = 1

sys.exit(exit_code)
