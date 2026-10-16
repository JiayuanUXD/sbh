import json, os, time, urllib.request, urllib.parse, sys
os.makedirs('/tmp/opt118-data', exist_ok=True)
BASE='https://shangban.cc/api'
def get(path, params):
    url=f"{BASE}/{path}?"+urllib.parse.urlencode(params)
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'sbh-content-research/1.0'}),timeout=60) as r:
                return json.load(r)
        except Exception as e:
            time.sleep(2*(i+1))
    raise RuntimeError(url)
def fetch_all(path, params, out):
    docs=[]; page=1
    while True:
        d=get(path, {**params,'limit':500,'page':page,'depth':0})
        docs+=d['docs']
        print(path,page,d['totalPages'],len(docs),file=sys.stderr)
        if not d['hasNextPage']: break
        page+=1; time.sleep(0.4)
    json.dump(docs,open(out,'w',encoding='utf8'),ensure_ascii=False)
sel=lambda *fs:{f'select[{f}]':'true' for f in fs}
fetch_all('locations',{**sel('name','type','parent','slug','city','frontendVisible','status')},'/tmp/opt118-data/locations.json')
fetch_all('buildings',{**sel('name','slug','district','businessDistrict','address','grade','buildingType','totalFloors','completionDate','propertyFee','nearestMetro','status'),'where[status][equals]':'published'},'/tmp/opt118-data/buildings.json')
fetch_all('listings',{**sel('building','price','area','listingType','decorationStatus','spaceDetails','minimumLeaseMonths','paymentTerms','costTerms','floor','seats'),
  'where[publicationStatus][equals]':'published','where[reviewStatus][equals]':'approved','where[businessType][equals]':'lease'},'/tmp/opt118-data/listings.json')
