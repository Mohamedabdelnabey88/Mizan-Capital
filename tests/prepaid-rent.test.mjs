import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json')),{build}=wr('esbuild'),{Miniflare}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:`import {GET,POST} from './cloudflare/workspace';const NativeDate=Date;let clock='2026-11-06T12:00:00Z';globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return new NativeDate(clock).getTime();}};export default {fetch(req){clock=(req.headers.get('x-test-date')||'2026-11-06')+'T12:00:00Z';return req.method==='POST'?POST(req):GET(req);}}`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',external:['cloudflare:workers'],outfile:'.sites-runtime/prepaid-rent-worker.mjs'});
const mf=new Miniflare({modules:true,scriptPath:'.sites-runtime/prepaid-rent-worker.mjs',compatibilityDate:'2026-05-15',d1Databases:['DB']});
try{
 const db=await mf.getD1Database('DB');for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 let clock='2026-11-06';const headers=()=>({'oai-authenticated-user-id':'prepaid-rent-review','Content-Type':'application/json','x-test-date':clock});
 const snapshot=async()=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{headers:headers()});assert.equal(r.status,200);return r.json();};
 const call=async(action,payload)=>{const r=await mf.dispatchFetch('https://test.example/api/workspace',{method:'POST',headers:headers(),body:JSON.stringify({action,payload,requestId:crypto.randomUUID()})});return {status:r.status,data:await r.json()};};
 const post=async(a,p)=>{const r=await call(a,p);assert.equal(r.status,200,JSON.stringify(r));return r;};
 const account=(w,project,account)=>w.journals.flatMap(j=>j.lines).filter(l=>l.project===project&&l.account===account).reduce((n,l)=>n+l.debit-l.credit,0);
 for(const kind of ['lease','projectCommitment']){
  await post('project',{name:'أرض مقدم '+kind,mode:'operating',ownership:100,reserve:0,payout:100});let w=await snapshot();const project=w.records.filter(r=>r.kind==='project').at(-1).id;
  await post('projectFunding',{project,sourceType:'personal',paymentAccount:'bank',targetAccount:'bank',amount:20000,date:clock,memo:'سيولة للسداد'});
  await post(kind,{project,title:'عقد أرض',costType:'rent',startDate:'2027-02-01',endDate:'2028-01-31',totalAmount:12000,scheduleType:'custom',installments:'2026-11-06,6000\n2027-08-01,6000'});
  w=await snapshot();let contract=w.records.find(r=>r.kind===kind&&r.data.project===project),due=w.records.find(r=>r.kind==='obligation'&&r.data.project===project&&r.data.date===clock);assert.equal(contract.data.accountingModel,'period-accrual-v2');
  await post(kind==='lease'?'settle':'projectSchedulePayment',{id:due.id,date:clock,paymentAccount:'bank'});
  w=await snapshot();assert.equal(account(w,project,'prepaid_rent'),600000);assert.equal(account(w,project,'expense'),0);assert.equal(account(w,project,'bank'),1400000);
  contract=w.records.find(r=>r.id===contract.id);const key=kind==='lease'?'leaseId':'projectCommitmentId';
  const edit={contractId:contract.id,version:contract.version,title:'عقد أرض معدل',party:'مالك الأرض',startDate:'2027-03-01',endDate:'2028-02-29',totalAmount:12000,reason:'تعديل بداية الانتفاع',rows:w.records.filter(r=>r.kind==='obligation'&&r.data[key]===contract.id).map(r=>({id:r.id,date:r.data.date,amount:r.data.amount/100}))};
  await post('updateContract',edit);w=await snapshot();assert.equal(account(w,project,'prepaid_rent'),600000);assert.equal(account(w,project,'expense'),0);
  contract=w.records.find(r=>r.id===contract.id);await post('updateContract',{...edit,version:contract.version,startDate:'2027-02-01',endDate:'2028-01-31'});
  await post('undoInstallmentPayment',{id:due.id,date:clock,reason:'اختبار عكس المقدمة'});w=await snapshot();assert.equal(account(w,project,'prepaid_rent')+account(w,project,'rent_payable'),0);assert.equal(account(w,project,'bank'),2000000);
  await post(kind==='lease'?'settle':'projectSchedulePayment',{id:due.id,date:clock,paymentAccount:'bank'});w=await snapshot();assert.equal(account(w,project,'prepaid_rent'),600000);assert.equal(account(w,project,'expense'),0);
  clock='2027-02-28';w=await snapshot();assert.equal(account(w,project,'expense'),92055);assert.equal(account(w,project,'prepaid_rent'),507945);
  const count=w.journals.length;assert.equal((await snapshot()).journals.length,count,'accrual reads are idempotent');
  clock='2026-11-06';
 }
 // One contract's prepayment cannot be consumed as expense by another lease in the same project.
 await post('project',{name:'فصل مقدم العقود',mode:'operating',ownership:100,reserve:0,payout:100});let isolated=await snapshot();const pid=isolated.records.filter(r=>r.kind==='project').at(-1).id;
 await post('projectFunding',{project:pid,sourceType:'personal',paymentAccount:'bank',targetAccount:'bank',amount:20000,date:clock,memo:'سيولة المقدم'});
 await post('lease',{project:pid,title:'عقد مستقبلي',startDate:'2027-02-01',endDate:'2028-01-31',totalAmount:6000,scheduleType:'once',paymentDate:clock});isolated=await snapshot();const advanceDue=isolated.records.find(r=>r.kind==='obligation'&&r.data.project===pid);await post('settle',{id:advanceDue.id,date:clock,paymentAccount:'bank'});
 await post('lease',{project:pid,title:'عقد حالي منفصل',startDate:'2026-11-01',endDate:'2026-11-30',totalAmount:3000,scheduleType:'once',paymentDate:'2026-11-30'});
 isolated=await snapshot();assert.equal(account(isolated,pid,'expense'),60000);assert.equal(account(isolated,pid,'prepaid_rent'),600000,'future-contract prepayment remains intact');assert.equal(account(isolated,pid,'payable'),-60000);
 console.log('Prepaid rent passed: outgoing lease and land-rent commitment, half paid before future term, no premature expense, future-term edit, undo/re-pay, and exact monthly recognition.');
}finally{await mf.dispose();}
