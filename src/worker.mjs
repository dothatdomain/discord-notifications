import {MAX_BODY,githubMessages,customMessages,verifySignature,validWebhook,message,relevantPatch} from './routing.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),n=>n.toString(16).padStart(2,'0')).join('');
// Keep each encrypted value below Cloudflare's 5 KB variable limit.
const config=env=>Object.assign({},...['PROJECT_CONNECTIONS','PROJECT_CONNECTIONS_2','PROJECT_CONNECTIONS_3'].map(key=>JSON.parse(env[key]||'{}')));
const stub=(env,name)=>env.NOTIFICATIONS.get(env.NOTIFICATIONS.idFromName(name));
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')return json({service:'DoThatDomain notifications',ready:Boolean(env.PROJECT_CONNECTIONS),version:1});
    const match=url.pathname.match(/^\/(github|event)\/([a-z0-9-]+)$/);
    if(!match||request.method!=='POST')return json({error:'Not found'},404);
    let projects;try{projects=config(env);}catch{return json({error:'Configuration invalid'},503);}
    const project=projects[match[2]];if(!project)return json({error:'Unknown project'},404);
    const length=Number(request.headers.get('content-length')||0);if(length>MAX_BODY)return json({error:'Event exceeds 2 MB'},413);
    // Bound chunked uploads as well as Content-Length requests.
    const reader=request.body?.getReader();let chunks=[],size=0;
    if(!reader)return json({error:'Missing body'},400);
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return json({error:'Event exceeds 2 MB'},413);}chunks.push(value);}
    const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}chunks=[];
    let notifications,kind,event;
    if(match[1]==='github') {
      if(!await verifySignature(raw,project.secret,request.headers.get('x-hub-signature-256')))return json({error:'Signature invalid'},401);
      try{event=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid JSON'},400);}
      if(event.repository?.full_name!==project.repository)return json({error:'Repository mismatch'},403);
      kind=request.headers.get('x-github-event');notifications=githubMessages(kind,event,project.name);
    } else {
      const credential=request.headers.get('authorization');
      // Compare fixed-size digests; never expose a credential in an error or log.
      if(!project.secret||!credential||await hash(credential)!==await hash('Bearer '+project.secret))return json({error:'Unauthorized'},401);
      try{event=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid JSON'},400);}
      try{notifications=customMessages(event,project.name);}catch{return json({error:'Notification type invalid'},400);}
      kind='custom';
    }
    if(!notifications.length)return json({accepted:true,notifications:0});
    for(const item of notifications){if(!project.webhooks?.[item.route]&&item.route==='security')item.route='debugging';if(!validWebhook(project.webhooks?.[item.route]))return json({error:'Destination missing',route:item.route},503);}
    // Body digest deduplicates signed replay with altered delivery headers as well as GitHub redelivery.
    const id=await hash(new TextEncoder().encode(kind+':'+new TextDecoder().decode(raw)));
    return stub(env,match[2]).fetch('https://internal/enqueue',{method:'POST',body:JSON.stringify({id,project:match[2],notifications})});
  },
  async scheduled(_event,env,ctx){ctx.waitUntil(stub(env,'wix-monitor').fetch('https://internal/monitor',{method:'POST'}));}
};

export class NotificationStore {
  constructor(ctx,env) {
    this.ctx=ctx;this.env=env;this.running=false;
    const sql=ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, project TEXT NOT NULL, payload TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, due INTEGER NOT NULL, expires INTEGER NOT NULL, diagnostic TEXT)');
    sql.exec('CREATE INDEX IF NOT EXISTS receipt_due ON receipts(state,due)');
    sql.exec('CREATE INDEX IF NOT EXISTS receipt_expiry ON receipts(expires)');
  }
  async fetch(request) {
    if(new URL(request.url).pathname==='/monitor')return this.monitor();
    const job=await request.json(),sql=this.ctx.storage.sql,now=Date.now();
    const existing=sql.exec('SELECT state,diagnostic FROM receipts WHERE id=?',job.id).toArray()[0];
    if(existing)return json({accepted:true,duplicate:true,state:existing.state,diagnostic:existing.diagnostic},existing.state==='uncertain'?409:202);
    const queued=sql.exec("SELECT count(*) AS n FROM receipts WHERE state='queued'").one().n;
    if(queued>=1000)return json({error:'Notification queue is full'},429);
    const payload=JSON.stringify(job.notifications);if(payload.length>16000)return json({error:'Notification too large'},413);
    sql.exec("INSERT INTO receipts(id,project,payload,state,due,expires) VALUES (?,?,?,'queued',?,?)",job.id,job.project,payload,now,now+7*86400000);
    const alarm=await this.ctx.storage.getAlarm();if(!alarm||alarm>now+1000)await this.ctx.storage.setAlarm(now+1000);
    return json({accepted:true,notifications:job.notifications.length},202);
  }
  async alarm() {
    if(this.running)return;this.running=true;
    const sql=this.ctx.storage.sql,now=Date.now();
    try {
      // Recover interrupted sends as uncertain, never silently send them twice.
      sql.exec("UPDATE receipts SET state='uncertain',diagnostic='Interrupted send: inspect Discord before manual replay' WHERE state='sending'");
      const jobs=sql.exec("SELECT * FROM receipts WHERE state='queued' AND due<=? ORDER BY due LIMIT 5",now).toArray();
      const projects=config(this.env);
      for(const job of jobs) {
        const items=JSON.parse(job.payload),item=items[job.position];
        const webhook=projects[job.project]?.webhooks?.[item.route];
        if(!validWebhook(webhook)){sql.exec("UPDATE receipts SET state='failed',diagnostic='Destination configuration invalid' WHERE id=?",job.id);continue;}
        sql.exec("UPDATE receipts SET state='sending' WHERE id=?",job.id);
        let response;
        try{response=await fetch(webhook+'?wait=true',{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify(item.payload),signal:AbortSignal.timeout(10000)});}catch(error) {
          const reason=String(error?.message||'Unknown transport error').replace(/https?:\/\/[^\s"'<>]+/g,'[URL redacted]').replace(/[A-Za-z0-9_.-]{40,}/g,'[value redacted]').slice(0,200);
          sql.exec("UPDATE receipts SET state='uncertain',diagnostic=? WHERE id=?",'Transport result uncertain ('+String(error?.name||'Error')+'): '+reason+'; inspect Discord before replay',job.id);continue;
        }
        if(response.ok) {
          await response.arrayBuffer();const position=job.position+1;
          sql.exec('UPDATE receipts SET position=?,attempts=0,state=?,due=? WHERE id=?',position,position===items.length?'sent':'queued',Date.now(),job.id);
        } else if((response.status===429||response.status>=500)&&job.attempts<2) {
          let delay=2000*(job.attempts+1);if(response.status===429){const data=await response.json().catch(()=>({}));delay=Math.min(Math.max(Number(data.retry_after||2)*1000,1000),60000);}else await response.body?.cancel();
          sql.exec("UPDATE receipts SET state='queued',attempts=attempts+1,due=?,diagnostic=? WHERE id=?",Date.now()+delay,'Discord HTTP '+response.status,job.id);
        } else {await response.body?.cancel();sql.exec("UPDATE receipts SET state='failed',diagnostic=? WHERE id=?",'Discord HTTP '+response.status,job.id);}
      }
      sql.exec('DELETE FROM receipts WHERE expires<?',now);
      const next=sql.exec("SELECT min(due) AS due FROM receipts WHERE state='queued'").one().due;
      if(next!==null)await this.ctx.storage.setAlarm(Math.max(next,Date.now()+1000));
      else if(sql.exec('SELECT count(*) AS n FROM receipts').one().n)await this.ctx.storage.setAlarm(Date.now()+86400000);
    }finally{this.running=false;}
  }
  async monitor() {
    const projects=config(this.env);if(!projects.viellos&&!projects['school-wristbands'])return json({skipped:'No Wix projects configured'});
    const started=Date.now();let sourceRequests=0,posts=0,failures=[];
    for(const source of ['developer','platform']) {
      const previous=await this.ctx.storage.get('feed:'+source);
      try {
        sourceRequests++;const response=await fetch(source==='developer'?'https://dev.wix.com/changelog/json':'https://www.wix.com/updates',{headers:previous?.etag?{'if-none-match':previous.etag}:{},signal:AbortSignal.timeout(15000)});
        if(response.status===304)continue;if(!response.ok)throw Error('Source HTTP '+response.status);
        const etag=response.headers.get('etag');
        const items=source==='developer'?await developerItems(response):await platformItems(response);
        const keyed=await Promise.all(items.map(async item=>({item,key:await hash(item.id+'|'+item.date+'|'+item.title),fingerprint:await hash(JSON.stringify(item))})));
        const seen=Object.fromEntries(keyed.map(value=>[value.key,value.fingerprint]));
        if(previous && !keyed.some(value=>previous.seen[value.key]))throw Error('Feed gap: no overlap with previous snapshot; manual review required');
        const changed=previous?keyed.filter(value=>previous.seen[value.key]!==value.fingerprint):[];
        if(changed.length>25)throw Error('More than 25 changed items; manual review required');
        for(const projectKey of ['viellos','school-wristbands']) {
          const project=projects[projectKey];if(!project?.webhooks?.['wix-patches'])continue;
          const relevant=changed.map(({item,key,fingerprint})=>({item,key,fingerprint,impact:relevantPatch(item,projectKey)})).filter(value=>value.impact);
          for(const {item,key,fingerprint,impact} of relevant) {
            const notification={route:'wix-patches',payload:message(`${project.name} · ${impact.label}: ${item.title}`,`${item.summary.slice(0,800)}\n\n${impact.reason}\nSource date: ${item.date}`,item.url,impact.risk?15105570:5793266)};
            const result=await stub(this.env,projectKey).fetch('https://internal/enqueue',{method:'POST',body:JSON.stringify({id:'patch:'+key+':'+fingerprint,project:projectKey,notifications:[notification]})});
            if(!result.ok)throw Error('Notification enqueue failed');posts++;
          }
          if(!previous){await stub(this.env,projectKey).fetch('https://internal/enqueue',{method:'POST',body:JSON.stringify({id:'baseline:'+source,project:projectKey,notifications:[{route:'wix-patches',payload:message(`${project.name} · ${source} updates connected`,'Existing release notes have been baselined. Future relevant changes will appear here, with potential operational risks highlighted.',source==='developer'?'https://dev.wix.com/changelog':'https://www.wix.com/updates')}]})});posts++;}
        }
        if(!previous||JSON.stringify(previous.seen)!==JSON.stringify(seen)||previous.etag!==etag)await this.ctx.storage.put('feed:'+source,{seen,etag,updatedAt:new Date().toISOString()});
      }catch(error){failures.push({source,reason:error.message});console.error(JSON.stringify({monitor:source,error:error.message}));}
    }
    // Monitoring failures are actionable and deduplicated daily without dropping source state.
    for(const failure of failures)for(const projectKey of ['viellos','school-wristbands'])if(projects[projectKey]?.webhooks?.debugging)await stub(this.env,projectKey).fetch('https://internal/enqueue',{method:'POST',body:JSON.stringify({id:'monitor-error:'+sourceDate()+':'+failure.source,project:projectKey,notifications:[{route:'debugging',payload:message(`${projects[projectKey].name} · Wix monitor needs attention`,failure.source+': '+failure.reason,'https://www.wix.com/updates',15158332)}]})});
    const metrics={sourceRequests,queuedNotifications:posts,failures,elapsedMs:Date.now()-started,aiTokens:0};console.log(JSON.stringify({wixMonitor:metrics}));return json(metrics,failures.length?502:200);
  }
}
const sourceDate=()=>new Date().toISOString().slice(0,10);
export async function developerItems(response) {
  const data=await response.json();if(!Array.isArray(data.items)||!data.items.length||data.items.length>200)throw Error('Developer feed schema invalid');
  return data.items.map(item=>{if(!item.id||!item.title||!item.date_published||!item.url)throw Error('Developer item schema invalid');return {id:String(item.id),title:String(item.title).slice(0,300),date:item.date_published,tags:item.tags||[],summary:String(item.content_html||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,2000),url:item.url};});
}
export async function platformItems(response) {
  const cards=[];let current;
  const root='main .wixui-repeater__item[role="listitem"]';
  const parser=new HTMLRewriter().on(root,{element(element){const card={id:element.getAttribute('id')?.split('__').pop(),title:'',paragraphs:[],tags:[],links:[]};current=card;element.onEndTag(()=>{if(card.title.trim())cards.push(card);current=undefined;});}})
    .on(root+' h2',{text(chunk){if(current)current.title+=chunk.text;}})
    .on(root+' p',{element(element){if(!current)return;const paragraph={text:''},card=current;card.paragraphs.push(paragraph);element.onEndTag(()=>{});this.paragraph=paragraph;},text(chunk){if(this.paragraph)this.paragraph.text+=chunk.text;}})
    .on(root+' .wixui-selection-tags input[disabled][checked]',{element(element){if(current)current.tags.push(element.getAttribute('value')||'');}})
    .on(root+' a[href]',{element(element){if(current)current.links.push(element.getAttribute('href'));}});
  await parser.transform(response).arrayBuffer();
  const items=cards.slice(0,150).map(card=>{const dateText=card.paragraphs[0]?.text.trim(),date=Date.parse(dateText);if(!Number.isFinite(date))throw Error('Platform card date invalid');return {id:card.id||card.title,title:card.title.trim().slice(0,300),date:new Date(date).toISOString().slice(0,10),tags:card.tags,summary:card.paragraphs.slice(1).map(p=>p.text.trim()).filter(p=>p&&!/^You are now following this item\./i.test(p)).join(' ').slice(0,2000),url:card.links.find(link=>/support\.wix\.com|dev\.wix\.com/.test(link))||'https://www.wix.com/updates'};});
  if(!items.length)throw Error('Platform release parser found no complete cards');return items;
}
