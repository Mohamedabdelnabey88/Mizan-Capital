
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare}=wr('miniflare');
await build({stdin:{contents:"import {GET,POST} from './cloudflare/workspace';export default {fetch:(req)=>req.method==='POST'?POST(req):GET(req)}",resolveDir:process.cwd(),sourcefile:'test-worker.ts'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/test-worker.mjs'});
await build({entryPoints:['lib/finance.ts','lib/precision.ts'],bundle:true,format:'esm',platform:'node',outdir:'.sites-runtime'});
const f=await import('../.sites-runtime/finance.js');const precision=await import('../.sites-runtime/precision.js');
assert.equal(f.monthAdd('2026-01-31',1),'2026-02-28');assert.equal(f.monthAdd('2028-01-31',1),'2028-02-29');
for(const annual of [0,6,12]){const s=f.loanSchedule(12345678,annual,36,'2026-01-31');assert.equal(s.reduce((n,r)=>n+r.principal,0),12345678);assert.equal(s.at(-1).date,'2028-12-31');assert(s.every(r=>r.amount===r.interest+r.principal));}const exactRate=f.loanRateFromPaymentExact(50000,4244,12);assert(exactRate>3&&exactRate<4);const exactSchedule=f.loanScheduleFromPaymentExact(50000,4244,12,'2026-01-31');assert.equal(exactSchedule.length,12);assert.equal(exactSchedule.at(-1).principal,exactSchedule.reduce((n,r)=>n+r.principal,0)-exactSchedule.slice(0,-1).reduce((n,r)=>n+r.principal,0));assert.equal(exactSchedule.reduce((n,r)=>n+r.principal,0),5000000);
assert.throws(()=>f.validateLines([{project:'a',account:'cash',debit:10,credit:0},{project:'a',account:'capital',debit:0,credit:9}]));
const now=f.today();
const cashFixture={records:[
 {id:'pay',kind:'obligation',version:1,data:{project:'a',status:'pending',date:f.dayAdd(now,1),direction:'out',amount:90000}},
 {id:'receive',kind:'obligation',version:1,data:{project:'a',status:'pending',date:f.dayAdd(now,5),direction:'in',amount:100000}},
],journals:[{id:'cash',date:now,memo:'opening',kind:'capital',lines:[{project:'a',account:'cash',debit:100000,credit:0},{project:'a',account:'capital',debit:0,credit:100000}]}],audit:[]};
const daily=f.forecast(cashFixture,'a',20000);
assert.equal(daily.min,10000);assert.equal(daily.buckets[0].cash,110000);assert.equal(daily.shortfall,10000);assert.equal(daily.firstGap,f.dayAdd(now,1));
assert.equal(f.firstAffordableDate(daily,30000,20000),f.dayAdd(now,5));
assert.equal(f.forecast({records:[],journals:[],audit:[]},'all',100,0,0,100).shortfall,200);
const sameDay=structuredClone(cashFixture);sameDay.records[1].data.date=f.dayAdd(now,1);assert.equal(f.forecast(sameDay,'a',20000).min,10000);
const mf=new Miniflare({modules:true,scriptPath:'.sites-runtime/test-worker.mjs',compatibilityDate:'2026-05-15',d1Databases:['DB']});
try{const db=await mf.getD1Database('DB');for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort()){for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();}
const T=f.today();let checks=0;async function call(action,payload={},owner='test-owner',requestId=crypto.randomUUID()){const res=await mf.dispatchFetch('http://test/api/workspace',{method:'POST',headers:{'content-type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{})},body:JSON.stringify({action,payload,requestId})});return {status:res.status,...await res.json()};}
async function read(owner='test-owner'){const res=await mf.dispatchFetch('http://test/api/workspace',{headers:{'oai-authenticated-user-id':owner}});return res.json();}
async function ok(action,payload,id){const r=await call(action,payload,'test-owner',id);assert.equal(r.status,200,JSON.stringify(r));checks++;return r;}
async function fail(action,payload){const r=await call(action,payload);assert.equal(r.status,400,JSON.stringify(r));checks++;}
assert.equal((await call('project',{},'')).status,401);
await ok('project',{name:'التشغيل',activity:'اختبار',mode:'operating',ownership:100,reserve:1000,payout:30});await ok('project',{name:'الشراكة',activity:'اختبار',mode:'operating',ownership:60,reserve:0,payout:30});let w=await read(),[a,b]=w.records.filter(r=>r.kind==='project').map(r=>r.id);
const key=crypto.randomUUID();await ok('entry',{project:a,kind:'capital',amount:100000,date:T,memo:'رأس مال'},key);await ok('entry',{project:a,kind:'capital',amount:100000,date:T,memo:'رأس مال'},key);w=await read();assert.equal(f.balance(w,a).cash,10000000);assert.equal(w.journals.length,1);assert.equal((await read('other-owner')).journals.length,0);assert.equal((await call('entry',{project:a,kind:'income',amount:1,date:T,memo:'اختبار'},'other-owner')).status,400);
await ok('entry',{project:a,target:b,kind:'transfer',amount:20000,date:T,memo:'تمويل داخلي'});w=await read();assert.equal(f.balance(w).cash,10000000);assert.equal(f.profit(w).net,0);assert.equal(f.balance(w).inter_receivable,-f.balance(w).inter_payable);
assert.equal(f.internalFunding(w,a,b),2000000);
await fail('entry',{project:b,target:a,kind:'repayTransfer',amount:20001,date:T,memo:'رد زائد'});
await ok('entry',{project:b,target:a,kind:'repayTransfer',amount:1000,date:T,memo:'رد جزئي'});
w=await read();assert.equal(f.internalFunding(w,a,b),1900000);assert.equal(f.balance(w).cash,10000000);assert.equal(f.profit(w).net,0);
await fail('entry',{project:a,target:b,kind:'repayTransfer',amount:1,date:T,memo:'اتجاه خاطئ'});
await ok('projectFunding',{project:a,sourceType:'personal',amount:3000,date:T,memo:'رأس مال إضافي مرتبط'});
w=await read();const personalFunding=w.records.find(r=>r.kind==='projectFunding'&&r.data.sourceType==='personal'&&r.data.amount===300000);assert(personalFunding);
await ok('fundingRepayment',{fundingId:personalFunding.id,amount:1000,date:T,memo:'استرداد شخصي جزئي'});
w=await read();let fs=f.projectFundingSummaries(w,a,T).find(x=>x.id===personalFunding.id);assert.equal(fs.repaid,100000);assert.equal(fs.outstanding,200000);assert.equal(Math.round(fs.recoveryPct*100),3333);
assert.equal(f.profit(w,a).net,0);assert.equal((f.balance(w,a).capital||0),9900000);
await ok('projectFunding',{project:b,sourceType:'external',amount:4000,date:T,memo:'تمويل خارجي'});
w=await read();const externalFunding=w.records.find(r=>r.kind==='projectFunding'&&r.data.sourceType==='external'&&r.data.project===b);assert(externalFunding);
await ok('fundingRepayment',{fundingId:externalFunding.id,amount:1500,date:T,memo:'سداد خارجي جزئي'});
w=await read();fs=f.projectFundingSummaries(w,b,T).find(x=>x.id===externalFunding.id);assert.equal(fs.repaid,150000);assert.equal(fs.outstanding,250000);assert.equal(f.profit(w,b).net,0);
await fail('fundingRepayment',{fundingId:externalFunding.id,amount:2501,date:T,memo:'تجاوز'});
assert.equal(f.actualCashFlow(w,b,T,T).rows[0].financingIn,400000);assert.equal(f.actualCashFlow(w,b,T,T).rows[0].financingOut,150000);
await ok('entry',{project:a,kind:'income',amount:10000,date:T,memo:'إيراد'});await fail('entry',{project:a,kind:'distribution',amount:4000,date:T,memo:'فوق الاستحقاق'});
await ok('dailyReport',{project:a,date:T,manager:'مدير الاختبار',gross:10000,channels:{cash:5000,bank:0,mada:5000,visa:0,mastercard:0,receivable:0},memo:'تقرير يومي أول'});
await fail('dailyReport',{project:a,date:T,manager:'مدير الاختبار',gross:10000,channels:{cash:10000},memo:'تقرير مكرر'});
w=await read();const dr=w.records.find(r=>r.kind==='dailyReport'&&r.data.status==='approved');
await ok('dailyReportCorrection',{id:dr.id,manager:'مدير الاختبار',gross:12000,channels:{cash:7000,bank:5000,mada:0,visa:0,mastercard:0,receivable:0},reason:'تصحيح قبض اليوم',reversalDate:T,memo:'تصحيح'});
w=await read();assert.equal(w.records.find(r=>r.id===dr.id).data.status,'corrected');assert.equal(f.balance(w,a).revenue,-2200000);assert.equal(f.balance(w,a).mada||0,0);checks++;
await ok('entry',{project:a,kind:'distribution',amount:2000,date:T,memo:'توزيع'});
await ok('investmentStart',{lender:a,borrower:b,amount:5000,start:T,maturity:f.dayAdd(T,7),expectedReturn:500,memo:'دورة اختبار'});
w=await read();const cycle=w.records.find(r=>r.kind==='investmentCycle'&&r.data.lender===a&&r.data.borrower===b);assert(cycle);
await ok('investmentReturn',{id:cycle.id,date:T,actualReturn:500});w=await read();assert.equal(f.balance(w,b).cash,1850000);assert.equal(f.balance(w,b).interest,50000);assert.equal(f.balance(w,a).dividend,-50000);checks++;
await ok('loan',{project:a,name:'تمويل',amount:12000.12345,monthlyPayment:1100.12345,months:12,start:T,firstDate:f.monthAdd(T,1)});w=await read();const loan=w.records.find(r=>r.kind==='loan'),dues=w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id);assert.equal(dues.length,12);assert.equal(loan.data.principalExact,'12000.12345');assert.equal(loan.data.monthlyPaymentExact,'1100.12345');assert(Number(loan.data.rate)>0);await ok('settle',{id:dues[0].id,date:T});await fail('settle',{id:dues[0].id,date:T});w=await read();assert.equal(f.balance(w,a).loan,-(loan.data.principal-dues[0].data.principal));
w=await read();const pendingLoan= w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id&&r.data.status==='pending');const pendingPrincipal=pendingLoan.reduce((s,r)=>s+r.data.principal,0);await fail('replaceSchedule',{id:loan.id,date:T,prepay:pendingPrincipal+1,fee:0,rows:''});const afterPrepay=pendingPrincipal-100000;const base=Math.floor(afterPrepay/10);let rows=Array.from({length:10},(_,i)=>f.monthAdd(T,i+1)+','+(i===9?afterPrepay-base*9:base)/100+',0').join('\n');await ok('replaceSchedule',{id:loan.id,date:T,prepay:1000,fee:20,rows});w=await read();assert.equal(f.balance(w,a).loan,-(loan.data.principal-dues[0].data.principal-100000));assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id&&r.data.status==='pending').length,10);
const before=f.balance(w,b).cash||0;await ok('loan',{project:b,name:'رصيد قائم',amount:1000,monthlyPayment:100,months:10,start:T,firstDate:f.monthAdd(T,1),fundingMode:'opening'});w=await read();assert.equal(f.balance(w,b).cash||0,before);assert.equal(f.balance(w,b).loan,-100000);
await ok('employee',{project:b,name:'موظف',job:'مساعد',salary:2000,firstDate:'2027-01-31',months:3});w=await read();const emp=w.records.find(r=>r.kind==='employee');assert.deepEqual(w.records.filter(r=>r.data.employee===emp.id).map(r=>r.data.date),['2027-01-31','2027-02-28','2027-03-31']);await ok('renewPayroll',{id:emp.id,salary:2500,months:2});w=await read();assert.deepEqual(w.records.filter(r=>r.data.employee===emp.id).map(r=>r.data.date).sort(),['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31']);await fail('renewPayroll',{id:emp.id,salary:2500,months:1.5});await ok('stopEmployee',{id:emp.id,date:'2027-02-01'});await fail('renewPayroll',{id:emp.id,salary:2500,months:2});w=await read();assert.equal(w.records.filter(r=>r.data.employee===emp.id&&r.data.status==='pending').length,1);
const income=w.journals.find(j=>j.memo==='إيراد');await ok('reverse',{id:income.id,date:T,reason:'تصحيح'});await fail('reverse',{id:income.id,date:T,reason:'مكرر'});w=await read();assert.equal(f.profit(w,a).net,1230008);
await fail('entry',{project:a,kind:'manual',debit:'distribution',credit:'cash',amount:100,date:T,memo:'تجاوز'});
await ok('closePeriod',{id:b,date:T});await fail('entry',{project:b,kind:'income',amount:100,date:T,memo:'فترة مقفلة'});
await ok('project',{name:'تزامن',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:100});w=await read();const cp=w.records.find(r=>r.data.name==='تزامن').id;await ok('entry',{project:cp,kind:'income',amount:10000,date:T,memo:'إيراد للتزامن'});const races=await Promise.all([call('entry',{project:cp,kind:'distribution',amount:7500,date:T,memo:'سحب أول'}),call('entry',{project:cp,kind:'distribution',amount:7500,date:T,memo:'سحب ثان'})]);assert.equal(races.filter(r=>r.status===200).length,1);w=await read();assert.equal(f.balance(w,cp).distribution,750000);assert.equal(f.balance(w,cp).cash,250000);checks++;
await ok('project',{name:'عجز يومي',activity:'اختبار',mode:'operating',ownership:100,reserve:200,payout:100});w=await read();const gapProject=w.records.find(r=>r.data.name==='عجز يومي').id;
await ok('entry',{project:gapProject,kind:'income',amount:1000,date:T,memo:'ربح نقدي'});
await ok('obligation',{project:gapProject,title:'دفع مبكر',amount:900,date:f.dayAdd(T,1),direction:'out',category:'expense'});
await ok('obligation',{project:gapProject,title:'تحصيل لاحق',amount:1000,date:f.dayAdd(T,5),direction:'in',category:'revenue'});
await fail('entry',{project:gapProject,kind:'distribution',amount:1,date:T,memo:'العجز قبل الإيراد'});
await assert.rejects(()=>db.prepare('UPDATE journals SET memo=? WHERE owner=?').bind('corrupt','test-owner').run(),/posted_entry_immutable/);await assert.rejects(()=>db.prepare('DELETE FROM journals WHERE owner=?').bind('test-owner').run(),/posted_entry_immutable/);checks+=2;
w=await read();for(const j of w.journals)f.validateLines(j.lines);const bal=f.balance(w);assert.equal(Object.values(bal).reduce((s,v)=>s+v,0),0);const forecast=f.forecast(w);assert.equal(forecast.buckets.length,13);console.log(JSON.stringify({passed:true,mutationChecks:checks,records:w.records.length,journals:w.journals.length,verified:['identity isolation','balanced journals','idempotency','internal transfers','profit versus cash','loan repayment','early settlement','opening debt','payroll dates','reversal uniqueness','period lock','cash forecast']}));
}finally{await mf.dispose();}
