import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json')),{build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/owner-cash.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/month-isolation.mjs'});
await build({entryPoints:['components/owner-cash-panel.tsx'],bundle:true,format:'esm',platform:'node',jsx:'automatic',alias:{'@':process.cwd()},external:['react','react-dom','react-dom/server'],loader:{'.css':'empty'},banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},outfile:'.sites-runtime/month-isolation-render.mjs'});
const {ownerCashMonth}=await import('../.sites-runtime/month-isolation.mjs');
const {OwnerCashPanel}=await import('../.sites-runtime/month-isolation-render.mjs');
const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const l=(account,debit=0,credit=0)=>({project:'p',account,debit,credit});
const j=(id,date,kind,lines,extra={})=>({id,date,kind,lines,memo:id,...extra});
const w={records:[{id:'p',kind:'project',data:{name:'مشروع الشهر',mode:'operating',reserve:0}}],audit:[],journals:[
 j('رصيد افتتاحي سابق','2026-01-01','capital',[l('bank',50000000),l('capital',0,50000000)]),
 j('تحصيل سبتمبر','2026-09-03','income',[l('bank',2000000),l('revenue',0,2000000)]),
 j('مصروف سبتمبر','2026-09-04','expense',[l('expense',300000),l('bank',0,300000)]),
 j('تحصيل أكتوبر','2026-10-02','income',[l('bank',5000000),l('revenue',0,5000000)]),
 j('أقساط أكتوبر كاملة','2026-10-03','settle',[l('loan',3800000),l('interest',200000),l('bank',0,4000000)]),
 j('تكلفة تأسيس وليست تشغيل شهر','2026-10-04','projectCost',[l('fixed',18072700),l('bank',0,18072700)]),
 j('قرض وارد ليس تحصيل تشغيل','2026-10-05','loan',[l('bank',9300000),l('loan',0,9300000)]),
 j('حركة نوفمبر لا تدخل أكتوبر','2026-11-01','expense',[l('expense',99999999),l('bank',0,99999999)])
]};
const october=ownerCashMonth(w,'2026-10','all','2026-10-24');
assert.equal(5000000-4000000-18072700,-17072700,'reproduce the reported negative number when startup use is mixed into operations');
assert.equal(october.received,5000000);assert.equal(october.operatingPaid,0);assert.equal(october.installmentsPaid,4000000);assert.equal(october.paid,4000000);
assert.equal(october.surplus,1000000,'October operation surplus is 10,000, independently of startup spend and funding');
assert.equal(october.capitalPaid,18072700);assert.equal(october.fundingReceived,9300000);assert.equal(october.available,1000000);
assert(october.entries.every(e=>e.date>='2026-10-01'&&e.date<='2026-10-24'));
assert.equal(october.entries.filter(e=>['receipt','operating','installment'].includes(e.category)).reduce((n,e)=>n+(e.category==='receipt'?e.amount:-e.amount),0),october.surplus);
const september=ownerCashMonth(w,'2026-09','all','2026-10-24');
assert.equal(september.received,2000000);assert.equal(september.operatingPaid,300000);assert.equal(september.surplus,1700000);
assert.equal(ownerCashMonth(w,'2026-11','all','2026-10-24').received,0);
assert.equal(ownerCashMonth(w,'2026-11','all','2026-10-24').available,0);
const overdue={...w,records:[...w.records,{id:'old-due',kind:'obligation',data:{project:'p',date:'2026-09-01',direction:'out',status:'pending',amount:200000}}]};
const guarded=ownerCashMonth(overdue,'2026-10','all','2026-10-24');
assert.equal(guarded.surplus,1000000,'previous-month unpaid dues cannot change October operating result');
assert.equal(guarded.monthPending,0);assert.equal(guarded.overduePending,200000);assert.equal(guarded.pending,200000);assert.equal(guarded.available,800000,'old dues remain reserved separately');
const emptyCash={...w,journals:w.journals.filter(j=>!['capital','loan'].includes(j.kind)&&!j.date.startsWith('2026-09'))};
assert.equal(ownerCashMonth(emptyCash,'2026-10','all','2026-10-24').surplus,1000000);
assert.equal(ownerCashMonth(emptyCash,'2026-10','all','2026-10-24').available,0,'excluding startup from operating result must never manufacture withdrawable cash');
const refund={...w,journals:[...w.journals,j('عكس التأسيس','2026-10-10','reversal',[l('bank',18072700),l('fixed',0,18072700)],{reversal:'تكلفة تأسيس وليست تشغيل شهر'})]};
assert.equal(ownerCashMonth(refund,'2026-10','all','2026-10-24').capitalPaid,0);assert.equal(ownerCashMonth(refund,'2026-10','all','2026-10-24').surplus,1000000);
const late={...w,records:[...w.records,{id:'past',kind:'obligation',data:{project:'p',date:'2026-08-01',direction:'out',status:'paid'}}],journals:[...w.journals,j('سداد قسط قديم في أكتوبر','2026-10-20','settle',[l('loan',500000),l('bank',0,500000)],{source:'obligation:past'})]};
const actualLate=ownerCashMonth(late,'2026-10','all','2026-10-24');assert.equal(actualLate.priorInstallmentsPaid,500000);assert.equal(actualLate.entries.find(e=>e.journalId==='سداد قسط قديم في أكتوبر').dueDate,'2026-08-01');
const months=Array.from({length:12},(_,i)=>ownerCashMonth(w,'2026-'+String(i+1).padStart(2,'0'),'all','2026-10-24'));
const html=renderToStaticMarkup(createElement(OwnerCashPanel,{summary:october,months,projects:[{id:'p',name:'مشروع الشهر'}],scope:'all',busy:false,onMonth:()=>{},onWithdraw:()=>{},onUndo:()=>{}}));
for(const label of ['كل شهر لوحده','صافي تشغيل الشهر بعد الأقساط','تفاصيل حساب','تمويل / رأس مال وارد','تأسيس / استثمار / نقل تمويل','شهر الفائض مستقل'])assert(html.includes(label),label);
assert(html.includes('180,727.00 ر.س'));assert(html.includes('10,000.00 ر.س'));assert(html.includes('17,000.00 ر.س'));
const ui=fs.readFileSync('app/page.tsx','utf8');assert(ui.includes('[ownerMonthKey,setOwnerMonthKey]=useState('));assert(ui.includes('onMonth={setOwnerMonthKey}'));assert(!ui.includes("const ownerMonthKey=from.slice"));
console.log('Monthly isolation passed: reported -170,727 reproduced by mixed startup spend, October 10,000 / September 17,000 separated, opening/funding excluded, previous dues reserved independently, real-cash cap preserved, reversals and late-payment dates exposed, twelve-month view rendered.');
