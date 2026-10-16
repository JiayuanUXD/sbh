"""
计算 8 篇资讯里用到的全部数字，输出到 /tmp/opt118-data/numbers.json 并打印摘要（OPT-118）。
先跑 fetch_data.py 再跑本脚本；文章里的数字以这里的输出为准。
"""
import collections, json, statistics as st

L = json.load(open('/tmp/opt118-data/listings.json'))
B = {b['id']: b for b in json.load(open('/tmp/opt118-data/buildings.json'))}
LOC = {l['id']: l for l in json.load(open('/tmp/opt118-data/locations.json'))}
nm = lambda i: LOC.get(i, {}).get('name')
q = lambda a, f: a[min(len(a) - 1, int(len(a) * f))]

rows, cow = [], []
for x in L:
    p = x.get('price') or {}
    b = B.get(x['building'])
    if not b:
        continue
    if p.get('period') == 'day' and p.get('unit') == 'sqm' and p.get('amount'):
        rows.append(dict(p=p['amount'], a=x.get('area'), d=nm(b.get('district')), bd=nm(b.get('businessDistrict')), bid=b['id'],
                         minm=x.get('minimumLeaseMonths'), pay=x.get('paymentTerms'), dep=(x.get('costTerms') or {}).get('depositMonths'),
                         deco=x['decorationStatus'], eff=(x.get('spaceDetails') or {}).get('efficiencyRate')))
    elif p.get('period') == 'month' and p.get('unit') == 'seat':
        cow.append(dict(p=p['amount'], d=nm(b.get('district')), minm=x.get('minimumLeaseMonths')))

N = len(rows)
ps = sorted(r['p'] for r in rows)
out = {'total_listings': len(L), 'N': N, 'buildings_with_rows': len({r['bid'] for r in rows}),
       'median': st.median(ps), 'p25': q(ps, .25), 'p75': q(ps, .75)}
ar = sorted(r['a'] for r in rows if r['a'])
out['area'] = {'median': st.median(ar), 'p25': q(ar, .25), 'p75': q(ar, .75)}

by = lambda key: collections.defaultdict(list)
dist = collections.defaultdict(list)
for r in rows:
    dist[r['d']].append(r)
out['district'] = {}
for d, rs in dist.items():
    pp = sorted(r['p'] for r in rs)
    small = [r for r in rs if r['a'] and r['a'] <= 100]
    sp = sorted(r['p'] for r in small)
    out['district'][d] = dict(n=len(rs), med=st.median(pp), p25=q(pp, .25), p75=q(pp, .75), bld=len({r['bid'] for r in rs}),
                              small_n=len(small), small_share=len(small) / len(rs), small_med=st.median(sp) if sp else None)

bd = collections.defaultdict(list)
for r in rows:
    if r['bd']:
        bd[r['bd']].append(r)
out['areas'] = []
for k, rs in bd.items():
    if len(rs) >= 150:
        pp = sorted(r['p'] for r in rs)
        out['areas'].append(dict(name=k, district=collections.Counter(r['d'] for r in rs).most_common(1)[0][0], n=len(rs),
                                 med=st.median(pp), p25=q(pp, .25), p75=q(pp, .75), bld=len({r['bid'] for r in rs})))
out['areas'].sort(key=lambda a: -a['med'])

bands = [(0, 50), (50, 100), (100, 200), (200, 300), (300, 500), (500, 1000), (1000, 1e9)]
out['bands'] = []
for lo, hi in bands:
    rs = [r for r in rows if r['a'] and lo <= r['a'] < hi]
    pp = sorted(r['p'] for r in rs)
    out['bands'].append(dict(lo=lo, hi=hi, n=len(rs), share=len(rs) / N, med=st.median(pp) if pp else None))
out['small'] = dict(n=sum(b['n'] for b in out['bands'][:2]), share=sum(b['share'] for b in out['bands'][:2]))

for key in ('pay', 'minm'):
    out[key] = [(k, v / N) for k, v in collections.Counter(r[key] for r in rows).most_common(8)]
dc = collections.Counter(r['dep'] for r in rows)
out['dep'] = [(k, v / N) for k, v in dc.most_common(4)]
out['deco'] = {k: dict(n=len(v), med=st.median(v)) for k, v in
               ((k, [r['p'] for r in rows if r['deco'] == k]) for k in {r['deco'] for r in rows})}
out['eff'] = sorted(r['eff'] for r in rows if r['eff'])[::max(1, len([r for r in rows if r['eff']]) // 9)]

cp = sorted(c['p'] for c in cow)
out['cow'] = dict(n=len(cow), med=st.median(cp), p25=q(cp, .25), p75=q(cp, .75), lo=cp[0], hi=cp[-1],
                  districts=collections.Counter(c['d'] for c in cow).most_common(), minm=collections.Counter(c['minm'] for c in cow).most_common())
out['price_bands'] = {f'{lo}-{hi}': sum(1 for r in rows if lo <= r['p'] < hi) for lo, hi in ((0, 3), (3, 4), (4, 5), (5, 6), (6, 8), (8, 99))}
top = collections.Counter(r['bid'] for r in rows).most_common(5)
out['top_buildings'] = [dict(name=B[b]['name'], n=n) for b, n in top]
nxl = [r for r in rows if r['bd'] == '南京西路']
out['nanjingxilu_top'] = collections.Counter(B[r['bid']]['name'] for r in nxl).most_common(3)
json.dump(out, open('/tmp/opt118-data/numbers.json', 'w'), ensure_ascii=False, indent=1, default=list)
print('N', N, 'buildings', out['buildings_with_rows'], 'median', out['median'], 'IQR', out['p25'], out['p75'], 'total', len(L))
