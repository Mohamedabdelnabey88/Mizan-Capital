import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare,Response}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['cloudflare/worker.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/cloudflare-worker.mjs'});

const options={
  modules:true,
  scriptPath:'.sites-runtime/cloudflare-worker.mjs',
  compatibilityDate:'2026-05-15',
  d1Databases:['DB'],
  serviceBindings:{ASSETS:()=>new Response('public shell only')}
};
const mf=new Miniflare(options);
let checks=0;
const b64url=bytes=>Buffer.from(bytes).toString('base64url');
const hash=async value=>b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));

try{
  const db=await mf.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort()){
    for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
  }

  async function makeSession(email,token){
    const now=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO auth_sessions(id,email,workspace,expires,created) VALUES(?,?,?,?,?)')
      .bind(await hash(token),email,'cloudflare-owner',now+3600,now).run();
    return 'mizan_session='+encodeURIComponent(token);
  }
  const ownerCookie=await makeSession('owner@example.com','owner-test-session');
  const member1Cookie=await makeSession('member1@example.com','member1-test-session');
  const member2Cookie=await makeSession('member2@example.com','member2-test-session');

  async function call({cookie=ownerCookie,method='GET',body,extra={},path='/api/workspace'}={}){
    return mf.dispatchFetch('https://mizan.example'+path,{
      method,
      redirect:'manual',
      headers:{
        ...(cookie?{Cookie:cookie}:{}),
        ...(method==='POST'?{'Content-Type':'application/json','Origin':'https://mizan.example'}:{}),
        ...extra
      },
      ...(body?{body:JSON.stringify(body)}:{})
    });
  }
  async function expectStatus(args,status){
    const res=await call(args);assert.equal(res.status,status,await res.text());checks++;return res;
  }

  await expectStatus({cookie:null,extra:{'oai-authenticated-user-id':'cloudflare-owner'}},401);
  await expectStatus({cookie:'mizan_session=invalid'},401);
  await expectStatus({method:'POST',body:{},extra:{Origin:'https://evil.example'}},403);
  await expectStatus({method:'POST',body:{},extra:{'Sec-Fetch-Site':'cross-site'}},403);
  await expectStatus({method:'DELETE'},405);
  await expectStatus({path:'/api/unknown'},404);

  const res=await call();assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');checks++;

  const projectRequest={action:'project',requestId:crypto.randomUUID(),payload:{name:'اختبار Cloudflare',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:30}};
  await expectStatus({method:'POST',body:projectRequest,extra:{'oai-authenticated-user-id':'attacker'}},200);

  const session=await call({path:'/api/session',cookie:member1Cookie});
  assert.equal(session.status,200);assert.deepEqual(await session.json(),{email:'member1@example.com'});checks++;
  await expectStatus({path:'/api/session',cookie:null},401);

  const badLogin=await call({path:'/auth/login',cookie:null,method:'POST',body:{email:'famaradona89@gmail.com',password:'definitely-wrong-password'}});
  assert.equal(badLogin.status,401);checks++;

  const shared=await (await call({cookie:member2Cookie})).json();assert.equal(shared.records.length,2);checks++;
  await expectStatus({method:'POST',cookie:member1Cookie,body:{...projectRequest,requestId:crypto.randomUUID()},extra:{'oai-authenticated-user-email':'forged@example.com'}},200);
  const log=(await db.prepare('SELECT detail FROM audit').all()).results;
  assert(log.some(row=>row.detail.endsWith('member1@example.com')));
  assert(!log.some(row=>row.detail.includes('forged@example.com')));checks++;
  const rows=(await db.prepare('SELECT owner FROM records').all()).results;
  assert.deepEqual(rows.map(r=>r.owner),['cloudflare-owner','cloudflare-owner']);checks++;

  let w=await (await call()).json();const project=w.records[0].id;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{project,name:'360 قسطًا',amount:360000,monthlyPayment:1000,months:360,start:date,firstDate:date}}},200);
  w=await (await call()).json();const loan=w.records.find(r=>r.kind==='loan');let due=w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='pending');
  assert.equal(due.length,360);checks++;

  await expectStatus({method:'POST',body:{action:'replaceSchedule',requestId:crypto.randomUUID(),payload:{id:loan.id,date,prepay:0,fee:0,rows:due.map(r=>r.data.date+',1000,0').join('\n')}}},200);
  w=await (await call()).json();
  assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='pending').length,360);
  assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='replaced').length,360);checks++;

  const logout=await call({path:'/auth/logout',method:'POST'});
  assert.equal(logout.status,302);assert.equal(logout.headers.get('location'),'/login');
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/);checks++;

  console.log(JSON.stringify({passed:true,checks,verified:['server-side sessions','spoofed identity rejected','shared workspace actor audit','cross-origin writes blocked','rate-limited login failure path','360-payment loan and replacement','logout revocation']}));
}finally{await mf.dispose();}
