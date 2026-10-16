import json, statistics as st, collections as C
L=json.load(open('/tmp/opt118-data/listings.json')); B={b['id']:b for b in json.load(open('/tmp/opt118-data/buildings.json'))}
LOC={l['id']:l for l in json.load(open('/tmp/opt118-data/locations.json'))}
nm=lambda i: LOC.get(i,{}).get('name')
q=lambda a,f:a[min(len(a)-1,int(len(a)*f))]
rows=[];cow=[]
for x in L:
    p=x.get('price') or {}; b=B.get(x['building'])
    if not b: continue
    if p.get('period')=='day' and p.get('unit')=='sqm' and p.get('amount'):
        rows.append(dict(p=p['amount'],a=x.get('area'),d=nm(b.get('district')),bd=nm(b.get('businessDistrict')),bid=b['id'],seats=x.get('seats'),minm=x.get('minimumLeaseMonths'),pay=x.get('paymentTerms')))
    elif p.get('period')=='month' and p.get('unit')=='seat': cow.append(dict(p=p['amount'],a=x.get('area'),seats=x.get('seats'),d=nm(b.get('district')),b=b['name'],minm=x.get('minimumLeaseMonths')))
N=len(rows); print('N',N)
print('\n--- business areas n>=150, by median price desc')
bd=C.defaultdict(list)
for r in rows:
    if r['bd']: bd[(r['bd'])].append(r)
out=[]
for k,rs in bd.items():
    if len(rs)>=150:
        pp=sorted(r['p'] for r in rs); out.append((st.median(pp),k,len(rs),q(pp,.25),q(pp,.75),len({r['bid'] for r in rs}),C.Counter(r['d'] for r in rs).most_common(1)[0][0]))
for o in sorted(out,reverse=True): print(f"{o[1]}\t{o[6]}\tmed={o[0]:.2f}\tp25={o[3]:.2f}\tp75={o[4]:.2f}\tn={o[2]}\tbld={o[5]}")
print('count areas',len(out))
print('\n--- terms shares')
for key in ('pay','minm'):
    c=C.Counter(r[key] for r in rows); print(key,[(k,f"{v/N:.1%}") for k,v in c.most_common(6)])
print('\n--- coworking',len(cow)); 
if cow:
    pp=sorted(c['p'] for c in cow); print('seat price pctl',[q(pp,f) for f in (0,.25,.5,.75,.99)],pp[-1]); print('districts',C.Counter(c['d'] for c in cow)); print('minm',C.Counter(c['minm'] for c in cow)); print([ (c['b'],c['p'],c['seats']) for c in cow[:6]])
print('\n--- area per seat (traditional)')
aps=sorted(r['a']/r['seats'] for r in rows if r['a'] and r['seats']); print(len(aps),[round(q(aps,f),1) for f in (.1,.25,.5,.75,.9)])
sc=C.Counter(round(r['a']/r['seats'],1) for r in rows if r['a'] and r['seats']); print(sc.most_common(6))
print('\n--- budget reverse: affordable area (m2) at district median, monthly=30d')
dist=C.defaultdict(list)
for r in rows: dist[r['d']].append(r['p'])
order=['黄浦区','静安区','徐汇区','浦东新区','虹口区','长宁区','杨浦区','普陀区','闵行区','宝山区','嘉定区']
for d in order:
    m=st.median(dist[d]); print(d,f"{m:.2f}",[round(b/(m*30)) for b in (30000,50000,100000)],f"200m2={m*200*30:,.0f}",f"100m2={m*100*30:,.0f}")
allm=st.median(r['p'] for r in rows); print('all median',allm, 'p25/p75',q(sorted(r['p'] for r in rows),.25),q(sorted(r['p'] for r in rows),.75))
for lo,hi in ((0,3),(3,4),(4,5),(5,6),(6,8),(8,99)):
    c=sum(1 for r in rows if lo<=r['p']<hi); print(f"price {lo}-{hi}: {c} {c/N:.1%}")
print('\n--- listings per building: n of buildings with >=1',len({r['bid'] for r in rows}))
