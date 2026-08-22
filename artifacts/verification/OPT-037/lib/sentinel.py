# OPT-037 验证脚本共享「页面渲染哨兵」——Python 侧读取器（供 task11*-domdiff.py 用）。
#
# 判据在 `sentinel.json`，本文件只做「读 JSON + 断言」。见该 JSON 的 `_why`。
#
# 为什么 domdiff 必须先过哨兵：逐字节比对**两个 404 页会打印「DOM 完全一致」**。
# 本批已经产生过一次这样的假结论（task-11-report.md 的 /dev-story/opt037）。
# 哨兵不通过时 domdiff 必须报错退出，而不是把「一致」当成结论。
#
# HTML dump 里没有 HTTP 状态码，所以这一侧的状态码由抓取脚本（sentinel.sh / capture）
# 写进同目录的 `status.json`（`{"<name>": {"path": "/x", "status": 200}}`）。
# 缺 status.json 时按「状态码不可复核」降级并**打印警告**，不静默通过。
import json
import pathlib
import re

_HERE = pathlib.Path(__file__).resolve().parent
SPEC = json.loads((_HERE / "sentinel.json").read_text(encoding="utf-8"))


def family_for(pathname: str) -> dict:
    """路由族按 families 顺序先匹配先赢（详情页排在同名列表页之前）。"""
    for fam in SPEC["families"]:
        if re.search(fam["pattern"], pathname):
            return fam
    return SPEC["fallback"]


def family_by_name(stem: str) -> dict:
    """
    缺 `status.json` 的历史 dump：按文件名推路由族（规则表在 sentinel.json 的 nameHints，
    先匹配先赢）。推不出来就落到 fallback（只查 `site-main`，判据最松）。
    """
    for needle, fam_id in SPEC["nameHints"]["rules"]:
        if needle in stem:
            for fam in SPEC["families"]:
                if fam["id"] == fam_id:
                    return fam
    return SPEC["fallback"]


def load_status(dir_path: pathlib.Path) -> dict | None:
    f = dir_path / "status.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def check(
    dir_path: pathlib.Path, name: str, html: str, status_map: dict | None, allow_missing_status: bool = False
) -> tuple[bool, str, bool]:
    """
    返回 (通过?, 说明, 状态码是否缺失)。name 是 dump 文件名（不含 .html）。

    `allow_missing_status=True` 只用于**历史**产物（抓取时还没有 status.json 这条纪律）：
    此时关键标记仍然必须全中，但状态码判据降级为「不可复核」。调用方必须把退出码
    置成非 0（约定用 2），确保它永远不会被读成一次干净的 PASS。
    """
    entry = (status_map or {}).get(name) or {}
    pathname = entry.get("path")
    fam = family_for(pathname) if pathname else family_by_name(name)
    missing = [m for m in fam["requiredMarkers"] if m not in html]
    status = entry.get("status")
    status_absent = status is None
    problems = []
    if status_absent and not allow_missing_status:
        problems.append("状态码未记录（抓取脚本没写 status.json）")
    elif not status_absent and status not in SPEC["okStatus"]:
        problems.append(f"HTTP {status}")
    if missing:
        problems.append(f"缺关键标记 {missing}（族={fam['id']}）")
    if problems:
        return False, "；".join(problems), status_absent
    label = "HTTP 不可复核" if status_absent else f"HTTP {status}"
    return True, f"{label} 族={fam['id']}", status_absent


def poi_panel_stats(html: str) -> dict:
    """`--mask-poi` 的对照：面板确实存在吗？一级 tab 有几个？"""
    p = SPEC["poiPanel"]
    return {
        "present": p["presenceMarker"] in html,
        "tabs": html.count(p["tabMarker"]),
    }
