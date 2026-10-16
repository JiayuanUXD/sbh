import json, statistics as st, collections as C
L=json.load(open('/tmp/opt118-data/listings.json')); B={b['id']:b for b in json.load(open('/tmp/opt118-data/buildings.json'))}
LOC={l['id']:l for l in json.load(open('/tmp/opt118-data/locations.json'))}
print('listings',len(L),'buildings',len(B))
print('priceunits',C.Counter((x.get('price') or {}).get('period','-')+'/'+(x.get('price') or {}).get('unit','-') for x in L).most_common(6))
print('types',C.Counter(x['listingType'] for x in L)); print('deco',C.Counter(x['decorationStatus'] for x in L))
rows=[]
for x in L:
    p=x.get('price') or {}
    if p.get('period')!='day' or p.get('unit')!='sqm' or not p.get('amount'): continue
    b=B.get(x['building']); 
    if not b: continue
    rows.append(dict(p=p['amount'],a=x.get('area'),d=b.get('district'),bd=b.get('businessDistrict'),b=b['name'],bid=b['id'],t=x['listingType'],deco=x['decorationStatus'],
      eff=(x.get('spaceDetails') or {}).get('efficiencyRate'),minm=x.get('minimumLeaseMonths'),pay=x.get('paymentTerms'),dep=(x.get('costTerms') or {}).get('depositMonths')))
print('rows',len(rows))
ps=sorted(r['p'] for r in rows); q=lambda a,f:a[int(len(a)*f)]
print('price pctl 1,5,25,50,75,95,99,max',[q(ps,f) for f in (.01,.05,.25,.5,.75,.95,.99)],ps[-1],ps[0])
ar=sorted(r['a'] for r in rows if r['a']); print('area pctl',[q(ar,f) for f in (.05,.25,.5,.75,.95)])
def name(i): return LOC.get(i,{}).get('name','?')
bydist=C.defaultdict(list)
for r in rows: bydist[r['d']].append(r)
print('\n=== district'); 
for d,rs in sorted(bydist.items(),key=lambda kv:-len(kv[1])):
    pp=sorted(r['p'] for r in rs); aa=sorted(r['a'] for r in rs if r['a'])
    print(f"{name(d)}\tn={len(rs)}\tmedP={st.median(pp):.2f}\tp25={q(pp,.25):.2f}\tp75={q(pp,.75):.2f}\tmedA={st.median(aa):.0f}\tbuildings={len({r['bid'] for r in rs})}")
bybd=C.defaultdict(list)
for r in rows: bybd[r['bd']].append(r)
print('\n=== top business areas')
for d,rs in sorted(bybd.items(),key=lambda kv:-len(kv[1]))[:20]:
    pp=sorted(r['p'] for r in rs)
    print(f"{name(d)}\tn={len(rs)}\tmedP={st.median(pp):.2f}\tbuildings={len({r['bid'] for r in rs})}\tparent={name(LOC.get(d,{}).get('parent'))}")
print('\n=== top buildings')
bb=C.defaultdict(list)
for r in rows: bb[r['bid']].append(r)
for k,rs in sorted(bb.items(),key=lambda kv:-len(kv[1]))[:15]:
    pp=[r['p'] for r in rs]; print(f"{B[k]['name']}\t{name(B[k].get('district'))}\t{name(B[k].get('businessDistrict'))}\tn={len(rs)}\tmedP={st.median(pp):.2f}\tmin={min(pp):.2f}\tmax={max(pp):.2f}")
bands=[(0,50),(50,100),(100,200),(200,300),(300,500),(500,1000),(1000,1e9)]
print('\n=== area bands overall')
for lo,hi in bands:
    rs=[r for r in rows if r['a'] and lo<=r['a']<hi]; pp=sorted(r['p'] for r in rs)
    print(lo,hi,len(rs),f"{len(rs)/len(rows):.1%}", f"med {st.median(pp):.2f}" if pp else '')
print('\n=== small area (<=100) by district')
for d,rs in sorted(bydist.items(),key=lambda kv:-len(kv[1])):
    s=[r for r in rs if r['a'] and r['a']<=100]; 
    if len(s)>=20: pp=sorted(r['p'] for r in s); print(name(d),len(s),f"{len(s)/len(rs):.1%}",f"med {st.median(pp):.2f}")
print('\n=== lease terms'); 
print('minMonths',C.Counter(r['minm'] for r in rows).most_common(8)); print('pay',C.Counter(r['pay'] for r in rows).most_common(8)); print('deposit',C.Counter(r['dep'] for r in rows).most_common(6))
ef=[r['eff'] for r in rows if r['eff']]; print('efficiency n',len(ef),'med',st.median(ef) if ef else None, [q(sorted(ef),f) for f in (.1,.25,.5,.75,.9)] if ef else '')
print('deco med price'); 
for k in C.Counter(r['deco'] for r in rows): 
    pp=[r['p'] for r in rows if r['deco']==k]; print(k,len(pp),f"{st.median(pp):.2f}")
