"""
把 REST 取数的结果与前台「统一有效供给」口径逐项对账（OPT-118，回应评审 P1）。

为什么要对账：fetch_data.py 走匿名 REST 并自己加了发布 / 审核 / 业务类型 / 供给正常条件，
但「被生效举报冻结」表达不成 where（见 Listings.access.read 的说明），REST 无法完全等价前台的有效供给。
前台列表页走的就是有效供给服务，它给出的总数与各区计数是权威口径；两边对得上，
说明这批数据里没有「REST 能读到、前台却不展示」的房源，文章里的数字才可信。

对不上就退出码 1，文章里的数字必须重算。

用法：python3 -I reconcile_with_frontend.py   （先跑 fetch_data.py）
"""
import collections, json, re, sys, urllib.request

BASE = 'https://shangban.cc'
L = json.load(open('/tmp/opt118-data/listings.json'))
B = {b['id']: b for b in json.load(open('/tmp/opt118-data/buildings.json'))}
LOC = {l['id']: l for l in json.load(open('/tmp/opt118-data/locations.json'))}

def page_text(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'sbh-content-research/1.0'})
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf8', 'ignore')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', html, flags=re.S)
    return [l.strip() for l in re.sub(r'<[^>]+>', '\n', t).split('\n') if l.strip()]

lines = page_text(f'{BASE}/shanghai/listings')
front_total = int(lines[lines.index('共') + 1])  # 列表页「共 N 套」
# 前台「位置」筛选行：区名后紧跟计数
front_districts = {}
start = lines.index('位置') + 1
for i in range(start, len(lines) - 1):
    if lines[i] == '类型':
        break
    if lines[i + 1].isdigit() and not lines[i].isdigit():
        front_districts[lines[i]] = int(lines[i + 1])

rest_total = len(L)
by_district = collections.Counter()
for x in L:
    b = B.get(x['building'])
    if b:
        by_district[LOC.get(b.get('district'), {}).get('name')] += 1

ok = True
print(f'总数  前台={front_total}  REST={rest_total}  {"一致" if front_total == rest_total else "不一致"}')
ok &= front_total == rest_total
for name, n in front_districts.items():
    mine = by_district.get(name, 0)
    flag = '一致' if mine == n else '不一致'
    ok &= mine == n
    print(f'{name}  前台={n}  REST={mine}  {flag}')
print('结论：' + ('与前台有效供给口径完全一致' if ok else '存在差异，文章数字需重算'))
sys.exit(0 if ok else 1)
