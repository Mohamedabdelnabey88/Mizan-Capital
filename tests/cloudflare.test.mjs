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
  await expectStatus({method:'POST',body:{action:'saveReportPeriodPreference',requestId:crypto.randomUUID(),payload:{start:'2026-01-01',end:'2026-12-31'}}},200);
  const preferenceSnapshot=await (await call()).json();
  const savedPeriod=preferenceSnapshot.records.find(r=>r.kind==='appPreference'&&r.data.key==='selectedReportPeriod');
  assert(savedPeriod,'report period preference must persist in the workspace database');
  assert.equal(savedPeriod.data.start,'2026-01-01');assert.equal(savedPeriod.data.end,'2026-12-31');checks+=3;
  await expectStatus({method:'POST',body:{action:'saveReportPeriodPreference',requestId:crypto.randomUUID(),payload:{start:'2026-12-31',end:'2026-01-01'}}},400);
  await expectStatus({method:'POST',body:{action:'saveReportPeriodPreference',requestId:crypto.randomUUID(),payload:{start:'2026-02-01',end:'2026-11-30'}}},200);
  const updatedPreferenceSnapshot=await (await call()).json();
  const savedPeriods=updatedPreferenceSnapshot.records.filter(r=>r.kind==='appPreference'&&r.data.key==='selectedReportPeriod');
  assert.equal(savedPeriods.length,1,'report period preference updates one record instead of duplicating it');
  assert.equal(savedPeriods[0].data.start,'2026-02-01');assert.equal(savedPeriods[0].data.end,'2026-11-30');checks+=3;

  const projectRequest={action:'project',requestId:crypto.randomUUID(),payload:{name:'اختبار Cloudflare',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:30}};
  await expectStatus({method:'POST',body:projectRequest,extra:{'oai-authenticated-user-id':'attacker'}},200);

  const session=await call({path:'/api/session',cookie:member1Cookie});
  assert.equal(session.status,200);assert.deepEqual(await session.json(),{email:'member1@example.com'});checks++;
  await expectStatus({path:'/api/session',cookie:null},401);

  const badLogin=await call({path:'/auth/login',cookie:null,method:'POST',body:{email:'famaradona89@gmail.com',password:'definitely-wrong-password'}});
  assert.equal(badLogin.status,401);checks++;
  // Five failed attempts from the same client/email must lock further attempts in the active window.
  for(let i=0;i<4;i++){
    const failed=await call({path:'/auth/login',cookie:null,method:'POST',body:{email:'famaradona89@gmail.com',password:'definitely-wrong-password'}});
    assert.equal(failed.status,401);checks++;
  }
  const limited=await call({path:'/auth/login',cookie:null,method:'POST',body:{email:'famaradona89@gmail.com',password:'definitely-wrong-password'}});
  assert.equal(limited.status,429);checks++;

  const shared=await (await call({cookie:member2Cookie})).json();assert.equal(shared.records.length,3);checks++;
  await expectStatus({method:'POST',cookie:member1Cookie,body:{...projectRequest,requestId:crypto.randomUUID()},extra:{'oai-authenticated-user-email':'forged@example.com'}},200);
  const log=(await db.prepare('SELECT detail FROM audit').all()).results;
  assert(log.some(row=>row.detail.endsWith('member1@example.com')));
  assert(!log.some(row=>row.detail.includes('forged@example.com')));checks++;
  const rows=(await db.prepare('SELECT owner FROM records').all()).results;
  assert.deepEqual(rows.map(r=>r.owner),['cloudflare-owner','cloudflare-owner','cloudflare-owner','cloudflare-owner','cloudflare-owner']);checks++;

  let w=await (await call()).json();const project=w.records.find(r=>r.kind==='project').id;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const projectRecord=w.records.find(r=>r.id===project);
  await expectStatus({method:'POST',body:{action:'projectSettings',requestId:crypto.randomUUID(),payload:{id:project,version:projectRecord.version,name:projectRecord.data.name,reserve:0,payout:30,expectedNetProfit:'24000',targetPeriod:'annual',expectedReceiptDate:'',expectedReceiptInstallments:[],planEffectiveFrom:date}}},200);
  w=await (await call()).json();
  const annualPlan=w.records.filter(r=>r.kind==='projectPlan'&&r.data.project===project).at(-1);
  assert.equal(annualPlan.data.targetPeriod,'annual');
  assert.equal(annualPlan.data.netTargetMicro,2400000000);
  assert.equal(annualPlan.data.netMonthlyMicro,200000000);checks++;
  const nextMonth=d=>{const x=new Date(d+'T00:00:00Z');x.setUTCMonth(x.getUTCMonth()+1);return x.toISOString().slice(0,10);};
  // Capital-to-asset conversion must create a balanced journal and never overdraw the selected cash account.
  await expectStatus({method:'POST',body:{action:'entry',requestId:crypto.randomUUID(),payload:{project,kind:'capital',amount:10000,date,memo:'رأس مال افتتاحي لاختبار الأصول'}}},200);
  await expectStatus({method:'POST',body:{action:'projectAsset',requestId:crypto.randomUUID(),payload:{project,category:'construction',amount:3000,date,paymentAccount:'cash',description:'دفعة بناء تجريبية'}}},200);
  w=await (await call()).json();
  const projectAsset=w.records.find(r=>r.kind==='projectAsset'&&r.data.project===project);
  assert(projectAsset,'project asset register record must persist');
  assert.equal(projectAsset.data.category,'construction');assert.equal(projectAsset.data.amount,300000);
  const assetJournal=w.journals.find(j=>j.source==='project-asset:'+projectAsset.id);
  assert(assetJournal,'asset conversion journal must be linked to the asset register');
  assert.equal(assetJournal.lines.reduce((n,l)=>n+l.debit,0),assetJournal.lines.reduce((n,l)=>n+l.credit,0));checks+=4;
  await expectStatus({method:'POST',body:{action:'projectAsset',requestId:crypto.randomUUID(),payload:{project,category:'equipment',amount:8000,date,paymentAccount:'cash',description:'يجب رفض تجاوز السيولة'}}},400);
  await expectStatus({method:'POST',body:{action:'projectAsset',requestId:crypto.randomUUID(),payload:{project,category:'equipment',amount:1,date:'2000-01-01',paymentAccount:'cash',description:'يجب رفض استخدام سيولة مستقبلية'}}},400);
  // Rental units and tenant contracts create dated receivables/income obligations and reject overlapping contracts.
  await expectStatus({method:'POST',body:{action:'propertyUnit',requestId:crypto.randomUUID(),payload:{project,name:'محل اختبار 1',unitType:'retail',operatingMode:'rent',area:40}}},200);
  w=await (await call()).json();const unit=w.records.find(r=>r.kind==='propertyUnit'&&r.data.name==='محل اختبار 1');assert(unit,'property unit must persist');
  const leaseEnd=nextMonth(nextMonth(date));
  await expectStatus({method:'POST',body:{action:'tenantLease',requestId:crypto.randomUUID(),payload:{project,unitId:unit.id,tenantName:'مستأجر تجريبي',title:'عقد تجريبي',totalAmount:12000,startDate:date,endDate:leaseEnd,scheduleType:'monthly',paymentDate:date}}},200);
  w=await (await call()).json();const tenantLease=w.records.find(r=>r.kind==='tenantLease'&&r.data.unitId===unit.id);
  assert(tenantLease,'tenant lease must persist');assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.tenantLeaseId===tenantLease.id).length,3);
  await expectStatus({method:'POST',body:{action:'tenantLease',requestId:crypto.randomUUID(),payload:{project,unitId:unit.id,tenantName:'مستأجر آخر',title:'عقد متداخل',totalAmount:12000,startDate:date,endDate:leaseEnd,scheduleType:'monthly',paymentDate:date}}},400);
  // Editing a loan only regenerates unpaid installments; original principal receipt remains unchanged.
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{name:'قرض قابل للتعديل',amount:12000,monthlyPayment:1100,months:12,start:date,firstDate:nextMonth(date)}}},200);
  w=await (await call()).json();const editableLoan=w.records.find(r=>r.kind==='loan'&&r.data.name==='قرض قابل للتعديل');
  await expectStatus({method:'POST',body:{action:'editLoan',requestId:crypto.randomUUID(),payload:{id:editableLoan.id,name:'قرض معدل',monthlyPayment:1200,months:12,firstDate:nextMonth(nextMonth(date))}}},200);
  w=await (await call()).json();const editedLoan=w.records.find(r=>r.id===editableLoan.id);
  assert.equal(editedLoan.data.name,'قرض معدل');
  assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===editableLoan.id&&r.data.status==='cancelled').length,12);
  assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===editableLoan.id&&r.data.status==='pending').length,12);checks+=4;
  const repeatStart=nextMonth(date),repeatEnd=nextMonth(nextMonth(repeatStart));
  await expectStatus({method:'POST',body:{action:'obligation',requestId:crypto.randomUUID(),payload:{project,title:'تحصيل شهري تجريبي',amount:2000,date:repeatStart,repeat:'monthly',repeatEnd,direction:'in',category:'revenue',certainty:100}}},200);
  w=await (await call()).json();
  const repeated=w.records.filter(r=>r.kind==='obligation'&&r.data.title==='تحصيل شهري تجريبي');
  assert.equal(repeated.length,3);
  assert.deepEqual(repeated.map(r=>r.data.date),[repeatStart,nextMonth(repeatStart),repeatEnd]);
  assert(repeated.every(r=>r.data.amount===200000));
  assert(!w.journals.some(j=>j.memo.includes('تحصيل شهري تجريبي')));checks+=4;
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{project,name:'360 قسطًا',amount:360000,monthlyPayment:1000,months:360,start:date,firstDate:date}}},200);
  w=await (await call()).json();const loan=w.records.find(r=>r.kind==='loan'&&r.data.name==='360 قسطًا');let due=w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id&&r.data.status==='pending');
  assert.equal(due.length,360);checks++;

  await expectStatus({method:'POST',body:{action:'replaceSchedule',requestId:crypto.randomUUID(),payload:{id:loan.id,date,prepay:0,fee:0,rows:due.map(r=>r.data.date+',1000,0').join('\n')}}},200);
  w=await (await call()).json();
  assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='pending').length,360);
  assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='replaced').length,360);checks++;

  const logout=await call({path:'/auth/logout',method:'POST'});
  assert.equal(logout.status,302);assert.equal(logout.headers.get('location'),'/login');
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/);checks++;
  await expectStatus({path:'/api/session',cookie:ownerCookie},401);

  console.log(JSON.stringify({passed:true,checks,verified:['server-side sessions','spoofed identity rejected','shared workspace actor audit','cross-origin writes blocked','five-attempt login rate limit','360-payment loan and replacement','logout server-side revocation']}));
}finally{await mf.dispose();}
