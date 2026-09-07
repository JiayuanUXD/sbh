#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DIR, WEB, SHA, identity, databaseEnvironment, redact } from './task5-local.mjs'
identity()
const phase = process.argv[2]
assert(['http','e2e-false','e2e-true','devtools'].includes(phase))
assert.equal(spawnSync('lsof', ['-nP','-iTCP:3717','-sTCP:LISTEN'], {encoding:'utf8'}).stdout.trim(), '', '3717 已占用，禁止管理未知进程')
assert.equal(JSON.parse(readFileSync(path.join(WEB,'.next/required-server-files.json'))).config.env.BUILD_COMMIT,SHA)
const database = phase.startsWith('e2e-') ? 'sbh_dev_mp108_fresh' : 'sbh_dev_mp108_prod'
const env = databaseEnvironment(database,{CI:'1',NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://mp108.local.test',MULTI_CITY_ROUTING_ENABLED:String(phase === 'e2e-true')})
if(database==='sbh_dev_mp108_prod') {
  env.PAYLOAD_DISABLE_JOB_AUTORUN='1'
  env.PGOPTIONS='-c default_transaction_read_only=on'
}
const log = path.join(DIR,`local-server-${phase}.log`)
appendFileSync(log,`${JSON.stringify({phase,database,candidateSha:SHA,startedAt:new Date().toISOString(),ci:true,instrumentation:'Node HTTP finish observer; no bodies or query logged'})}\n`)
const child = spawn(process.execPath,['--import',path.join(DIR,'task5-observer.mjs'),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3717'],{cwd:WEB,env,stdio:['ignore','pipe','pipe']})
for (const stream of [child.stdout,child.stderr]) {
  let buffer=''
  stream.on('data',chunk=>{buffer+=chunk.toString();let n;while((n=buffer.indexOf('\n'))>=0){const line=redact(buffer.slice(0,n+1),env);buffer=buffer.slice(n+1);appendFileSync(log,line);process.stdout.write(line)}})
  stream.on('end',()=>{if(buffer)appendFileSync(log,redact(buffer,env))})
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal))
child.on('exit',(code,signal)=>{appendFileSync(log,`${JSON.stringify({stoppedAt:new Date().toISOString(),exitCode:code,signal})}\n`);process.exitCode=code??0})
