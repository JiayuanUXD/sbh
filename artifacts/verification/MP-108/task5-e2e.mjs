#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DIR,SHA,identity,databaseEnvironment,run,sql,redact } from './task5-local.mjs'
import { parseSummary, assertPassingSummary } from './task5-verify.mjs'
const FRESH='sbh_dev_mp108_fresh', evidence=path.join(DIR,'local-e2e.json')
export function snapshot(){
  const tables=['leads','supply_submissions','city_partner_applications','locations','location_aliases','business_area_extensions','forms','listings','domain_events','notifications','payload_jobs','users']
  return {recordedAt:new Date().toISOString(),counts:Object.fromEntries(sql(FRESH,tables.map(t=>`SELECT '${t}',count(*) FROM ${t}`).join(' UNION ALL ')).split('\n').map(x=>{const[t,n]=x.split('|');return[t,Number(n)]})),markers:JSON.parse(sql(FRESH,`SELECT json_build_object('leadRequestIds',(SELECT coalesce(json_agg(request_id ORDER BY request_id),'[]') FROM leads WHERE request_id IS NOT NULL),'supplyRequestIds',(SELECT coalesce(json_agg(request_id ORDER BY request_id),'[]') FROM supply_submissions WHERE request_id IS NOT NULL),'partnerRequestIds',(SELECT coalesce(json_agg(request_id ORDER BY request_id),'[]') FROM city_partner_applications WHERE request_id IS NOT NULL),'locationSlugs',(SELECT coalesce(json_agg(slug ORDER BY slug),'[]') FROM locations WHERE slug LIKE 'e2e-%'),'formTitles',(SELECT coalesce(json_agg(title ORDER BY title),'[]') FROM forms WHERE title LIKE 'E2E%'),'listingRooms',(SELECT coalesce(json_agg(room_number ORDER BY room_number),'[]') FROM listings WHERE room_number LIKE 'E2E-%'))`))}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
identity();const stage=process.argv[2];assert(['false','diagnostic','false-corrected','true'].includes(stage));const flag=stage==='true'?'true':'false'
const all=existsSync(evidence)?JSON.parse(readFileSync(evidence)): {candidateSha:SHA,database:FRESH,environmentNote:'生产构建与 server CI=1；Playwright 不设 CI 以复用自管理 server，--retries=2 保持 CI 重试；flags 服务端/测试端一致。'}
assert(!all[stage], '禁止覆盖已记录的运行证据')
const result={status:'FAILED',recordedAt:new Date().toISOString(),baseURL:'http://localhost:3717',flag,commands:[],before:snapshot()}
all[stage]=result;writeFileSync(evidence,JSON.stringify(all,null,2)+'\n')
try{
const h=await fetch('http://127.0.0.1:3717/api/health');assert.equal(h.status,200);assert.equal((await h.json()).version,SHA)
const log=readFileSync(path.join(DIR,`local-server-e2e-${flag}.log`),'utf8');assert(log.includes(`"database":"${FRESH}"`))
const env=databaseEnvironment(FRESH,{PORT:'3717',E2E_PROD_SERVER:'1',PLAYWRIGHT_BASE_URL:'http://localhost:3717',PLAYWRIGHT_SERVER_URL:'http://127.0.0.1:3717/api/health',NEXT_PUBLIC_SITE_URL:'https://mp108.local.test',MULTI_CITY_ROUTING_ENABLED:flag})
const args=['test:e2e','--retries=2','--reporter=list'];if(flag==='true')args.push(...['multi-city-routing','multi-city-isolation','multi-city-forms','sale-channel'].map(n=>`tests/e2e/${n}.spec.ts`))
if(stage==='diagnostic')args.push('tests/e2e/admin-navigation.spec.ts','tests/e2e/bulk-import.spec.ts')
run('pnpm',args,env,result.commands)
result.summary=parseSummary(result.commands.at(-1).output)
assertPassingSummary(result.summary)
result.status='PASS'
}catch(error){result.failure=redact(error.message);process.exitCode=1}
const output=result.commands.at(-1)?.output??''
try { result.summary=parseSummary(output) } catch(error) { result.summary=null;result.status='FAILED';result.failure=redact(error.message);process.exitCode=1 }
result.after=snapshot();writeFileSync(evidence,JSON.stringify(all,null,2)+'\n');console.log(`E2E ${flag} ${result.status} ${JSON.stringify(result.summary)}`)
}
