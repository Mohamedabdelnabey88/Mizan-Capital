import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"import {GET,POST} from './cloudflare/workspace';export default {fetch:(r)=>r.method==='POST'?POST(r):GET(r)}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/owner-cash-worker.mjs'});
await build({entryPoints:['lib/owner-cash.ts','lib/finance.ts'],bundle:true,format:'esm',platform:'node',outdir:'.sites-runtime/owner-cash-lib'});
const {ownerCashMonth}=await import('../.sites-runtime/owner-cash-lib/owner-cash.js');
const {balance,profit,annualOwnerReport,ownerDistributionsInRange,actualCashFlow}=await import('../.sites-runtime/owner-cash-lib/finance.js');
await build({entryPoints:['components/owner-cash-panel.tsx'],bundle:true,format:'esm',platform:'node',jsx:'automatic',alias:{'@':process.cwd()},external:['react','react-dom','react-dom/server'],loader:{'.css':'empty'},banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},outfile:'.sites-runtime/owner-cash-panel-render.mjs'});
const {OwnerCashPanel}=await import('../.sites-runtime/owner-cash-panel-render.mjs');
const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const render=(summary)=>renderToStaticMarkup(createElement(OwnerCashPanel,{summary,scope:'all',busy:false,onMonth:()=>{},onWithdraw:()=>{},onUndo:()=>{}}));
const mf=new Miniflare({modules:true,scriptPath:'.sites-runtime/owner-cash-worker.mjs',compatibilityDate:'2026-05-15',d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const headers={'oai-authenticated-user-id':'owner-cash-review','Content-Type':'application/json'};
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date()),month=date.slice(0,7),start=month+'-01';
 const snapshot=async()=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{headers});assert.equal(r.status,200);return r.json();};
 const call=async(action,payload,requestId=crypto.randomUUID())=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{method:'POST',headers,body:JSON.stringify({action,payload,requestId})});return {status:r.status,body:await r.json()};};
 const post=async(action,payload,requestId)=>{const r=await call(action,payload,requestId);assert.equal(r.status,200,action+': '+JSON.stringify(r.body));return r.body;};
 await post('project',{name:'إيجار وسحب فائض',activity:'تأجير',mode:'operating',ownership:100,reserve:0,payout:100});
 let w=await snapshot();const project=w.records.find(r=>r.kind==='project').id;
 await post('projectTenantLease',{project,title:'إيجار 50000',tenantName:'مستأجر',totalAmount:50000,startDate:start,endDate:date,paymentDate:date,scheduleType:'once'});
 w=await snapshot();const rent=w.records.find(r=>r.kind==='obligation'&&r.data.projectTenantLeaseId);
 await post('projectSchedulePayment',{id:rent.id,date,paymentAccount:'bank'});
 await post('loan',{project,holder:'business',name:'أصل دين 40000',amount:40000,monthlyPayment:40000,months:1,start:date,firstDate:date,fundingMode:'opening'});
 w=await snapshot();const due=w.records.find(r=>r.kind==='obligation'&&r.data.loan);
 let s=ownerCashMonth(w,month,'all',date);
 assert.equal(s.received,5000000);assert.equal(s.paid,0);assert.equal(s.pending,4000000);assert.equal(s.available,1000000,'unpaid installment must be reserved before owner draw');
 await post('settle',{id:due.id,date,paymentAccount:'bank'});
 w=await snapshot();s=ownerCashMonth(w,month,'all',date);
 assert.equal(s.paid,4000000);assert.equal(s.pending,0);assert.equal(s.available,1000000);
 const pnl=profit(w,'all',start,date).net;
 const draw=(amount,extra={})=>({month,scope:'all',amount,date,paymentAccount:'bank',destination:'حساب المالك — مرجع اختبار',...extra});
 assert.equal((await call('ownerCashWithdrawal',draw(10001))).status,400,'cannot exceed actual surplus');
 assert.equal((await call('ownerCashWithdrawal',draw(1,{paymentAccount:'cash'}))).status,400,'cannot withdraw from unfunded account');
 assert.equal((await call('ownerCashWithdrawal',draw(1,{destination:''}))).status,400);
 assert.equal((await call('ownerCashWithdrawal',draw(1,{month:'2099-01'}))).status,400);
 const request=crypto.randomUUID();await post('ownerCashWithdrawal',draw(3000),request);await post('ownerCashWithdrawal',draw(3000),request);
 w=await snapshot();s=ownerCashMonth(w,month,'all',date);
 assert.equal(s.withdrawn,300000);assert.equal(s.available,700000);assert.equal(balance(w,'all',date).bank,700000);
 await post('ownerCashWithdrawal',draw(7000));
 w=await snapshot();s=ownerCashMonth(w,month,'all',date);
 assert.equal(s.available,0);assert.equal(s.withdrawn,1000000);assert.equal(balance(w,'all',date).bank,0);
 const html=render(s);assert(html.includes('تم تحويل كامل الفائض المتاح لهذا الشهر.'));assert(/<button[^>]*disabled=""[^>]*>تسجيل تحويل لحساب المالك/.test(html),'zero balance disables a second draw');assert(html.includes('10,000.00 ر.س'));assert(html.includes('حساب المالك — مرجع اختبار'));
 assert.equal(profit(w,'all',start,date).net,pnl,'owner draw is not an expense and never changes earned profit');
 assert.equal(actualCashFlow(w,'all',start,date).closing,0);
 assert.equal((await call('ownerCashWithdrawal',draw(1))).status,400);
 const record=w.records.find(r=>r.kind==='ownerCashWithdrawal'&&r.data.amount===700000);
 await post('undoOwnerCashWithdrawal',{id:record.id,date,reason:'اختبار تصحيح التحويل'});
 w=await snapshot();s=ownerCashMonth(w,month,'all',date);
 assert.equal(s.available,700000);assert.equal(s.withdrawn,300000);assert.equal(balance(w,'all',date).bank,700000);
 assert.equal((await call('undoOwnerCashWithdrawal',{id:record.id,date,reason:'تكرار'})).status,400);
 // Competing draws, even through different scopes, must share one monthly cap.
 const competing=await Promise.all([call('ownerCashWithdrawal',draw(7000)),call('ownerCashWithdrawal',draw(7000,{scope:project}))]);
 assert.deepEqual(competing.map(r=>r.status).sort(),[200,400]);
 w=await snapshot();assert.equal(ownerCashMonth(w,month,'all',date).available,0);assert.equal(balance(w,'all',date).bank,0);
 assert.equal(ownerDistributionsInRange(w,start,date),1000000);
 await post('setOwnerPolicy',{percent:100,effectiveFrom:start});
 const annual=annualOwnerReport(await snapshot(),Number(date.slice(0,4)));
 assert.equal(annual.priorWithdrawals,1000000);assert.equal(annual.remaining,annual.ownerShare-1000000,'annual share credits prior monthly drawings');
 await post('setOwnerPolicy',{percent:20,effectiveFrom:start});assert.equal((await call('annualOwnerDistribution',{year:Number(date.slice(0,4)),paymentAccount:'bank'})).status,400,'a fully drawn annual share cannot be paid again');

 const activeDraw=(await snapshot()).records.find(r=>r.kind==='ownerCashWithdrawal'&&r.data.status==='posted');
 await post('closePeriod',{id:project,date});
 assert.equal((await call('undoOwnerCashWithdrawal',{id:activeDraw.id,date,reason:'محاولة تعديل فترة مقفلة'})).status,400);
 // Funding receipts are not rent/operating collections eligible for withdrawal.
 const funding={records:[],audit:[],journals:[{id:'f',kind:'loan',date,memo:'funding',lines:[{project:'',account:'bank',debit:9000000,credit:0},{project:'',account:'loan',debit:0,credit:9000000}]}]};
 assert.equal(ownerCashMonth(funding,month,'all',date).available,0);
 const reserved={records:[{id:'p',kind:'project',data:{mode:'operating',reserve:950000}},{id:'old',kind:'obligation',data:{project:'p',direction:'out',status:'pending',date:'2000-01-01',amount:100000}}],audit:[],journals:[{id:'rent',kind:'income',date,memo:'rent',lines:[{project:'p',account:'bank',debit:1000000,credit:0},{project:'p',account:'revenue',debit:0,credit:1000000}]}]};
 assert.equal(ownerCashMonth(reserved,month,'all',date).available,0,'reserve and older unpaid dues stay protected');
 const mixedReturn={records:[],audit:[],journals:[{id:'ret',kind:'investmentReturn',date,memo:'capital plus return',lines:[{project:'',account:'bank',debit:100000,credit:0},{project:'',account:'investment',debit:0,credit:90000},{project:'',account:'dividend',debit:0,credit:10000}]}]};
 assert.equal(ownerCashMonth(mixedReturn,month,'all',date).received,10000,'returned investment principal cannot masquerade as income');

 // A later-month draw stays attached to its source month, rather than consuming the next month's receipts.
 const pastMonth=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-2,1)).toISOString().slice(0,7);
 const past={records:[{id:'draw',kind:'ownerCashWithdrawal',data:{month:pastMonth,allocations:[{project:'p',amount:10000}]}}],audit:[],journals:[
 {id:'sale',kind:'income',date:pastMonth+'-01',memo:'rent',lines:[{project:'p',account:'bank',debit:10000,credit:0},{project:'p',account:'revenue',debit:0,credit:10000}]},
 {id:'drawj',kind:'ownerCashWithdrawal',source:'owner-cash:draw',date,memo:'owner',lines:[{project:'p',account:'distribution',debit:10000,credit:0},{project:'p',account:'bank',debit:0,credit:10000}]}]};
 assert.equal(ownerCashMonth(past,pastMonth,'all',date).withdrawn,10000);
 assert.equal(ownerCashMonth(past,month,'all',date).paid,0);
 console.log('Owner cash passed: 50,000 receipts minus 40,000 installments, pending reserve, partial/full draw to zero, actual bank and profit reconciliation, retry/concurrency protection, undo, annual credit and period attribution.');
}finally{await mf.dispose();}
