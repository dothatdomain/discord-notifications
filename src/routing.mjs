export const MAX_BODY = 2_000_000;
const types = {bug:'debugging',defect:'debugging',debugging:'debugging',idea:'ideas',ideas:'ideas',request:'requests','feature request':'requests',enhancement:'requests',feature:'requests'};
const text = (v,max=500) => String(v ?? '').slice(0,max);
export function message(title,description,url,color=5793266) {
  const embed={title:text(title,240),description:text(description,1800),color};
  try { const u=new URL(url); if(u.protocol==='https:' && ['github.com','dev.wix.com','www.wix.com','support.wix.com','manage.wix.com','status.wix.com'].includes(u.hostname))embed.url=u.href; } catch {}
  return {allowed_mentions:{parse:[]},embeds:[embed]};
}
export function issueRoute(issue) {
  const prefix=String(issue.title||'').match(/^\[(bug|idea|request)\]\s*/i);
  if(prefix)return types[prefix[1].toLowerCase()];
  const labels=new Set((issue.labels||[]).map(label=>String(label.name||'').toLowerCase().trim()));
  return Object.keys(types).map(label=>labels.has(label)?types[label]:null).find(Boolean);
}
export function githubMessages(kind,p,projectName) {
  const actor=text(p.sender?.login||p.pusher?.name||'Contributor',100), repo=p.repository?.full_name||projectName;
  const prefix=projectName||repo;
  const result=[];
  const add=(route,title,body,url,color)=>result.push({route,payload:message(`${prefix} · ${title}`,body,url,color)});
  const change=p.action||'updated';
  if(kind==='ping')return result;
  if(kind==='push') {
    if(p.deleted) return result;
    const commits=(p.commits||[]).slice(-8);
    const body=`${actor} pushed to ${text((p.ref||'').replace('refs/heads/',''),150)}.\n`+commits.map(c=>`• ${text(c.message,180).split('\n')[0]}`).join('\n');
    add('updates',`${Number(p.size??p.commits?.length??0)} commit(s) pushed`,body,p.compare||p.repository?.html_url);
    if(commits.some(c=>/^fix(?:\([^)]*\))?[!:]/i.test(c.message||'')))add('debugging','fix pushed',body,p.compare);
  } else if(kind==='issues') {
    const issue=p.issue||{};
    add('updates',`issue #${issue.number} ${change}`,`${text(issue.title)}\nBy ${actor}`,issue.html_url);
    const route=issueRoute(issue);
    const relevantLabel=change!=='labeled'||types[String(p.label?.name||'').toLowerCase()]===route;
    const relevantEdit=change!=='edited'||p.changes?.title;
    if(route && relevantLabel && relevantEdit && ['opened','reopened','closed','labeled','edited'].includes(change)) {
      const state=change==='closed'&&issue.state_reason==='completed'?'resolved':change;
      add(route,`#${issue.number} ${state}`,`${text(issue.title)}\nBy ${actor}`,issue.html_url,route==='debugging'?15158332:5793266);
    }
  } else if(kind==='pull_request') {
    const pr=p.pull_request||{};
    const state=change==='closed'&&pr.merged?'merged':change;
    add('updates',`PR #${pr.number||p.number} ${state}`,`${text(pr.title)}\n${actor} · ${text(pr.head?.ref,100)} → ${text(pr.base?.ref,100)}`,pr.html_url);
    if(state==='merged' && (/^fix(?:\([^)]*\))?[!:]/i.test(pr.title||'')||issueRoute(pr)==='debugging'))add('debugging',`fix merged · PR #${pr.number}`,text(pr.title),pr.html_url,3066993);
  } else if(['issue_comment','pull_request_review','pull_request_review_comment','commit_comment','discussion_comment'].includes(kind)) {
    if(change==='deleted')return result;
    const item=p.issue||p.pull_request||p.discussion||{};
    const c=p.comment||p.review||{};
    add('updates',kind==='pull_request_review'?`review ${text(c.state,40)}`:'comment added',`${actor} · ${text(item.title||'Repository discussion')}`,c.html_url||item.html_url);
  } else if(kind==='release')add('updates',`release ${change}`,text(p.release?.name||p.release?.tag_name),p.release?.html_url,3066993);
  else if(kind==='discussion')add('updates',`discussion ${change}`,`${text(p.discussion?.title)}\nBy ${actor}`,p.discussion?.html_url);
  else if(kind==='create'||kind==='delete')add('updates',`${text(p.ref_type,30)} ${kind==='create'?'created':'deleted'}`,`${text(p.ref,180)} · ${actor}`,p.repository?.html_url);
  else if(kind==='workflow_run' && ['failure','timed_out','action_required'].includes(p.workflow_run?.conclusion))add('debugging',`workflow ${p.workflow_run.conclusion}`,text(p.workflow_run.name),p.workflow_run.html_url,15158332);
  else if(kind==='check_run' && change==='completed' && ['failure','timed_out','action_required'].includes(p.check_run?.conclusion))add('debugging',`check ${p.check_run.conclusion}`,text(p.check_run.name),p.check_run.html_url,15158332);
  else if(kind==='deployment_status' && ['success','failure','error'].includes(p.deployment_status?.state)) {
    const state=p.deployment_status.state;
    add('updates',`deployment ${state}`,text(p.deployment_status.description||p.deployment?.environment),p.deployment_status.target_url||p.repository?.html_url,state==='success'?3066993:15158332);
    if(state!=='success')add('debugging',`deployment ${state}`,text(p.deployment_status.description),p.deployment_status.target_url||p.repository?.html_url,15158332);
  } else if(['dependabot_alert','code_scanning_alert','repository_advisory'].includes(kind)) {
    const alert=p.alert||p.repository_advisory||{};
    add('security',`security alert ${change}`,text(alert.security_advisory?.summary||alert.rule?.description||alert.summary||'Review this alert in GitHub Security.'),alert.html_url||p.repository?.html_url,15158332);
  }
  return result;
}
export function customMessages(data,name) {
  const type=data.type;
  if(['order','booking'].includes(type))return [{route:type==='order'?'orders':'bookings',payload:message(`${name} · ${type} ${text(data.status||'received',60)}`,`Reference: ${text(data.reference,100)}${data.paymentStatus?'\nPayment: '+text(data.paymentStatus,60):''}`,data.dashboardUrl)}];
  const route=types[type]||(type==='test'?data.route:null);
  if(!['updates','debugging','ideas','requests','wix-patches','security','deployments','orders','bookings'].includes(route))throw Error('Unsupported notification type');
  return [{route,payload:message(`${name} · ${type==='test'?'connection check':text(data.title,180)}`,type==='test'?'This channel is connected. Setup test only.':text(data.description,1500),data.url)}];
}
export async function verifySignature(raw,secret,signature) {
  if(typeof secret!=='string'||secret.length<32||!/^sha256=[0-9a-f]{64}$/.test(signature||''))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.slice(7).match(/../g),hex=>parseInt(hex,16));
  return crypto.subtle.verify('HMAC',key,bytes,raw);
}
export function validWebhook(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&u.hostname==='discord.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/api\/webhooks\/\d+\/[A-Za-z0-9_.-]+$/.test(u.pathname);}catch{return false;}
}
export function relevantPatch(item,project) {
  const tags=(item.tags||[]).join(' ').toLowerCase(), title=String(item.title||'').toLowerCase();
  const content=(title+' '+tags+' '+String(item.summary||'')).toLowerCase();
  if(/harmony|studio two|studio 2|headless|restaurant|rental/.test(title+' '+tags))return null;
  if(/invoices? v2/.test(title+' '+tags))return null;
  const shared=/ecommerce|e-commerce|store|checkout|payment|automation|webhook|member|security|privacy/;
  const specific=project==='viellos'?/booking|calendar|appointment|classic editor|wix editor|legacy form/:/wix studio|studio editor|new form|wix forms|invoice/;
  if(!shared.test(content)&&!specific.test(content))return null;
  const risk=/deprecat|sunset|breaking|removed|discontinu|must migrate|end.of.support/.test(content);
  return {risk,label:risk?'Potential action needed':'Informational',reason:risk?'A potentially incompatible change mentions an installed dependency. Check the linked notice and any deadline; site failure has not been confirmed.':'This release mentions an installed product or shared dependency. Review whether you use the changed feature.'};
}
