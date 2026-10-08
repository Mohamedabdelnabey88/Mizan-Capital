
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
const T=f.today();let checks=0;const fiscalFixture={records:[
 {id:'fy',kind:'fiscalYear',version:1,data:{start:'2026-04-01',end:'2027-03-31',label:'سنة مالية اختبارية'}},
 {id:'p',kind:'project',version:1,data:{name:'Fiscal',mode:'operating',ownership:100}},
],journals:[
 {id:'j1',date:'2026-05-01',memo:'داخل السنة',kind:'income',lines:[{project:'p',account:'cash',debit:100000,credit:0},{project:'p',account:'revenue',debit:0,credit:100000}]},
 {id:'j2',date:'2027-02-01',memo:'داخل السنة',kind:'expense',lines:[{project:'p',account:'expense',debit:20000,credit:0},{project:'p',account:'cash',debit:0,credit:20000}]},
 {id:'j3',date:'2027-04-01',memo:'خارج السنة',kind:'income',lines:[{project:'p',account:'cash',debit:50000,credit:0},{project:'p',account:'revenue',debit:0,credit:50000}]}
],audit:[]};
const fy=f.fiscalYearForDate(fiscalFixture,'2026-06-01');assert.equal(fy.start,'2026-04-01');assert.equal(fy.end,'2027-03-31');assert.equal(f.profit(fiscalFixture,'p',fy.start,fy.end).net,80000);assert.equal(f.yearlyProfit(fiscalFixture,2026,'p'),80000);checks+=4;const controls=f.accountingControlTotals(fiscalFixture,fy.start,fy.end,'p');assert.equal(controls.balanceCheck,0);assert.equal(controls.profitNet,80000);assert.equal(controls.profitDelta,80000);assert.equal(controls.cashFromBalance,80000);assert.equal(controls.cashFlowClosing,80000);assert.equal(controls.cashFlowDifference,0);checks+=6;
const traced=f.traceTransaction(fiscalFixture,'j1');assert.equal(traced.profitDelta,100000);assert.equal(traced.cashDelta,100000);assert.equal(traced.project,'p');checks+=3;
async function call(action,payload={},owner='test-owner',requestId=crypto.randomUUID()){const res=await mf.dispatchFetch('http://test/api/workspace',{method:'POST',headers:{'content-type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{})},body:JSON.stringify({action,payload,requestId})});return {status:res.status,...await res.json()};}
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
w=await read();const fundingFixture={records:[personalFunding,...w.records.filter(r=>r.kind==='fundingRepayment'&&r.data.fundingId===personalFunding.id)],journals:[],audit:[]};const fixtureSummary=f.projectFundingSummaries(fundingFixture,'all','9999-12-31').find(x=>x.id===personalFunding.id);assert(fixtureSummary,JSON.stringify(fundingFixture));const personalSummaries=f.projectFundingSummaries(w,personalFunding.data.project,'9999-12-31');assert(personalSummaries.some(x=>x.id===personalFunding.id),JSON.stringify({funding:personalFunding,records:w.records.filter(r=>r.kind==='projectFunding')}));let personalSummary=personalSummaries.find(x=>x.id===personalFunding.id);assert.equal(personalSummary.repaid,100000);assert.equal(personalSummary.outstanding,200000);assert.equal(Math.round(personalSummary.recoveryPct*100),3333);
assert.equal(f.profit(w,a).net,0);assert.equal((f.balance(w,a).capital||0),-10200000);
await ok('projectFunding',{project:b,sourceType:'external',amount:4000,date:T,memo:'تمويل خارجي'});
w=await read();const externalFunding=w.records.find(r=>r.kind==='projectFunding'&&r.data.sourceType==='external'&&r.data.project===b);assert(externalFunding);
await ok('fundingRepayment',{fundingId:externalFunding.id,amount:1500,date:T,memo:'سداد خارجي جزئي'});
w=await read();let externalSummary=f.projectFundingSummaries(w,b,T).find(x=>x.id===externalFunding.id);assert.equal(externalSummary.repaid,150000);assert.equal(externalSummary.outstanding,250000);assert.equal(f.profit(w,b).net,0);
await fail('fundingRepayment',{fundingId:externalFunding.id,amount:2501,date:T,memo:'تجاوز'});
assert.equal(f.actualCashFlow(w,b,T,T).rows[0].financingIn,400000);assert.equal(f.actualCashFlow(w,b,T,T).rows[0].financingOut,150000);
await ok('entry',{project:a,kind:'income',amount:10000,date:T,memo:'إيراد'});await fail('entry',{project:a,kind:'distribution',amount:4000,date:T,memo:'فوق الاستحقاق'});
await ok('dailyReport',{project:a,date:T,manager:'مدير الاختبار',gross:10000,channels:{cash:5000,bank:0,mada:5000,visa:0,mastercard:0,receivable:0},memo:'تقرير يومي أول'});
await fail('dailyReport',{project:a,date:T,manager:'مدير الاختبار',gross:10000,channels:{cash:10000},memo:'تقرير مكرر'});
w=await read();const dr=w.records.find(r=>r.kind==='dailyReport'&&r.data.status==='approved');
await ok('dailyReportCorrection',{id:dr.id,manager:'مدير الاختبار',gross:12000,channels:{cash:7000,bank:5000,mada:0,visa:0,mastercard:0,receivable:0},reason:'تصحيح قبض اليوم',reversalDate:T,memo:'تصحيح'});
w=await read();assert.equal(w.records.find(r=>r.id===dr.id).data.status,'corrected');assert.equal(f.balance(w,a).revenue,-2200000);assert.equal(f.balance(w,a).mada||0,0);checks++;

// Stage 3 payment-channel, card-settlement, tax, receivable/expense settlement and precision controls.
await ok('dailyReport',{project:b,date:T,manager:'مدير القنوات',gross:6000,channels:{cash:1000,bank:1000,mada:1000,visa:1000,mastercard:1000,receivable:1000},memo:'اختبار جميع قنوات التحصيل'});
w=await read();
assert.equal(f.balance(w,b).cash,2250000);
assert.equal(f.balance(w,b).bank,100000);
assert.equal(f.balance(w,b).mada,100000);
assert.equal(f.balance(w,b).visa,100000);
assert.equal(f.balance(w,b).mastercard,100000);
assert.equal(f.balance(w,b).receivable,100000);
assert.equal(f.profit(w,b).net,600000);
await ok('settleCards',{project:b,fromAccount:'mada',toAccount:'bank',amount:1000,date:T});
await ok('settleCards',{project:b,fromAccount:'visa',toAccount:'bank',amount:1000,date:T});
await ok('settleCards',{project:b,fromAccount:'mastercard',toAccount:'bank',amount:1000,date:T});
w=await read();
assert.equal(f.balance(w,b).mada,0);
assert.equal(f.balance(w,b).visa,0);
assert.equal(f.balance(w,b).mastercard,0);
assert.equal(f.balance(w,b).bank,400000);
assert.equal(f.profit(w,b).net,600000);
await ok('entry',{project:b,kind:'collect',amount:1000,date:T,memo:'تحصيل آجل'});
w=await read();
assert.equal(f.balance(w,b).receivable,0);
assert.equal(f.balance(w,b).cash,2350000);
assert.equal(f.profit(w,b).net,600000);

await ok('setTaxPolicy',{enabled:true,rate:15,defaultMode:'exclusive',salesTax:true,purchaseTax:true,effectiveFrom:T});
await ok('entry',{project:a,kind:'income',amount:1000,date:T,taxMode:'exclusive',taxRate:15,memo:'إيراد خاضع للضريبة'});
await ok('entry',{project:a,kind:'expense',amount:500,date:T,taxMode:'exclusive',taxRate:15,memo:'مصروف خاضع للضريبة'});
w=await read();
const taxBalance=f.balance(w,a);
assert.equal(taxBalance.tax_payable,-15000);
assert.equal(taxBalance.tax_receivable,7500);
const taxProfitBefore=f.profit(w,a).net;
const taxRevenueTrace=w.journals.find(j=>j.memo==='إيراد خاضع للضريبة');
const taxExpenseTrace=w.journals.find(j=>j.memo==='مصروف خاضع للضريبة');
assert.equal(f.traceTransaction(w,taxRevenueTrace.id).profitDelta,100000);
assert.equal(f.traceTransaction(w,taxExpenseTrace.id).profitDelta,-50000);
assert.equal(f.profit(w,a).net,taxProfitBefore);
const taxTrace=w.journals.find(j=>j.memo==='إيراد خاضع للضريبة');
assert(taxTrace.lines.some(l=>l.account==='tax_payable'&&l.credit===15000));
const taxExpense=w.journals.find(j=>j.memo==='مصروف خاضع للضريبة');
assert(taxExpense.lines.some(l=>l.account==='tax_receivable'&&l.debit===7500));
checks+=14;

const obligationBefore=w.journals.length;
await ok('obligation',{project:a,title:'مصروف تشغيلي مؤجل',amount:3000,date:T,direction:'out',category:'expense',certainty:100});
w=await read();
const due=w.records.find(r=>r.kind==='obligation'&&r.data.title==='مصروف تشغيلي مؤجل');
assert(due&&due.data.status==='pending');
assert.equal(w.journals.length,obligationBefore+1);
await ok('settle',{id:due.id,date:T});
w=await read();
assert.equal(w.journals.length,obligationBefore+2);
const settledExpenseTrace=w.journals.find(j=>j.source==='obligation:'+due.id);
assert(settledExpenseTrace);
assert.equal(f.traceTransaction(w,settledExpenseTrace.id).profitDelta,0);
assert.equal(f.actualCashFlow(w,a,T,T).rows.at(-1).operatingOut>=300000,true);
await fail('settle',{id:due.id,date:T});
// An obligation created for a future date must accrue when that date arrives, on the next write, exactly once.
await ok('obligation',{project:a,title:'استحقاق يحين لاحقًا',amount:2000,date:f.dayAdd(T,1),direction:'out',category:'expense',certainty:100});
w=await read();const delayed=w.records.find(r=>r.kind==='obligation'&&r.data.title==='استحقاق يحين لاحقًا');assert(delayed);assert.equal(w.journals.some(j=>j.source==='obligation-accrual:'+delayed.id),false);
await db.prepare("UPDATE records SET data=json_set(data,'$.date',?) WHERE id=? AND owner=?").bind(T,delayed.id,'test-owner').run();
await ok('project',{name:'محفز ترحيل الاستحقاق',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:0});
w=await read();assert.equal(w.journals.filter(j=>j.source==='obligation-accrual:'+delayed.id).length,1);
const delayedBeforeProfit=f.profit(w,a).net;await ok('settle',{id:delayed.id,date:T});w=await read();assert.equal(w.journals.filter(j=>j.source==='obligation-accrual:'+delayed.id).length,1);const delayedSettlement=w.journals.find(j=>j.source==='obligation:'+delayed.id);assert(delayedSettlement);assert.equal(f.traceTransaction(w,delayedSettlement.id).profitDelta,0);assert.equal(f.profit(w,a).net,delayedBeforeProfit);
checks+=13;

// Five-decimal inputs must remain exact through the 5-decimal planning path.
await ok('project',{name:'دقة 5 منازل',activity:'اختبار دقة',mode:'operating',ownership:100,reserve:0,payout:0,expectedMonthlyRevenue:'12345.67891',expectedMonthlyExpense:'1.23456',expectedNetMonthly:'12344.44435'});
w=await read();
const precisionProject=w.records.find(r=>r.kind==='project'&&r.data.name==='دقة 5 منازل');
assert(precisionProject);
assert.equal(precisionProject.data.planMonthlyRevenueMicro,1234567891);
assert.equal(precisionProject.data.planMonthlyExpenseMicro,123456);
assert.equal(precisionProject.data.planNetMonthlyMicro,1234444435);
checks+=4;
await ok('entry',{project:a,kind:'distribution',amount:2000,date:T,memo:'توزيع'});
await fail('investmentStart',{lender:a,borrower:b,amount:99999999,start:T,maturity:f.dayAdd(T,7),expectedReturn:500,memo:'اختبار منع تمويل يتجاوز السيولة'});
await ok('investmentStart',{lender:a,borrower:b,amount:5000,start:T,maturity:f.dayAdd(T,7),expectedReturn:500,memo:'دورة اختبار'});
w=await read();const cycle=w.records.find(r=>r.kind==='investmentCycle'&&r.data.lender===a&&r.data.borrower===b);assert(cycle);
await ok('investmentReturn',{id:cycle.id,date:T,actualReturn:500});w=await read();assert.equal(f.balance(w,b).cash,2300000);assert.equal(f.balance(w,b).interest,50000);assert.equal(f.balance(w,a).dividend,-50000);checks++;
await ok('loan',{project:a,name:'تمويل',amount:12000.12345,monthlyPayment:1100.12345,months:12,start:T,firstDate:f.monthAdd(T,1)});w=await read();const loan=w.records.find(r=>r.kind==='loan'),dues=w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id);assert.equal(dues.length,12);assert.equal(loan.data.principalExact,'12000.12345');assert.equal(loan.data.monthlyPaymentExact,'1100.12345');assert(Number(loan.data.rate)>0);const bankBeforeLoanSettle=f.balance(w,a).bank||0;await ok('settle',{id:dues[0].id,date:T,paymentAccount:'bank'});await fail('settle',{id:dues[0].id,date:T,paymentAccount:'bank'});w=await read();assert.equal(f.balance(w,a).loan,-(loan.data.principal-dues[0].data.principal));assert.equal(f.balance(w,a).bank,bankBeforeLoanSettle-dues[0].data.amount);
w=await read();const pendingLoan= w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id&&r.data.status==='pending');const pendingPrincipal=pendingLoan.reduce((s,r)=>s+r.data.principal,0);await fail('replaceSchedule',{id:loan.id,date:T,prepay:pendingPrincipal+1,fee:0,rows:''});const afterPrepay=pendingPrincipal-100000;const base=Math.floor(afterPrepay/10);let rows=Array.from({length:10},(_,i)=>f.monthAdd(T,i+1)+','+(i===9?afterPrepay-base*9:base)/100+',0').join('\n');const bankBeforePrepay=f.balance(w,a).bank||0;await ok('replaceSchedule',{id:loan.id,date:T,prepay:1000,fee:20,paymentAccount:'bank',rows});w=await read();assert.equal(f.balance(w,a).loan,-(loan.data.principal-dues[0].data.principal-100000));assert.equal(f.balance(w,a).bank,bankBeforePrepay-102000);assert.equal(w.records.filter(r=>r.kind==='obligation'&&r.data.loan===loan.id&&r.data.status==='pending').length,10);
const before=f.balance(w,b).cash||0;await ok('loan',{project:b,name:'رصيد قائم',amount:1000,monthlyPayment:100,months:10,start:T,firstDate:f.monthAdd(T,1),fundingMode:'opening'});w=await read();assert.equal(f.balance(w,b).cash||0,before);assert.equal(f.balance(w,b).loan,-100000);
await ok('employee',{project:b,name:'موظف',job:'مساعد',salary:2000,firstDate:'2027-01-31',months:3});
w=await read();const empToDelete=w.records.find(r=>r.kind==='employee'&&r.data.name==='موظف');assert(empToDelete);assert.equal(w.records.filter(r=>r.data.employee===empToDelete.id).length,3);await ok('deleteEmployee',{id:empToDelete.id});w=await read();assert.equal(w.records.some(r=>r.id===empToDelete.id),false);assert.equal(w.records.some(r=>r.data.employee===empToDelete.id),false);
await ok('employee',{project:b,name:'موظف',job:'مساعد',salary:2000,firstDate:'2027-01-31',months:3});w=await read();const emp=w.records.find(r=>r.kind==='employee');assert.deepEqual(w.records.filter(r=>r.data.employee===emp.id).map(r=>r.data.date),['2027-01-31','2027-02-28','2027-03-31']);await ok('renewPayroll',{id:emp.id,salary:2500,months:2});w=await read();assert.deepEqual(w.records.filter(r=>r.data.employee===emp.id).map(r=>r.data.date).sort(),['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31']);await fail('renewPayroll',{id:emp.id,salary:2500,months:1.5});await ok('stopEmployee',{id:emp.id,date:'2027-02-01'});await fail('renewPayroll',{id:emp.id,salary:2500,months:2});w=await read();assert.equal(w.records.filter(r=>r.data.employee===emp.id&&r.data.status==='pending').length,1);
const income=w.journals.find(j=>j.memo==='إيراد');const profitBeforeReverse=f.profit(w,a).net;await ok('reverse',{id:income.id,date:T,reason:'تصحيح'});await fail('reverse',{id:income.id,date:T,reason:'مكرر'});w=await read();assert.equal(f.profit(w,a).net,profitBeforeReverse-1000000);
await fail('entry',{project:a,kind:'manual',debit:'distribution',credit:'cash',amount:100,date:T,memo:'تجاوز'});

await ok('project',{name:'تزامن',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:100});w=await read();const cp=w.records.find(r=>r.data.name==='تزامن').id;await ok('entry',{project:cp,kind:'income',amount:10000,date:T,memo:'إيراد للتزامن'});const races=await Promise.all([call('entry',{project:cp,kind:'distribution',amount:7500,date:T,memo:'سحب أول'}),call('entry',{project:cp,kind:'distribution',amount:7500,date:T,memo:'سحب ثان'})]);assert.equal(races.filter(r=>r.status===200).length,1);w=await read();assert.equal(f.balance(w,cp).distribution,750000);assert.equal(f.balance(w,cp).cash,250000);checks++;
await ok('deleteProject',{id:cp,confirmName:'تزامن',reason:'تنظيف fixture التزامن قبل اختبار توزيع المالك'});
await ok('project',{name:'عجز يومي',activity:'اختبار',mode:'operating',ownership:100,reserve:200,payout:100});w=await read();const gapProject=w.records.find(r=>r.data.name==='عجز يومي').id;
await ok('entry',{project:gapProject,kind:'income',amount:1000,date:T,memo:'ربح نقدي'});
await ok('obligation',{project:gapProject,title:'دفع مبكر',amount:900,date:'2026-10-09',direction:'out',category:'expense'});
await ok('obligation',{project:gapProject,title:'تحصيل لاحق',amount:1000,date:f.dayAdd(T,5),direction:'in',category:'revenue'});
await fail('entry',{project:gapProject,kind:'distribution',amount:1,date:T,memo:'العجز قبل الإيراد'});
await assert.rejects(()=>db.prepare('UPDATE journals SET memo=? WHERE owner=?').bind('corrupt','test-owner').run(),/posted_entry_immutable/);await assert.rejects(()=>db.prepare('DELETE FROM journals WHERE owner=?').bind('test-owner').run(),/posted_entry_immutable/);checks+=2;
await ok('deleteProject',{id:gapProject,confirmName:'عجز يومي',reason:'تنظيف fixture التوقعات قبل اختبار توزيع المالك'});
// Funding correction: canceling a mistaken funding must reverse its journal, preserve audit history, and restore balances.
await ok('projectFunding',{project:a,sourceType:'personal',amount:1234.56,date:T,memo:'تمويل تجريبي خاطئ'});
w=await read();
const mistaken=w.records.find(r=>r.kind==='projectFunding'&&r.data.memo==='تمويل تجريبي خاطئ');
assert(mistaken);
const beforeCancel=f.balance(w,a);
const originalFundingJournal=w.journals.find(j=>j.source==='projectFunding:'+mistaken.id);
assert(originalFundingJournal);
const profitBeforeCancel=f.profit(w,a).net;
await ok('cancelFunding',{id:mistaken.id,date:T,reason:'تصحيح بيانات اختبار'});
w=await read();
const cancelled=w.records.find(r=>r.id===mistaken.id);
assert.equal(cancelled.data.status,'cancelled');
const reversal=w.journals.find(j=>j.reversal===originalFundingJournal.id);
assert(reversal);
assert.equal(f.balance(w,a).cash,beforeCancel.cash-mistaken.data.amount);
assert.equal(f.balance(w,a).capital,beforeCancel.capital+mistaken.data.amount);
assert.equal(f.profit(w,a).net,profitBeforeCancel);
assert.equal(f.projectFundingSummaries(w,a).some(x=>x.id===mistaken.id),false);
await fail('cancelFunding',{id:mistaken.id,date:T,reason:'محاولة ثانية'});
await ok('projectFunding',{project:a,sourceType:'personal',amount:500,date:T,memo:'تمويل تجريبي مع استرداد'});
w=await read();
const repFunding=w.records.find(r=>r.kind==='projectFunding'&&r.data.memo==='تمويل تجريبي مع استرداد');
assert(repFunding);
await ok('fundingRepayment',{fundingId:repFunding.id,amount:100,date:T,memo:'استرداد جزئي'});
await fail('cancelFunding',{id:repFunding.id,date:T,reason:'لا يجب الإلغاء بعد الاسترداد'});
await ok('projectFunding',{project:b,sourceType:'personal',amount:250,date:T,memo:'تمويل سيتم إلغاؤه'});
w=await read();const cancelledFunding=w.records.find(r=>r.kind==='projectFunding'&&r.data.memo==='تمويل سيتم إلغاؤه');assert(cancelledFunding);
await ok('cancelFunding',{id:cancelledFunding.id,date:T,reason:'اختبار إلغاء'});
await fail('fundingRepayment',{fundingId:cancelledFunding.id,amount:1,date:T,memo:'لا يجوز استرداد تمويل ملغى'});
checks+=8;
// Full project deletion is explicit and destructive, so require exact project-name confirmation.
w=await read();
const projectToDelete=w.records.find(r=>r.kind==='project'&&r.id===a);
assert(projectToDelete);
await fail('deleteProject',{id:a,confirmName:'اسم خاطئ',reason:'اختبار'});
await ok('deleteProject',{id:a,confirmName:projectToDelete.data.name,reason:'حذف بيانات اختبار'});
w=await read();
assert.equal(w.records.some(r=>r.id===a),false);
assert.equal(w.records.some(r=>r.data&&Object.values(r.data).some(v=>v===a)),false);
const remainingProjectJournals=w.journals.filter(j=>j.lines.some(l=>l.project===a));
assert(remainingProjectJournals.length>0);
assert(remainingProjectJournals.filter(j=>!j.reversal).every(j=>w.journals.some(x=>x.reversal===j.id)));
assert.equal(Object.values(f.balance(w)).reduce((sum,v)=>sum+v,0),0);
checks+=4;

// Annual owner settlement: entitlement must be based on fiscal-year profit, allocated exactly once, and remain a distribution (not an expense).
await ok('project',{name:'مالك 1',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:100});
await ok('project',{name:'مالك 2',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:100});
w=await read();
const ownerP1=w.records.find(r=>r.kind==='project'&&r.data.name==='مالك 1').id;
const ownerP2=w.records.find(r=>r.kind==='project'&&r.data.name==='مالك 2').id;
await ok('dailyReport',{project:ownerP1,date:T,manager:'مدير المالك 1',gross:10000,channels:{cash:0,bank:10000,mada:0,visa:0,mastercard:0,receivable:0},memo:'إيراد المالك 1'});
await ok('entry',{project:ownerP1,kind:'expense',amount:2000,date:T,memo:'مصروف المالك 1'});
await ok('dailyReport',{project:ownerP2,date:T,manager:'مدير المالك 2',gross:5000,channels:{cash:0,bank:5000,mada:0,visa:0,mastercard:0,receivable:0},memo:'إيراد المالك 2'});
await ok('entry',{project:ownerP2,kind:'expense',amount:1000,date:T,memo:'مصروف المالك 2'});
await ok('setOwnerPolicy',{percent:20,effectiveFrom:T});
w=await read();
const ownerBefore1=f.balance(w,ownerP1),ownerBefore2=f.balance(w,ownerP2);
assert.equal(f.profit(w,ownerP1,T,T).net,800000);
assert.equal(f.profit(w,ownerP2,T,T).net,400000);
const ownerProfitBefore=f.profit(w,'all',T,T).net;
await ok('annualOwnerDistribution',{year:Number(T.slice(0,4)),paymentAccount:'bank'});
w=await read();
const settlement=w.records.find(r=>r.kind==='ownerSettlement'&&r.data.fiscalYearStart===T.slice(0,4)+'-01-01');
assert(settlement);
assert.equal(settlement.data.totalProfit,1200000);
assert.equal(settlement.data.totalOwner,240000);
assert.deepEqual(settlement.data.allocations.sort((x,y)=>x.project.localeCompare(y.project)),[
  {project:ownerP1,amount:160000},
  {project:ownerP2,amount:80000},
].sort((x,y)=>x.project.localeCompare(y.project)));
assert.equal(f.profit(w,'all',T,T).net,ownerProfitBefore);
assert.equal(f.balance(w,ownerP1).bank,ownerBefore1.bank-160000);
assert.equal(f.balance(w,ownerP2).bank,ownerBefore2.bank-80000);
assert.equal(f.balance(w,ownerP1).distribution,160000);
assert.equal(f.balance(w,ownerP2).distribution,80000);
assert.equal(f.accountingControlTotals(w,T,T,'all').balanceCheck,0);
assert.equal(f.accountingControlTotals(w,T,T,'all').cashFlowDifference,0);
await fail('annualOwnerDistribution',{year:Number(T.slice(0,4)),paymentAccount:'bank'});
checks+=12;

// Independent Balance Sheet + Cash Flow reconciliation fixture: the same ledger must satisfy both controls.
const reconciliationFixture={records:[],audit:[],journals:[
 {id:'bs-cap',date:T,memo:'رأس مال',kind:'capital',lines:[{project:'bs',account:'bank',debit:1000000,credit:0},{project:'bs',account:'capital',debit:0,credit:1000000}]},
 {id:'bs-rev',date:T,memo:'إيراد',kind:'income',lines:[{project:'bs',account:'bank',debit:500000,credit:0},{project:'bs',account:'revenue',debit:0,credit:500000}]},
 {id:'bs-exp',date:T,memo:'مصروف',kind:'expense',lines:[{project:'bs',account:'cash',debit:0,credit:100000},{project:'bs',account:'expense',debit:100000,credit:0}]},
 {id:'bs-loan',date:T,memo:'قرض',kind:'loan',lines:[{project:'bs',account:'bank',debit:300000,credit:0},{project:'bs',account:'loan',debit:0,credit:300000}]},
 {id:'bs-dist',date:T,memo:'توزيع مالك',kind:'distribution',lines:[{project:'bs',account:'distribution',debit:50000,credit:0},{project:'bs',account:'bank',debit:0,credit:50000}]},
]};
const bsControl=f.balanceSheetControl(reconciliationFixture,'all',T);
assert.equal(bsControl.assets,1650000);
assert.equal(bsControl.liabilities,300000);
assert.equal(bsControl.equity,950000);
assert.equal(bsControl.currentProfit,400000);
assert.equal(bsControl.totalLiabilitiesAndEquity,1650000);
assert.equal(bsControl.difference,0);
assert.equal(bsControl.trialBalanceDifference,0);
assert.equal(bsControl.cashFlowDifference,0);
assert.equal(bsControl.fullyReconciled,true);
checks+=8;

// Balance Sheet reconciliation: assets = liabilities + equity + current profit, and both control ledgers must close at zero.
const bsFixture={records:[],audit:[],journals:[{id:'bs-cap',date:T,memo:'capital',kind:'capital',lines:[{project:'bs',account:'bank',debit:1000000,credit:0},{project:'bs',account:'capital',debit:0,credit:1000000}]},{id:'bs-rev',date:T,memo:'revenue',kind:'income',lines:[{project:'bs',account:'bank',debit:500000,credit:0},{project:'bs',account:'revenue',debit:0,credit:500000}]},{id:'bs-exp',date:T,memo:'expense',kind:'expense',lines:[{project:'bs',account:'cash',debit:0,credit:100000},{project:'bs',account:'expense',debit:100000,credit:0}]},{id:'bs-loan',date:T,memo:'loan',kind:'loan',lines:[{project:'bs',account:'bank',debit:300000,credit:0},{project:'bs',account:'loan',debit:0,credit:300000}]},{id:'bs-dist',date:T,memo:'distribution',kind:'distribution',lines:[{project:'bs',account:'distribution',debit:50000,credit:0},{project:'bs',account:'bank',debit:0,credit:50000}]}]};
const bs=f.balanceSheetControl(bsFixture,'all',T);assert.equal(bs.assets,1650000);assert.equal(bs.liabilities,300000);assert.equal(bs.equity,950000);assert.equal(bs.currentProfit,400000);assert.equal(bs.difference,0);assert.equal(bs.trialBalanceDifference,0);assert.equal(bs.cashFlowDifference,0);assert.equal(bs.fullyReconciled,true);checks+=8;

// Five-decimal monetary precision: input parsing/schedule must retain micro precision before halala posting.
const exactSchedule=f.loanScheduleFromPaymentExact(1000.12345,100.12345,10,T);
assert.equal(exactSchedule.length,10);
assert(exactSchedule.every(x=>Number.isSafeInteger(x.principalMicro)&&Number.isSafeInteger(x.interestMicro)&&Number.isSafeInteger(x.amountMicro)));
assert.equal(exactSchedule.reduce((s,x)=>s+x.principalMicro,0),1000.12345*100000);
assert.equal(exactSchedule.at(-1).principalMicro,1000.12345*100000-exactSchedule.slice(0,-1).reduce((s,x)=>s+x.principalMicro,0));
assert(exactSchedule.every(x=>Math.abs(x.amountMicro-x.principalMicro-x.interestMicro)===0));
checks+=4;

// Flexible project rent: one annual contract may be paid once or in multiple dated installments.
await ok('project',{name:'مشروع إيجار',activity:'اختبار الإيجار',mode:'operating',ownership:100,reserve:0,payout:0});
w=await read();
const leaseProject=w.records.filter(r=>r.kind==='project').at(-1).id;
await ok('lease',{project:leaseProject,title:'إيجار سنوي متعدد الدفعات',totalAmount:120000,startDate:'2026-01-01',endDate:'2026-12-31',scheduleType:'custom',installments:'2026-01-15,40000\n2026-05-15,30000\n2026-09-15,50000',certainty:100});
await ok('lease',{project:leaseProject,title:'إيجار السنة التالية دفعة واحدة',totalAmount:60000,startDate:'2027-01-01',endDate:'2027-12-31',scheduleType:'once',paymentDate:'2027-01-05',certainty:100});
w=await read();
const leaseRows=w.records.filter(r=>r.kind==='obligation'&&r.data.leaseId);
const currentLease=leaseRows.filter(r=>r.data.leaseTotal===12000000);
assert.equal(currentLease.length,3);
assert.equal(currentLease.reduce((s,r)=>s+r.data.amount,0),12000000);
assert.deepEqual(currentLease.map(r=>r.data.date),['2026-01-15','2026-05-15','2026-09-15']);
const futureLease=leaseRows.filter(r=>r.data.leaseTotal===6000000);
assert.equal(futureLease.length,1);
assert.equal(futureLease[0].data.amount,6000000);
await ok('settle',{id:currentLease[0].id,date:T});
w=await read();
assert.equal(f.profit(w,leaseProject,'2026-01-01',T).net,-12000000);
assert.equal(f.balance(w,leaseProject).payable,8000000);
assert.equal(f.balance(w,leaseProject).cash||0,-4000000);
assert.equal(f.actualCashFlow(w,leaseProject,'2026-01-01',T).rows.at(-1).operatingOut,4000000);
checks+=7;

// Final integrated reconciliation: every remaining ledger scope must agree with the balance sheet and cash-flow controls after all mutations above.
w=await read();
const integratedControl=f.balanceSheetControl(w,'all',T);
assert.equal(integratedControl.trialBalanceDifference,0);
assert.equal(integratedControl.cashFlowDifference,0);
assert.equal(integratedControl.difference,0);
assert.equal(integratedControl.fullyReconciled,true);
for(const p of w.records.filter(r=>r.kind==='project')){
  const control=f.balanceSheetControl(w,p.id,T);
  assert.equal(control.trialBalanceDifference,0,'trial balance mismatch for project '+p.id);
  assert.equal(control.cashFlowDifference,0,'cash flow mismatch for project '+p.id);
  assert.equal(control.difference,0,'balance sheet mismatch for project '+p.id);
}
checks+=4+w.records.filter(r=>r.kind==='project').length*3;
await ok('closePeriod',{id:b,date:T});await fail('entry',{project:b,kind:'income',amount:100,date:T,memo:'فترة مقفلة'});w=await read();for(const j of w.journals)f.validateLines(j.lines);const bal=f.balance(w);assert.equal(Object.values(bal).reduce((s,v)=>s+v,0),0);const forecast=f.forecast(w);assert.equal(forecast.buckets.length,13);console.log(JSON.stringify({passed:true,mutationChecks:checks,records:w.records.length,journals:w.journals.length,verified:['identity isolation','balanced journals','idempotency','internal transfers','profit versus cash','loan repayment','early settlement','opening debt','payroll dates','reversal uniqueness','period lock','cash forecast']}));
}finally{await mf.dispose();}
