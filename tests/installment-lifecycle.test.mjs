import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"import {GET,POST} from './cloudflare/workspace';export default {fetch:(req)=>req.method==='POST'?POST(req):GET(req)}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/installment-worker.mjs'});
await build({entryPoints:['lib/dashboard-settlements.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/installment-dashboard.mjs'});
const {dashboardSettlements}=await import('../.sites-runtime/installment-dashboard.mjs');
await build({entryPoints:['lib/installment-payments.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/installment-confirmation.mjs'});
const {confirmedInstallmentUndo}=await import('../.sites-runtime/installment-confirmation.mjs');
const mf=new Miniflare({modules:true,scriptPath:'.sites-runtime/installment-worker.mjs',compatibilityDate:'2026-05-15',d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const headers={'oai-authenticated-user-id':'installment-review','Content-Type':'application/json'};
 const date=new Date().toISOString().slice(0,10);
 const snapshot=async()=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{headers});assert.equal(r.status,200);return r.json();};
 const call=async(action,payload,requestId=crypto.randomUUID())=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{method:'POST',headers,body:JSON.stringify({action,payload,requestId})});return {status:r.status,body:await r.json()};};
 const post=async(action,payload,requestId)=>{const r=await call(action,payload,requestId);assert.equal(r.status,200,action+': '+JSON.stringify(r.body));return r.body;};
 await post('project',{name:'مشروع دورة التحصيل',activity:'تأجير',mode:'operating',ownership:100,reserve:0,payout:30});
 let w=await snapshot();const project=w.records.find(r=>r.kind==='project').id;
 await post('projectTenantLease',{project,title:'عقد يمني',tenantName:'يمني',totalAmount:10000,startDate:date,endDate:date,paymentDate:date,scheduleType:'once'});
 w=await snapshot();const due=w.records.find(r=>r.kind==='obligation'&&r.data.projectTenantLeaseId);
 // Edit contract in place, keep the same due IDs, and never rewrite a paid receipt.
 let editable=w.records.find(r=>r.id===due.data.projectTenantLeaseId);
 const editPayload=()=>({contractId:editable.id,version:editable.version,title:'عقد يمني مصحح',party:'يمني',startDate:date,endDate:date,totalAmount:12000,reason:'تصحيح قيمة الإيجار',rows:[{id:due.id,date,amount:12000}]});
 await post('updateContract',editPayload());
 w=await snapshot();assert.equal(w.records.find(r=>r.id===due.id).data.amount,1200000);assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.projectTenantLeaseId===editable.id).length,1);
 editable=w.records.find(r=>r.id===editable.id);
 await post('updateContract',{...editPayload(),totalAmount:10000,rows:[{id:due.id,date,amount:10000}]});
 w=await snapshot();
 const countCash=(workspace,account)=>workspace.journals.flatMap(j=>j.lines).filter(l=>l.project===project&&l.account===account).reduce((s,l)=>s+l.debit-l.credit,0);
 const income=workspace=>-countCash(workspace,'revenue')||0;
 for(let cycle=0;cycle<3;cycle++){
  const requestId=crypto.randomUUID();await post('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'},requestId);
  w=await snapshot();assert.equal(countCash(w,'bank'),1000000);assert.equal(income(w),1000000);
  assert.equal(w.records.find(r=>r.id===due.id).data.status,'paid');
  editable=w.records.find(r=>r.id===editable.id);
  const paidEdit=await call('updateContract',{...editPayload(),version:editable.version});assert.equal(paidEdit.status,400,'paid amount cannot be silently changed');
  assert.equal((await snapshot()).journals.length,w.journals.length);
  const journalCount=w.journals.length;await post('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'},requestId);
  assert.equal((await snapshot()).journals.length,journalCount,'retry with same request must not duplicate receipt');
  assert.equal((await call('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'})).status,400,'second receipt while paid must be rejected');
  await post('undoInstallmentPayment',{id:due.id,date,reason:'تصحيح تحصيل مسجل بالخطأ'});
  w=await snapshot();assert.equal(countCash(w,'bank'),0);assert.equal(income(w),0);
  assert.equal(w.records.find(r=>r.id===due.id).data.status,'pending');
  assert.equal(confirmedInstallmentUndo(w,due.id,'تصحيح تحصيل مسجل بالخطأ',date),true);assert.equal(confirmedInstallmentUndo(w,due.id,'سبب مختلف',date),false);
  const parent=w.records.find(r=>r.id===due.data.projectTenantLeaseId);assert.equal(parent.data.installments[0].status,'pending');
 }
 await post('projectSchedulePayment',{id:due.id,date,paymentAccount:'cash'});
 w=await snapshot();assert.equal(countCash(w,'cash'),1000000);assert.equal(countCash(w,'bank'),0);assert.equal(income(w),1000000);
 assert.equal(w.journals.filter(j=>j.reversal).length,3,'each undo must retain an auditable reversal');
 // Competing submissions may post only one receipt after a reversal.
 await post('undoInstallmentPayment',{id:due.id,date,reason:'اختبار منع التحصيل المتزامن'});
 const competing=await Promise.all([1,2].map(()=>call('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'})));
 assert.deepEqual(competing.map(r=>r.status).sort(),[200,400]);
 w=await snapshot();assert.equal(income(w),1000000);assert.equal(countCash(w,'bank'),1000000);assert.equal(countCash(w,'cash'),0);
 const activeCount=workspace=>workspace.journals.filter(j=>!j.reversal&&!workspace.journals.some(r=>r.reversal===j.id)).length;
 async function repayTwice(item,action){
  for(let cycle=0;cycle<2;cycle++){
   await post(action==='settleLoansSingle'?'settleLoans':action,action==='settleLoansSingle'?{ids:[item.id],date,paymentAccount:'bank'}:{id:item.id,date,paymentAccount:'bank'});
   const paid=await snapshot();assert.equal(paid.records.find(r=>r.id===item.id).data.status,'paid');
   const count=activeCount(paid);
   await post('undoInstallmentPayment',{id:item.id,date,reason:'مراجعة وإعادة تسجيل الدفعة'});
   const reversed=await snapshot();assert.equal(reversed.records.find(r=>r.id===item.id).data.status,'pending');assert.equal(activeCount(reversed),count-1);
  }
  await post(action==='settleLoansSingle'?'settleLoans':action,action==='settleLoansSingle'?{ids:[item.id],date,paymentAccount:'bank'}:{id:item.id,date,paymentAccount:'bank'});
 }
 // Contract term is explicit, persisted independently of the installment dates, and validated atomically.
 const term={project,title:'مدة عقد مستقلة',costType:'rent',totalAmount:1000,scheduleType:'yearly',firstDate:'2026-11-23',installmentCount:2,startDate:'2026-10-01',endDate:'2028-09-30'};
 const recordCount=(await snapshot()).records.length;
 for(const invalid of [{startDate:''},{endDate:''},{endDate:'2026-09-30'},{firstDate:'2026-09-30'},{endDate:'2027-11-22'},{scheduleType:'custom',installments:'2028-10-01,1000'}]){
  assert.equal((await call('projectCommitment',{...term,...invalid})).status,400);
  assert.equal((await snapshot()).records.length,recordCount,'invalid term must create no contract or obligations');
 }
 await post('projectCommitment',term);
 const dated=(await snapshot()).records.find(r=>r.kind==='projectCommitment'&&r.data.title===term.title);
 assert.equal(dated.data.startDate,'2026-10-01');assert.equal(dated.data.endDate,'2028-09-30');
 assert.deepEqual(dated.data.installments.map(x=>x.date),['2026-11-23','2027-11-23']);
 const amendment={contractId:dated.id,version:dated.version,title:term.title,party:'مالك الأرض',startDate:term.startDate,endDate:term.endDate,totalAmount:1000,reason:'تصحيح جدول العقد',rows:[{id:dated.data.installments[0].obligationId,date:'2026-12-23',amount:400},{id:'',date:'2028-01-23',amount:600}]};
 const journalBeforeEdit=(await snapshot()).journals.length;
 assert.equal((await call('updateContract',{...amendment,totalAmount:900})).status,400);
 assert.equal((await call('updateContract',{...amendment,version:0})).status,400);
 await post('updateContract',amendment);
 const amended=await snapshot();assert.equal(amended.journals.length,journalBeforeEdit,'editing planned dues must not move cash or change posted profit');
 assert.equal(amended.records.find(r=>r.id===dated.data.installments[1].obligationId).data.status,'replaced');
 const activeRows=amended.records.filter(r=>r.kind==='obligation'&&r.data.projectCommitmentId===dated.id&&r.data.status==='pending');assert.equal(activeRows.length,2);assert.equal(activeRows.reduce((s,r)=>s+r.data.amount,0),100000);

 for(const costType of ['construction','expense']){
  await post('projectCommitment',{project,title:'اختبار التزام '+costType,party:'مقاول',startDate:date,endDate:date,totalAmount:500,costType,scheduleType:'once',firstDate:date});
  w=await snapshot();const commitment=w.records.find(r=>r.kind==='projectCommitment'&&r.data.title==='اختبار التزام '+costType);
  await repayTwice(w.records.find(r=>r.kind==='obligation'&&r.data.projectCommitmentId===commitment.id),'projectSchedulePayment');
 }
 await post('obligation',{project,title:'استحقاق عام قابل للتصحيح',amount:100,date,direction:'out',category:'expense',repeat:'once'});
 w=await snapshot();await repayTwice(w.records.find(r=>r.kind==='obligation'&&r.data.title==='استحقاق عام قابل للتصحيح'),'settle');
 await post('propertyUnit',{project,name:'محل عقد قديم',unitType:'retail',operatingMode:'rent',area:40});
 w=await snapshot();const unit=w.records.find(r=>r.kind==='propertyUnit');
 await post('tenantLease',{project,unitId:unit.id,tenantName:'مستأجر وحدة',title:'عقد وحدة',totalAmount:1000,startDate:date,endDate:date,paymentDate:date,scheduleType:'once'});
 w=await snapshot();await repayTwice(w.records.find(r=>r.kind==='obligation'&&r.data.tenantLeaseId),'projectSchedulePayment');
 await post('loan',{project,holder:'business',name:'قرض اختبار إعادة السداد',amount:1000,monthlyPayment:1000,months:1,start:date,firstDate:date});
 w=await snapshot();const loan=w.records.find(r=>r.kind==='loan');await repayTwice(w.records.find(r=>r.kind==='obligation'&&r.data.loan===loan.id),'settleLoansSingle');
 // Calendar's single-payment action must update the same dashboard used by overview.
 await post('loan',{project,holder:'business',name:'قسط 2444 للمطابقة',amount:2000,monthlyPayment:2444,months:1,start:date,firstDate:date});
 w=await snapshot();const bankLoan=w.records.find(r=>r.kind==='loan'&&r.data.name==='قسط 2444 للمطابقة');
 const bankDue=w.records.find(r=>r.kind==='obligation'&&r.data.loan===bankLoan.id);
 assert.equal(bankDue.data.amount,244400);
 const before=dashboardSettlements(w,project,date,date,date);
 await post('settle',{id:bankDue.id,date,paymentAccount:'bank',loanPaymentSource:'liquidity'});
 w=await snapshot();const after=dashboardSettlements(w,project,date,date,date);
 assert.equal(before.remaining-after.remaining,244400,'30-day remaining drops by the entire calendar payment');
 assert.equal(after.paidAmount-before.paidAmount,244400,'paid portion increases by the same payment');
 assert.equal(after.scheduled,before.scheduled,'scheduled = paid + remaining without dropping the installment history');
 assert.equal(after.pending.length,before.pending.length-1);
 assert.equal(after.cashflow.net-before.cashflow.net,-244400,'full installment reduces period cash');
 assert.equal(after.loanCashPaid-before.loanCashPaid,244400);
 assert.equal(after.interestExpense-before.interestExpense,bankDue.data.interest,'only finance cost affects profit');
 assert.equal(w.records.find(r=>r.id===bankDue.id).data.paymentAccount,'bank','single calendar payment preserves receipt metadata');
 await post('undoInstallmentPayment',{id:bankDue.id,date,reason:'اختبار استعادة البطاقات بعد التراجع'});
 const undone=dashboardSettlements(await snapshot(),project,date,date,date);
 for(const key of ['remaining','paidAmount','scheduled','loanCashPaid','interestExpense'])assert.equal(undone[key],before[key],key+' reconciles after undo');
 assert.equal(undone.cashflow.net,before.cashflow.net);
 // Re-paying from personal funds settles the due without reducing project cash.
 await post('settle',{id:bankDue.id,date,loanPaymentSource:'personal'});
 const personal=dashboardSettlements(await snapshot(),project,date,date,date);
 assert.equal(personal.remaining,before.remaining-244400);
 assert.equal(personal.loanCashPaid,before.loanCashPaid);
 assert.equal(personal.cashflow.net,before.cashflow.net);
 await post('closePeriod',{id:project,date});
 assert.equal((await call('undoInstallmentPayment',{id:due.id,date,reason:'محاولة تراجع بعد الإقفال'})).status,400,'closed periods must remain protected');
 console.log('Installment lifecycle passed: modern/legacy rent, expenses, construction, generic obligations and batch loan repayments; duplicate/concurrent rejection, repeated undo/re-pay and period locks.');
}finally{await mf.dispose();}
