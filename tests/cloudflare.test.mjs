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
  w=await (await call()).json();
  const legacyTenantDue=w.records.find(r=>r.kind==='obligation'&&r.data.tenantLeaseId===tenantLease.id&&r.data.status==='pending');
  const legacyLeaseJournalCount=w.journals.length;
  assert(legacyTenantDue,'legacy tenant rent must be scheduled');
  await expectStatus({method:'POST',body:{action:'projectSchedulePayment',requestId:crypto.randomUUID(),payload:{id:legacyTenantDue.id,date}}},200);
  w=await (await call()).json();
  assert.equal(w.records.find(r=>r.id===legacyTenantDue.id).data.status,'paid');
  assert.equal(w.records.find(r=>r.id===tenantLease.id).data.installments.filter(x=>x.status==='paid').length,1);
  assert.equal(w.journals.length,legacyLeaseJournalCount);checks+=4;
  // Full loan edits correct the receipt and rebuild unpaid installments with reversing journals.
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{name:'قرض قابل للتعديل',amount:12000,monthlyPayment:1100,months:12,start:date,firstDate:nextMonth(date)}}},200);
  w=await (await call()).json();const editableLoan=w.records.find(r=>r.kind==='loan'&&r.data.name==='قرض قابل للتعديل');
  const originalLoanJournal=w.journals.find(j=>j.source==='loan:'+editableLoan.id);
  await expectStatus({method:'POST',body:{action:'editLoan',requestId:crypto.randomUUID(),payload:{id:editableLoan.id,name:'قرض معدل',amount:15000,holder:'personal',project:'__unallocated',fundingMode:'opening',start:date,monthlyPayment:1400,months:12,firstDate:nextMonth(nextMonth(date))}}},200);
  w=await (await call()).json();const editedLoan=w.records.find(r=>r.id===editableLoan.id);
  assert.equal(editedLoan.data.name,'قرض معدل');assert.equal(editedLoan.data.principal,1500000);assert.equal(editedLoan.data.holder,'personal');assert.equal(editedLoan.data.project,'');assert.equal(editedLoan.data.fundingMode,'opening');assert.equal(editedLoan.data.start,date);
  assert(w.journals.some(j=>j.reversal===originalLoanJournal.id),'editing must reverse the old loan receipt journal');
  assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===editableLoan.id&&r.data.status==='cancelled').length,12);
  assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===editableLoan.id&&r.data.status==='pending').length,12);checks+=10;
  // Deleting a loan reverses its receipt, paid installment, allocation and outside-project use.
  const shiftDate=(d,days)=>new Date(Date.parse(d+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{name:'قرض حذف تجريبي',amount:6000,monthlyPayment:2200,months:3,start:shiftDate(date,-90),firstDate:shiftDate(date,-60)}}},200);
  w=await (await call()).json();const deletableLoan=w.records.find(r=>r.kind==='loan'&&r.data.name==='قرض حذف تجريبي');
  await expectStatus({method:'POST',body:{action:'allocateLoanFunds',requestId:crypto.randomUUID(),payload:{loanId:deletableLoan.id,project,amount:1000,paymentAccount:'cash',date}}},200);
  await expectStatus({method:'POST',body:{action:'useLoanFundsOutsideProjects',requestId:crypto.randomUUID(),payload:{loanId:deletableLoan.id,amount:500,paymentAccount:'cash',date,memo:'استخدام مرتبط للاختبار'}}},200);
  w=await (await call()).json();const paidLoanDue=w.records.find(r=>r.kind==='obligation'&&r.data.loan===deletableLoan.id&&r.data.status==='pending');
  const initialDeleteJournal=w.journals.find(j=>j.source==='loan:'+deletableLoan.id);
  await expectStatus({method:'POST',body:{action:'settle',requestId:crypto.randomUUID(),payload:{id:paidLoanDue.id,date,paymentAccount:'cash'}}},200);
  w=await (await call()).json();
  await expectStatus({method:'POST',body:{action:'deleteLoan',requestId:crypto.randomUUID(),payload:{id:deletableLoan.id}}},200);
  w=await (await call()).json();const deletedLoan=w.records.find(r=>r.id===deletableLoan.id);
  assert.equal(deletedLoan.data.status,'deleted');assert(w.journals.some(j=>j.reversal===initialDeleteJournal.id),'deleting must reverse original loan receipt');
  const paidInstallmentJournal=w.journals.find(j=>j.source==='obligation:'+paidLoanDue.id);
  assert(paidInstallmentJournal&&w.journals.some(j=>j.reversal===paidInstallmentJournal.id),'deleting must reverse paid installment');
  assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===deletableLoan.id&&r.data.status==='pending').length,0);
  assert.equal(w.records.filter(r=>(r.kind==='loanAllocation'||r.kind==='loanUse')&&r.data.loanId===deletableLoan.id&&r.data.status!=='cancelled').length,0);checks+=6;
  await expectStatus({method:'POST',body:{action:'editLoan',requestId:crypto.randomUUID(),payload:{id:deletableLoan.id,name:'لا يجب تعديله',amount:6000,monthlyPayment:2200,months:3,start:date,firstDate:nextMonth(date)}}},400);

  // Editing after a paid installment keeps the paid transaction and only rebuilds the remaining principal schedule.
  await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{name:'قرض تعديل بعد سداد',amount:6000,monthlyPayment:2200,months:3,start:shiftDate(date,-90),firstDate:shiftDate(date,-60)}}},200);
  w=await (await call()).json();const partlyPaidLoan=w.records.find(r=>r.kind==='loan'&&r.data.name==='قرض تعديل بعد سداد');
  const firstPaidDue=w.records.find(r=>r.kind==='obligation'&&r.data.loan===partlyPaidLoan.id&&r.data.status==='pending');
  await expectStatus({method:'POST',body:{action:'settle',requestId:crypto.randomUUID(),payload:{id:firstPaidDue.id,date,paymentAccount:'cash'}}},200);
  w=await (await call()).json();
  await expectStatus({method:'POST',body:{action:'editLoan',requestId:crypto.randomUUID(),payload:{id:partlyPaidLoan.id,name:'قرض معدل بعد السداد',amount:6500,holder:'business',project:'__unallocated',fundingMode:'new',start:shiftDate(date,-90),monthlyPayment:2300,months:3,firstDate:nextMonth(date)}}},200);
  w=await (await call()).json();const partlyPaidEdited=w.records.find(r=>r.id===partlyPaidLoan.id);
  const paidPrincipalAfterEdit=w.records.filter(r=>r.kind==='obligation'&&r.data.loan===partlyPaidLoan.id&&r.data.status==='paid').reduce((sum,o)=>sum+Number(o.data.principal||0),0);
  const pendingAfterEdit=w.records.filter(r=>r.kind==='obligation'&&r.data.loan===partlyPaidLoan.id&&r.data.status==='pending');
  assert.equal(partlyPaidEdited.data.principal,650000);assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===partlyPaidLoan.id&&r.data.status==='paid').length,1);assert.equal(pendingAfterEdit.length,2);
  assert.equal(paidPrincipalAfterEdit+pendingAfterEdit.reduce((sum,o)=>sum+Number(o.data.principal||0),0),650000);
  const principalAdjustment=w.journals.find(j=>String(j.source||'').startsWith('loan-edit-adjustment:'+partlyPaidLoan.id+':'));
  assert(principalAdjustment,'principal change after a paid installment must create a balanced adjustment journal');
  await expectStatus({method:'POST',body:{action:'deleteLoan',requestId:crypto.randomUUID(),payload:{id:partlyPaidLoan.id}}},200);
  w=await (await call()).json();assert.equal(w.records.find(r=>r.id===partlyPaidLoan.id).data.status,'deleted');
  assert(w.journals.some(j=>j.reversal===principalAdjustment.id),'loan deletion must reverse principal adjustment entries');checks+=7;

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

  // Project organizer workflow: track costs and schedules without requiring a funding source or creating ledger entries.
  await expectStatus({method:'POST',body:{action:'projectCost',requestId:crypto.randomUUID(),payload:{project,title:'تكلفة تنظيمية تجريبية',amount:2000,date,category:'construction',notes:'بدون مصدر سيولة'}}},200);
  w=await (await call()).json();
  const organizerCost=w.records.find(r=>r.kind==='projectCost'&&r.data.title==='تكلفة تنظيمية تجريبية');
  assert(organizerCost);assert.equal(organizerCost.data.amount,200000);assert.equal(organizerCost.data.project,project);assert.equal(organizerCost.data.notes,'بدون مصدر سيولة');
  const organizerJournalCount=w.journals.length;checks+=4;

  const commitmentFirst=nextMonth(date),commitmentSecond=nextMonth(commitmentFirst);
  await expectStatus({method:'POST',body:{action:'projectCommitment',requestId:crypto.randomUUID(),payload:{project,title:'أقساط مقاول تنظيمية',party:'مقاول تجريبي',totalAmount:3000,installments:commitmentFirst+',1500\n'+commitmentSecond+',1500'}}},200);
  w=await (await call()).json();
  const organizerCommitment=w.records.find(r=>r.kind==='projectCommitment'&&r.data.title==='أقساط مقاول تنظيمية');
  assert(organizerCommitment);assert.equal(organizerCommitment.data.installments.length,2);
  assert.equal(organizerCommitment.data.installments.reduce((sum,x)=>sum+x.amount,0),300000);
  let organizerCommitmentDue=w.records.find(r=>r.kind==='obligation'&&r.data.projectCommitmentId===organizerCommitment.id&&r.data.status==='pending');
  assert(organizerCommitmentDue);assert.equal(organizerCommitmentDue.data.direction,'out');assert.equal(w.journals.length,organizerJournalCount);checks+=6;

  await expectStatus({method:'POST',body:{action:'projectCommitment',requestId:crypto.randomUUID(),payload:{project,title:'قرض بأقساط ربع سنوية',totalAmount:9000,scheduleType:'quarterly',firstDate:commitmentFirst,installmentCount:3}}},200);
  w=await (await call()).json();
  const periodicCommitment=w.records.find(r=>r.kind==='projectCommitment'&&r.data.title==='قرض بأقساط ربع سنوية');
  assert(periodicCommitment);assert.equal(periodicCommitment.data.installments.length,3);
  const commitmentThird=nextMonth(nextMonth(nextMonth(commitmentFirst))),commitmentSixth=nextMonth(nextMonth(nextMonth(commitmentThird)));
  assert.deepEqual(periodicCommitment.data.installments.map(x=>x.date),[commitmentFirst,commitmentThird,commitmentSixth]);
  assert(periodicCommitment.data.installments.every(x=>x.amount===300000));assert.equal(w.journals.length,organizerJournalCount);checks+=4;

  const rentStartDate='2026-01-15';
  await expectStatus({method:'POST',body:{action:'projectTenantLease',requestId:crypto.randomUUID(),payload:{project,title:'عقد مستثمر تجريبي',tenantName:'مستثمر تجريبي',totalAmount:6000,monthlyAmount:2000,startDate:rentStartDate,endDate:nextMonth(nextMonth(rentStartDate)),scheduleType:'monthly',paymentDate:rentStartDate}}},200);
  w=await (await call()).json();
  const organizerLease=w.records.find(r=>r.kind==='projectTenantLease'&&r.data.title==='عقد مستثمر تجريبي');
  assert(organizerLease);assert.equal(organizerLease.data.tenantName,'مستثمر تجريبي');assert.equal(organizerLease.data.endDate,nextMonth(nextMonth(date)));
  const organizerRentDue=w.records.find(r=>r.kind==='obligation'&&r.data.projectTenantLeaseId===organizerLease.id&&r.data.status==='pending');
  assert(organizerRentDue);assert.equal(organizerRentDue.data.direction,'in');assert.equal(w.journals.length,organizerJournalCount);checks+=5;
  // Rent deferral must replace the original scheduled due, merge into the next unpaid installment, and never create cash/revenue journals.
  const rentDeferralDate=nextMonth(organizerRentDue.data.date);
  const nextOrganizerRentDue=w.records.filter(r=>r.kind==='obligation'&&r.data.projectTenantLeaseId===organizerLease.id&&r.data.status==='pending'&&r.id!==organizerRentDue.id&&r.data.date>=rentDeferralDate).sort((a,b)=>a.data.date.localeCompare(b.data.date))[0];
  assert(nextOrganizerRentDue,'a later unpaid rent installment should exist for merge testing');
  const rentAmount=organizerRentDue.data.amount, nextRentAmount=nextOrganizerRentDue.data.amount, rentJournalCount=w.journals.length;
  await expectStatus({method:'POST',body:{action:'deferRentInstallment',requestId:crypto.randomUUID(),payload:{id:organizerRentDue.id,date:rentDeferralDate}}},200);
  w=await (await call()).json();
  const deferredRentDue=w.records.find(r=>r.id===organizerRentDue.id);
  const mergedRentDue=w.records.find(r=>r.id===nextOrganizerRentDue.id);
  const updatedOrganizerLease=w.records.find(r=>r.id===organizerLease.id);
  assert.equal(deferredRentDue.data.status,'replaced');assert.equal(deferredRentDue.data.replacedBy,nextOrganizerRentDue.id);
  assert.equal(mergedRentDue.data.amount,nextRentAmount+rentAmount);assert(mergedRentDue.data.title.includes('قسط مرحّل'));
  assert.equal(updatedOrganizerLease.data.installments.find(x=>x.obligationId===organizerRentDue.id).status,'deferred');
  assert.equal(updatedOrganizerLease.data.installments.find(x=>x.obligationId===organizerRentDue.id).amount,0);
  assert.equal(updatedOrganizerLease.data.installments.find(x=>x.obligationId===nextOrganizerRentDue.id).amount,nextRentAmount+rentAmount);
  assert.equal(w.journals.length,rentJournalCount,'rent deferral must not create a cash or revenue journal');
  await expectStatus({method:'POST',body:{action:'deferRentInstallment',requestId:crypto.randomUUID(),payload:{id:organizerRentDue.id,date:nextMonth(rentDeferralDate)}}},400);
  checks+=9;

  await expectStatus({method:'POST',body:{action:'projectSchedulePayment',requestId:crypto.randomUUID(),payload:{id:organizerCommitmentDue.id,date}}},200);
  w=await (await call()).json();
  assert.equal(w.records.find(r=>r.id===organizerCommitmentDue.id).data.status,'paid');
  assert.equal(w.records.find(r=>r.id===organizerCommitment.id).data.installments.filter(x=>x.status==='paid').length,1);
  assert.equal(w.journals.length,organizerJournalCount);checks+=3;
  await expectStatus({method:'POST',body:{action:'projectSchedulePayment',requestId:crypto.randomUUID(),payload:{id:nextOrganizerRentDue.id,date:nextOrganizerRentDue.data.date}}},200);
  w=await (await call()).json();
  assert.equal(w.records.find(r=>r.id===nextOrganizerRentDue.id).data.status,'paid');
  assert.equal(w.records.find(r=>r.id===organizerLease.id).data.installments.filter(x=>x.status==='paid').length,1);
  const rentCollectionJournal=w.journals.find(j=>j.source==='project-tenant-rent-payment:'+nextOrganizerRentDue.id);
  assert(rentCollectionJournal,'confirmed project rent collection must post to the ledger');
  assert.equal(rentCollectionJournal.lines.reduce((n,l)=>n+l.debit,0),rentCollectionJournal.lines.reduce((n,l)=>n+l.credit,0));
  assert(rentCollectionJournal.lines.some(l=>l.account==='revenue'&&l.credit===nextRentAmount+rentAmount));checks+=5;

  const logout=await call({path:'/auth/logout',method:'POST'});
  assert.equal(logout.status,302);assert.equal(logout.headers.get('location'),'/login');
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/);checks++;
  await expectStatus({path:'/api/session',cookie:ownerCookie},401);

  console.log(JSON.stringify({passed:true,checks,verified:['server-side sessions','spoofed identity rejected','shared workspace actor audit','cross-origin writes blocked','five-attempt login rate limit','360-payment loan and replacement','logout server-side revocation']}));
}finally{await mf.dispose();}
