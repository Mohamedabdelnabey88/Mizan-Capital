import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"import {GET,POST} from './cloudflare/workspace';export default {fetch:(req)=>req.method==='POST'?POST(req):GET(req)}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/installment-worker.mjs'});
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
 const countCash=(workspace,account)=>workspace.journals.flatMap(j=>j.lines).filter(l=>l.project===project&&l.account===account).reduce((s,l)=>s+l.debit-l.credit,0);
 const income=workspace=>-countCash(workspace,'revenue')||0;
 for(let cycle=0;cycle<3;cycle++){
  const requestId=crypto.randomUUID();await post('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'},requestId);
  w=await snapshot();assert.equal(countCash(w,'bank'),1000000);assert.equal(income(w),1000000);
  assert.equal(w.records.find(r=>r.id===due.id).data.status,'paid');
  const journalCount=w.journals.length;await post('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'},requestId);
  assert.equal((await snapshot()).journals.length,journalCount,'retry with same request must not duplicate receipt');
  assert.equal((await call('projectSchedulePayment',{id:due.id,date,paymentAccount:'bank'})).status,400,'second receipt while paid must be rejected');
  await post('undoInstallmentPayment',{id:due.id,date,reason:'تصحيح تحصيل مسجل بالخطأ'});
  w=await snapshot();assert.equal(countCash(w,'bank'),0);assert.equal(income(w),0);
  assert.equal(w.records.find(r=>r.id===due.id).data.status,'pending');
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
 for(const costType of ['construction','expense']){
  await post('projectCommitment',{project,title:'اختبار التزام '+costType,party:'مقاول',totalAmount:500,costType,scheduleType:'once',firstDate:date});
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
 await post('closePeriod',{id:project,date});
 assert.equal((await call('undoInstallmentPayment',{id:due.id,date,reason:'محاولة تراجع بعد الإقفال'})).status,400,'closed periods must remain protected');
 console.log('Installment lifecycle passed: modern/legacy rent, expenses, construction, generic obligations and batch loan repayments; duplicate/concurrent rejection, repeated undo/re-pay and period locks.');
}finally{await mf.dispose();}
