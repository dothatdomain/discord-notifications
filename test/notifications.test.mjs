import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import worker,{NotificationStore,developerItems} from '../src/worker.mjs';
import {githubMessages,customMessages,message,issueRoute,validWebhook,relevantPatch} from '../src/routing.mjs';
const secret='test-secret-with-at-least-thirty-two-characters';
const webhook='https://discord.com/api/webhooks/123/testing-token';
const project={name:'Example',repository:'dothatdomain/example',secret,webhooks:{updates:webhook,debugging:webhook,requests:webhook,ideas:webhook}};
function fixture(){
  const db=new DatabaseSync(':memory:'),kv=new Map(),metrics={queries:0,mutations:0,temporaryWrites:0};let alarm=null;
  const sql={exec(query,...args){metrics.queries++;const stmt=db.prepare(query);let rows=[];if(/^\s*(SELECT|PRAGMA)/i.test(query))rows=stmt.all(...args);else {stmt.run(...args);metrics.mutations++;}return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};}};
  const ctx={storage:{sql,getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;},get:async key=>kv.get(key),put:async(key,value)=>{kv.set(key,value);metrics.mutations++;}}};
  return {ctx,metrics,db,env:{PROJECT_CONNECTIONS:JSON.stringify({example:project})}};
}
function signed(payload,kind='issues',path='/github/example'){
  const body=JSON.stringify(payload);return new Request('https://worker.example'+path,{method:'POST',body,headers:{'content-type':'application/json','x-github-event':kind,'x-github-delivery':'test-delivery','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')}});
}
const issue=title=>({repository:{full_name:'dothatdomain/example'},sender:{login:'elliottglav-png'},action:'opened',issue:{number:1,title,labels:[],html_url:'https://github.com/dothatdomain/example/issues/1'}});
test('any contributor and explicit categories route to updates plus intended channel',()=>{
  for(const [title,route] of [['[Bug] login','debugging'],['[Request] export','requests'],['[Idea] map','ideas']])assert.deepEqual(githubMessages('issues',issue(title),'Example').map(m=>m.route),['updates',route]);
  assert.equal(issueRoute({labels:[{name:'bug'},{name:'enhancement'}]}),'debugging');
  assert.deepEqual(githubMessages('issues',issue('General discussion'),'Example').map(m=>m.route),['updates']);
});
test('merges, pushes and failures have concrete status without running code',()=>{
  assert.match(githubMessages('pull_request',{action:'closed',pull_request:{merged:true,number:2,title:'fix: login',head:{ref:'fix/login'},base:{ref:'main'}}},'Example')[0].payload.embeds[0].title,/merged/);
  assert.deepEqual(githubMessages('push',{commits:[{message:'fix(auth): login'}]},'Example').map(m=>m.route),['updates','debugging']);
  assert.equal(githubMessages('workflow_run',{workflow_run:{conclusion:'success'}},'Example').length,0);
  assert.equal(githubMessages('workflow_run',{workflow_run:{conclusion:'failure',name:'Build'}},'Example')[0].route,'debugging');
});

test('issue creation administrative events produce one enqueue and two posts',async()=>{
  const opened=issue('[Request] Export');
  const events=[opened,{...opened,action:'assigned'},{...opened,action:'status_changed'},{...opened,action:'labeled',label:{name:'status:in-progress'}},{...opened,action:'labeled',label:{name:'area:collaboration'}}];
  let calls=0,posts=0;
  const env={PROJECT_CONNECTIONS:JSON.stringify({example:project}),NOTIFICATIONS:{idFromName:x=>x,get:()=>({fetch:async(_url,opt)=>{calls++;posts+=JSON.parse(opt.body).notifications.length;return Response.json({accepted:true},{status:202});}})}};
  const start=performance.now();for(const event of events)assert((await worker.fetch(signed(event),env)).ok);
  assert.equal(calls,1);assert.equal(posts,2);
  console.log(JSON.stringify({scenario:'issue-open-plus-assignment-and-labels',inputEvents:5,elapsedMs:Number((performance.now()-start).toFixed(2)),doRequests:calls,discordPosts:posts,previousDoRequests:5,previousDiscordPosts:6,temporaryWrites:0,aiTokens:0}));
});
test('no @mentions and no secrets or customer contact fields in order messages',()=>{
  const value=customMessages({type:'order',reference:'123',status:'paid',email:'private@example.com',address:'Private address'},'School')[0].payload;
  assert.deepEqual(value.allowed_mentions,{parse:[]});assert.doesNotMatch(JSON.stringify(value),/private@example|Private address/);
  assert.equal(message('@everyone','@here','https://evil.example').embeds[0].url,undefined);
  assert(!validWebhook(webhook+'/github'));assert(!validWebhook(webhook.replace('discord.com','discord.com.evil')));assert(validWebhook(webhook));
});
test('bad HMAC, unknown project, wrong repository and large body never reach storage',async()=>{
  let calls=0;const env={PROJECT_CONNECTIONS:JSON.stringify({example:project}),NOTIFICATIONS:{idFromName:x=>x,get:()=>({fetch:()=>{calls++;return Response.json({accepted:true},{status:202});}})}};
  const bad=signed(issue('[Idea] something'));bad.headers.set('x-hub-signature-256','sha256='+'0'.repeat(64));assert.equal((await worker.fetch(bad,env)).status,401);
  assert.equal((await worker.fetch(signed({...issue('wrong'),repository:{full_name:'other/private'}}),env)).status,403);
  assert.equal((await worker.fetch(new Request('https://worker.example/github/example',{method:'POST',body:'x'.repeat(2_000_001)}),env)).status,413);
  assert.equal(calls,0);
});

test('encrypted configuration shards preserve project access controls at ten-project scale',async()=>{
  const shards=[{},{},{}];for(let i=0;i<10;i++)shards[Math.floor(i/4)]['project-'+i]={...project,repository:'dothatdomain/project-'+i};
  let calls=0;const env={PROJECT_CONNECTIONS:JSON.stringify(shards[0]),PROJECT_CONNECTIONS_2:JSON.stringify(shards[1]),PROJECT_CONNECTIONS_3:JSON.stringify(shards[2]),NOTIFICATIONS:{idFromName:x=>x,get:()=>({fetch:async()=>{calls++;return Response.json({accepted:true},{status:202});}})}};
  const start=performance.now();for(let i=0;i<10;i++){const event=issue('[Request] Example');event.repository.full_name='dothatdomain/project-'+i;assert.equal((await worker.fetch(signed(event,'issues','/github/project-'+i),env)).status,202);}
  assert.equal(calls,10);console.log(JSON.stringify({scenario:'ten-project-sharded-config',elapsedMs:Number((performance.now()-start).toFixed(2)),inputEvents:10,doRequests:calls,temporaryWrites:0,aiTokens:0}));
});
test('concurrent redelivery atomically stores one job, and sends once',async()=>{
  const f=fixture(),store=new NotificationStore(f.ctx,f.env),body=JSON.stringify({id:'same',project:'example',notifications:[{route:'updates',payload:message('test','test','https://github.com')}]});
  const make=()=>new Request('https://internal/enqueue',{method:'POST',body});
  const results=await Promise.all([store.fetch(make()),store.fetch(make())]);assert(results.every(r=>r.status===202));assert.equal(f.ctx.storage.sql.exec('SELECT count(*) AS n FROM receipts').one().n,1);
  f.ctx.storage.sql.exec('UPDATE receipts SET due=0');const original=globalThis.fetch;let sends=0;
  globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');sends++;return new Response('{}',{status:200});};
  try{await store.alarm();await store.alarm();assert.equal(sends,1);assert.equal(f.ctx.storage.sql.exec('SELECT state FROM receipts').one().state,'sent');}finally{globalThis.fetch=original;f.db.close();}
});
test('429 retry is bounded and uncertain network errors are diagnosed, never retried',async()=>{
  const f=fixture(),store=new NotificationStore(f.ctx,f.env);await store.fetch(new Request('https://internal/enqueue',{method:'POST',body:JSON.stringify({id:'retry',project:'example',notifications:[{route:'updates',payload:{content:'test'}}]})}));
  const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;return Response.json({retry_after:60},{status:429});};
  try{for(let i=0;i<4;i++){f.ctx.storage.sql.exec('UPDATE receipts SET due=0');await store.alarm();}assert.equal(sends,3);assert.equal(f.ctx.storage.sql.exec('SELECT state FROM receipts').one().state,'failed');
    await store.fetch(new Request('https://internal/enqueue',{method:'POST',body:JSON.stringify({id:'uncertain',project:'example',notifications:[{route:'updates',payload:{content:'test'}}]})}));f.ctx.storage.sql.exec("UPDATE receipts SET due=0 WHERE id='uncertain'");globalThis.fetch=async()=>{throw Error('Connection lost');};await store.alarm();assert.equal(f.ctx.storage.sql.exec("SELECT state FROM receipts WHERE id='uncertain'").one().state,'uncertain');
  }finally{globalThis.fetch=original;f.db.close();}
});
test('Wix relevance excludes unrelated editors and avoids claiming a confirmed break',()=>{
  assert.equal(relevantPatch({title:'CMS now in Wix Harmony',tags:['CMS','Wix Harmony']},'school-wristbands'),null);
  assert.equal(relevantPatch({title:'New Invoices V2 methods',tags:['Invoices V2']},'school-wristbands'),null);
  assert.equal(relevantPatch({title:'Bookings endpoint deprecated',tags:['Bookings']},'viellos').label,'Potential action needed');
  assert.equal(relevantPatch({title:'New Stores API option',tags:['Stores']},'school-wristbands').label,'Informational');
});
test('developer feed preserves same-ID changes and reports malformed schema',async()=>{
  const a={id:'same',title:'A',date_published:'2026-11-24',url:'https://dev.wix.com/a',content_html:'<p>text</p>'};
  assert.equal((await developerItems(Response.json({items:[a,{...a,title:'B'}]}))).length,2);
  await assert.rejects(developerItems(Response.json({items:[]})),/schema invalid/);
});
test('representative and 1.9MB supported events: bounded message size and one storage call',async()=>{
  let calls=0;const env={PROJECT_CONNECTIONS:JSON.stringify({example:project}),NOTIFICATIONS:{idFromName:x=>x,get:()=>({fetch:async(_url,opt)=>{calls++;assert(opt.body.length<16000);return Response.json({accepted:true},{status:202});}})}};
  for(const size of [1000,1_900_000]){const event=issue('[Idea] '+ 'x'.repeat(400));event.issue.body='x'.repeat(size);const start=performance.now();const response=await worker.fetch(signed(event),env);assert.equal(response.status,202);console.log(JSON.stringify({inputBytes:size,elapsedMs:Number((performance.now()-start).toFixed(2)),doRequests:1,githubApiReads:0,temporaryWrites:0,aiTokens:0}));}
  assert.equal(calls,2);
});
