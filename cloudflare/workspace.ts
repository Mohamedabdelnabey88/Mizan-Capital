import {database} from '@/db';
import {projectPerformance} from '@/lib/project-performance';
import {accounts,cents,dayAdd,monthAdd,today,validateLines,loanRateFromPaymentExact,loanScheduleFromPaymentExact,balance,profit,forecast,internalFunding,distributionEntitlement,fiscalYearForStart,fiscalYearForDate,type Workspace,type Line} from '@/lib/finance';
export const dynamic='force-dynamic'; // Production ledger: project deletion reverses posted entries before removing operational records. // financial operations: halala-safe ledger, auditable daily corrections, investments, annual owner settlement, historical owner-policy effective dates
const uid=()=>crypto.randomUUID();
function str(v:any,n=200){if(typeof v!=='string'||!v.trim()||v.length>n)throw Error('راجع الحقول المطلوبة وطول النص.');return v.trim();}
function date(v:any){const s=str(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s+'T12:00Z'))||new Date(s+'T12:00Z').toISOString().slice(0,10)!==s)throw Error('تاريخ غير صحيح.');return s;}
function num(v:any,min:number,max:number){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error('قيمة رقمية خارج النطاق المسموح.');return n;}
async function snapshot(db:D1Database,owner:string):Promise<Workspace>{const [a,b,c]=await Promise.all([db.prepare('SELECT * FROM records WHERE owner=? ORDER BY created').bind(owner).all(),db.prepare('SELECT * FROM journals WHERE owner=? ORDER BY date DESC,created DESC').bind(owner).all(),db.prepare('SELECT * FROM audit WHERE owner=? ORDER BY created DESC LIMIT 200').bind(owner).all()]);const base:any={records:a.results.map((r:any)=>({...r,data:JSON.parse(r.data)})),journals:b.results.map((r:any)=>({...r,lines:JSON.parse(r.lines)})),audit:c.results};for(const pr of base.records.filter((r:any)=>r.kind==='project')){const plans=base.records.filter((r:any)=>r.kind==='projectPlan'&&r.data.project===pr.id).sort((x:any,y:any)=>String(x.data.effectiveFrom).localeCompare(String(y.data.effectiveFrom)));const lp=plans.at(-1)?.data;if(lp){pr.data.planMonthlyRevenueMicro=Number(lp.revenueMonthlyMicro||0);pr.data.planDailyRevenueMicro=Number(lp.revenueDailyMicro||0);pr.data.planMonthlyExpenseMicro=Number(lp.expenseMonthlyMicro||0);pr.data.planNetMonthlyMicro=Number(lp.netMonthlyMicro||0);pr.data.planEffectiveFrom=lp.effectiveFrom;pr.data.netTargetMicro=Number(lp.netTargetMicro||0);pr.data.planTargetPeriod=lp.targetPeriod==='annual'?'annual':'monthly';pr.data.expectedReceiptDate=lp.expectedReceiptDate||'';pr.data.expectedReceiptInstallments=Array.isArray(lp.expectedReceiptInstallments)?lp.expectedReceiptInstallments:[];}}const fy=fiscalYearForDate(base);base.projectPerformance=Object.fromEntries(base.records.filter((r:any)=>r.kind==='project'&&r.data.mode==='operating').map((r:any)=>[r.id,projectPerformance(base,r.id,fy.start,fy.end)]));return base;}
async function materializeDueAccruals(db:D1Database,owner:string,skipId='',settlementDate=''){
 const w=await snapshot(db,owner),time=new Date().toISOString(),known=new Set(w.journals.map(j=>j.source).filter(Boolean)),ops:D1PreparedStatement[]=[];
 // Non-lease obligations continue to accrue on their due date. Lease installments are payment schedules, not expense-recognition schedules.
 for(const r of w.records){
  if(r.kind!=='obligation'||r.data.status!=='pending')continue;
  const d=r.data,linkedLease=d.leaseId?w.records.find(x=>x.kind==='lease'&&x.id===d.leaseId):null;
  if(d.tenantLeaseId)continue; // Legacy tenant collection schedules are tracked as organizer dates, not automatically accrued accounting entries.
  if(linkedLease?.data.accountingModel==='period-accrual-v2')continue;
  const source='obligation-accrual:'+r.id;
  if(d.date>today()||known.has(source)||!['income','expense'].includes(accounts[d.category]?.type))continue;
  if(r.id===skipId&&settlementDate&&settlementDate<d.date)continue;
  const pr=w.records.find(x=>x.kind==='project'&&x.id===d.project);
  if(!pr||(pr.data.closedThrough&&d.date<=pr.data.closedThrough))continue;
  const lines:Line[]=d.direction==='out'?[{project:d.project,account:d.category,debit:d.amount,credit:0},{project:d.project,account:'payable',debit:0,credit:d.amount}]:[{project:d.project,account:'receivable',debit:d.amount,credit:0},{project:d.project,account:d.category,debit:0,credit:d.amount}];
  validateLines(lines);const kind=d.direction==='out'?'bill':'invoice',memo=(d.direction==='out'?'إثبات مصروف مستحق: ':'إثبات إيراد مستحق: ')+String(d.title||'استحقاق');
  ops.push(db.prepare('INSERT OR IGNORE INTO journals(id,owner,date,memo,kind,lines,source,reversal,created) VALUES(?,?,?,?,?,?,?,NULL,?)').bind(uid(),owner,d.date,memo,kind,JSON.stringify(lines),source,time));known.add(source);
 }
 // Recognize contractual installments separately from monthly rent expense.
 const dayNo=(s:string)=>Math.floor(Date.parse(s+'T00:00:00Z')/86400000);
 const iso=(n:number)=>new Date(n*86400000).toISOString().slice(0,10);
 const monthEnd=(s:string)=>{const d=new Date(s+'T12:00:00Z');return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);};
 for(const lease of w.records.filter(r=>r.kind==='lease'&&r.data.accountingModel==='period-accrual-v2'&&r.data.status!=='cancelled')){
  const d=lease.data,projectId=String(d.project||''),start=String(d.startDate||''),end=String(d.endDate||''),total=Number(d.totalAmount||0);
  if(!projectId||!start||!end||!Number.isSafeInteger(total)||total<=0||end<start)continue;
  const pr=w.records.find(x=>x.kind==='project'&&x.id===projectId);if(!pr)continue;
  const totalDays=dayNo(end)-dayNo(start)+1;if(totalDays<=0)continue;
  const leaseObligations=w.records.filter(x=>x.kind==='obligation'&&x.data.leaseId===lease.id).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date)));
  let cursor=start;
  while(cursor<=end){
   const periodEnd=monthEnd(cursor)<end?monthEnd(cursor):end;
   const cutoff=periodEnd<today()?periodEnd:today();
   // A payment obligation due before the cutoff becomes a liability. First reclassify any rent expense already accrued; the rest represents prepaid use-of-property rights.
   for(const obligation of leaseObligations){
    const od=obligation.data,dueDate=String(od.date||''),dueSource='lease-due:'+obligation.id;
    if(od.status!=='pending'||dueDate>cutoff||known.has(dueSource)||(pr.data.closedThrough&&dueDate<=pr.data.closedThrough))continue;
    if(obligation.id===skipId&&settlementDate&&settlementDate<dueDate)continue;
    const accruedLiability=w.journals.filter(j=>String(j.source||'').startsWith('lease-accrual:'+lease.id+':')&&j.date<dueDate).reduce((sum,j)=>sum+j.lines.filter(l=>l.project===projectId&&l.account==='payable').reduce((a,l)=>a+l.credit-l.debit,0),0);
    const reclassify=Math.min(Number(od.amount||0),Math.max(0,accruedLiability)),prepaid=Number(od.amount||0)-reclassify;
    const lines:Line[]=[];
    if(reclassify>0)lines.push({project:projectId,account:'payable',debit:reclassify,credit:0});
    if(prepaid>0)lines.push({project:projectId,account:'prepaid_rent',debit:prepaid,credit:0});
    lines.push({project:projectId,account:'rent_payable',debit:0,credit:Number(od.amount||0)});
    validateLines(lines);
    const memo='إثبات استحقاق دفعة إيجار: '+String(od.title||d.title||'إيجار'),journalId=uid();
    ops.push(db.prepare('INSERT OR IGNORE INTO journals(id,owner,date,memo,kind,lines,source,reversal,created) VALUES(?,?,?,?,?,?,?,NULL,?)').bind(journalId,owner,dueDate,memo,'bill',JSON.stringify(lines),dueSource,time));
    w.journals.push({id:journalId,date:dueDate,memo,kind:'bill',lines,source:dueSource,created:time});known.add(dueSource);
   }
   // Recognize rent expense through today even when the current month has not ended.
   // At month-end, only the remaining accrual is posted; prepaid rent is released as it is consumed.
   const recognitionDate=periodEnd<=today()?periodEnd:(cursor<=today()&&today()<=end?today():'');
   if(recognitionDate){
    const source='lease-accrual:'+lease.id+':'+recognitionDate;
    if(!known.has(source)&&!(pr.data.closedThrough&&recognitionDate<=pr.data.closedThrough)){
     const coveredDays=dayNo(recognitionDate)-dayNo(start)+1;
     const cumulative=recognitionDate===end?total:Math.round(total*coveredDays/totalDays);
     const previous=w.journals.filter(j=>String(j.source||'').startsWith('lease-accrual:'+lease.id+':')&&j.date<recognitionDate).reduce((sum,j)=>sum+j.lines.filter(l=>l.project===projectId&&l.account==='expense').reduce((a,l)=>a+l.debit-l.credit,0),0);
     const amount=cumulative-previous;
     if(amount>0){
      const prepaidAvailable=Math.max(0,balance(w,projectId,recognitionDate).prepaid_rent||0),prepaid=Math.min(amount,prepaidAvailable),payable=amount-prepaid;
      const lines:Line[]=[{project:projectId,account:'expense',debit:amount,credit:0}];
      if(prepaid>0)lines.push({project:projectId,account:'prepaid_rent',debit:0,credit:prepaid});
      if(payable>0)lines.push({project:projectId,account:'payable',debit:0,credit:payable});
      validateLines(lines);
      const memo='إثبات مصروف إيجار عن الفترة حتى '+recognitionDate,journalId=uid();
      ops.push(db.prepare('INSERT OR IGNORE INTO journals(id,owner,date,memo,kind,lines,source,reversal,created) VALUES(?,?,?,?,?,?,?,NULL,?)').bind(journalId,owner,recognitionDate,memo,'bill',JSON.stringify(lines),source,time));
      w.journals.push({id:journalId,date:recognitionDate,memo,kind:'bill',lines,source,created:time});known.add(source);
     }
    }
   }
   if(periodEnd>today())break;
   cursor=iso(dayNo(periodEnd)+1);
  }
 }
 if(ops.length)await db.batch(ops);
}
function identify(req:Request){const owner=req.headers.get('oai-authenticated-user-id');if(!owner)throw Error('AUTH');return owner;}
export async function GET(req:Request){try{const owner=identify(req),db=database();await materializeDueAccruals(db,owner);return Response.json(await snapshot(db,owner),{headers:{'Cache-Control':'no-store'}});}catch(e:any){return Response.json({error:e.message==='AUTH'?'سجل الدخول للوصول إلى بياناتك.':'تعذر تحميل البيانات. حاول مجددًا.'},{status:e.message==='AUTH'?401:503});}}
function operatingRows(w:Workspace,year:number){const fy=fiscalYearForStart(w,year);return w.records.filter(r=>r.kind==='project'&&r.data.mode==='operating').map(r=>({...r.data,id:r.id,net:profit(w,r.id,fy.start,fy.end).net}));}
function ownerPolicyForYear(w:Workspace,year:number){const end=fiscalYearForStart(w,year).end;return w.records.filter(r=>r.kind==='ownerPolicy'&&String(r.data.effectiveFrom||'')<=end).sort((a,b)=>String(a.data.effectiveFrom||'').localeCompare(String(b.data.effectiveFrom||''))).at(-1);}
export async function POST(req:Request){try{const owner=identify(req);if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'طلب غير مسموح'},{status:403});if(!req.headers.get('content-type')?.includes('application/json'))throw Error('نوع الطلب غير صحيح.');const raw=await req.text();if(raw.length>100000)throw Error('حجم الطلب أكبر من المسموح.');const body=JSON.parse(raw);const action=str(body.action,50),id=str(body.requestId,100),p=body.payload||{};const db=database();if(await db.prepare('SELECT id FROM commands WHERE id=? AND owner=?').bind(id,owner).first())return Response.json({ok:true,replayed:true});await materializeDueAccruals(db,owner,action==='settle'?String(p.id||''):'',action==='settle'?String(p.date||today()):'');const w=await snapshot(db,owner),time=new Date().toISOString();let ops:D1PreparedStatement[]=[];const ledgerLocks=new Map<string,number>();const inserts:{id:string;kind:string;data:string}[]=[];
const patches=new Map<string,{id:string;version:number;data:string}>();
const guardProject=(pid:string)=>{const pr=w.records.find(r=>r.id===pid&&r.kind==='project');if(pr)ledgerLocks.set(pr.id,pr.version);};
const put=(kind:string,data:any,rid=uid())=>{inserts.push({id:rid,kind,data:JSON.stringify(data)});if(data.project)guardProject(data.project);return rid;};
const find=(rid:string,kind?:string)=>{const r=w.records.find(r=>r.id===rid&&(!kind||r.kind===kind));if(!r)throw Error('السجل غير موجود أو غير مسموح.');return r;};
const update=(r:any,data:any)=>{patches.set(r.id,{id:r.id,version:r.version,data:JSON.stringify(data)});if(data.project)guardProject(data.project);};
const money5=(v:any,label='المبلغ')=>{const s=String(v??'').trim().replace(/,/g,'');if(!/^\d+(?:\.\d{1,5})?$/.test(s))throw Error(label+' يجب أن يصل إلى 5 منازل عشرية كحد أقصى.');const [whole,frac='']=s.split('.');const micro=BigInt(whole)*BigInt(100000)+BigInt((frac+'00000').slice(0,5));if(micro<BigInt(0)||micro>BigInt(10000000000000))throw Error(label+' خارج النطاق المسموح.');return Number(micro)/100000;};
const planMoneyMicro=(v:any,label='المبلغ المخطط')=>Math.round(money5(v,label)*100000);
const projectPlansSnapshot=(ws:Workspace,pid:string)=>ws.records.filter((x:any)=>x.kind==='projectPlan'&&x.data.project===pid);
const halala=(v:any,label='المبلغ')=>{
 const s=String(v??'').trim().replace(/,/g,'');
 if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error(label+' يجب أن يكون بريالين عشريين كحد أقصى (هللات).');
 const [a,b='']=s.split('.'); const n=Number(a)*100+Number((b+'00').slice(0,2));
 if(!Number.isSafeInteger(n)||n<0||n>100000000000)throw Error(label+' خارج النطاق المسموح.');
 return n;
};
const percentBps=(v:any,label='النسبة')=>{
 const s=String(v??'').trim();
 if(!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(s))throw Error(label+' يجب أن تكون حتى منزلتين عشريتين.');
 const n=Number(s);if(!Number.isFinite(n)||n<0||n>100)throw Error(label+' يجب أن تكون بين 0% و100%.');
 return Math.round(n*100);
};
const taxPolicyFor=(w:Workspace,at:string)=>w.records.filter(r=>r.kind==='taxPolicy'&&String(r.data.effectiveFrom||'')<=at).sort((a,b)=>String(a.data.effectiveFrom||'').localeCompare(String(b.data.effectiveFrom||''))).at(-1)?.data||{enabled:false,rateBps:1500,defaultMode:'none',salesTax:true,purchaseTax:true};
const taxParts=(amount:number,mode:any,rateBps:number)=>{if(mode==='none'||rateBps<=0)return {base:amount,tax:0,total:amount};if(mode==='inclusive'){const tax=Math.round(amount*rateBps/(10000+rateBps));return {base:amount-tax,tax,total:amount};}const tax=Math.round(amount*rateBps/10000);return {base:amount,tax,total:amount+tax};};
const paymentAccounts=['cash','bank','mada','visa','mastercard','receivable'] as const;
const paymentLabels:Record<string,string>={cash:'كاش',bank:'الحساب البنكي',mada:'مدى',visa:'Visa',mastercard:'Mastercard',receivable:'آجل'};
const ensurePayment=(v:any)=>{if(!paymentAccounts.includes(v))throw Error('طريقة الإيداع غير صحيحة.');return v;};
const archivedProjectAllowedActions=new Set(['settle','settleLoans','projectSchedulePayment','cancelProjectCost','deleteLoan','cancelFunding','cancelFundingRepayment','fundingRepayment','settleCards','dailyReportCorrection','cancelContract','investmentReturn','returnCapital','reversal']);const project=(rid:string)=>{const r=find(rid,'project');if(r.data.status==='archived'&&!archivedProjectAllowedActions.has(action))throw Error('هذا المشروع مؤرشف للحفاظ على تاريخه المالي؛ لا يمكن تسجيل عمليات جديدة عليه.');if(r.data.mode==='investment')throw Error('الاستثمار الخارجي يسجل في دفاتر المشروع الممول.');return r;};
const journal=(kind:string,memo:string,d:string,lines:Line[],source:string|null=null,reversal:string|null=null)=>{validateLines(lines);date(d);if(d>today())throw Error('سجل العمليات المستقبلية في الالتزامات، وليس في القيود الفعلية.');for(const l of lines){if(!l.project)continue;const pr=project(l.project);ledgerLocks.set(pr.id,pr.version);if(pr.data.closedThrough&&d<=pr.data.closedThrough)throw Error('الفترة مقفلة في هذا المشروع.');}ops.push(db.prepare('INSERT INTO journals(id,owner,date,memo,kind,lines,source,reversal,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),owner,d,str(memo,500),kind,JSON.stringify(lines),source,reversal,time));};
const pair=(pr:string,debit:string,credit:string,a:number):Line[]=>[{project:pr,account:debit,debit:a,credit:0},{project:pr,account:credit,debit:0,credit:a}];
const directionLines=(pr:string,direction:string,category:string,a:number):Line[]=>direction==='out'?pair(pr,category,'payable',a):pair(pr,'receivable',category,a);
const due=(data:any,rid=uid())=>put('obligation',{status:'pending',...data},rid);
let description=action;
if(action==='saveReportPeriodPreference'){
 const start=date(p.start),end=date(p.end);
 if(start>end)throw Error('تاريخ بداية الفترة يجب ألا يتجاوز تاريخ نهايتها.');
 const existing=w.records.find(x=>x.kind==='appPreference'&&x.data.key==='selectedReportPeriod');
 const data={key:'selectedReportPeriod',start,end,updatedAt:time};
 if(existing)update(existing,data);else put('appPreference',data);
 description='حفظ تفضيل نطاق التقارير';
}

else if(action==='deleteFiscalYear'){
 const r=find(p.id,'fiscalYear');
 const linkedSettlement=w.records.find(x=>x.kind==='ownerSettlement'&&String(x.data.fiscalYearStart||'')===String(r.data.start||''));
 if(linkedSettlement)throw Error('لا يمكن حذف هذه الفترة لأنها مرتبطة بتسوية سنوية معتمدة. احتفظ بها للحفاظ على مرجع التسوية وسجل المراجعة.');
 ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(r.id,owner));
 description='حذف تعريف فترة مالية: '+String(r.data.label||r.data.start+' إلى '+r.data.end);
}
else if(action==='deleteRecord'){
 const r=find(p.id);
 const financialKinds=new Set(['projectCost','projectFunding','fundingRepayment','dailyReport','dailyReportCorrection','entry','obligation','lease','landPurchase','settlement','loan','loanSchedule','journal','ownerSettlement','ownerDistribution','investmentCycle','investmentReturn','payroll','payrollAdjustment','closing','fiscalYear']);
 if(financialKinds.has(r.kind)) throw Error('السجل المالي لا يُحذف نهائيًا حتى لا يختفي أثره من الأستاذ والتقارير. استخدم عكس القيد أو التصحيح من الشاشة المناسبة.');
 const refs=w.records.filter(x=>x.id!==r.id&&JSON.stringify(x.data).includes(r.id));
 const journalRefs=w.journals.filter(j=>j.source===r.id||j.reversal===r.id||JSON.stringify(j.lines).includes(r.id));
 if(refs.length||journalRefs.length) throw Error('لا يمكن حذف هذا السجل لأنه مرتبط بسجلات أخرى. احذف الروابط التابعة أولًا أو استخدم الإجراء المحاسبي الآمن.');
 ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(r.id,owner));
 description='حذف سجل غير مالي: '+r.kind;
}
else if(action==='projectCost'){
 const pr=project(str(p.project)),amount=cents(p.amount),dt=date(p.date||today());
 if(dt>today())throw Error('تاريخ المصروف الفعلي لا يمكن أن يكون في المستقبل.');
 if(amount<=0)throw Error('أدخل مبلغًا أكبر من صفر.');
 const category=['purchase','construction','maintenance','fees','utilities','other'].includes(p.category)?p.category:'other';
 const title=str(p.title||'تكلفة مشروع',200),notes=String(p.notes||'').trim().slice(0,1000);
 const paymentAccount=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash';
 const available=Number(balance(w,pr.id,dt)[paymentAccount]||0);
 if(amount>available)throw Error('الرصيد المتاح في '+(paymentAccount==='cash'?'الصندوق':'الحساب البنكي')+' لا يكفي لتسجيل التكلفة. سجّل التمويل/الرصيد الافتتاحي الصحيح أو اختر حساب الدفع الفعلي.');
 const treatment=['expense','asset'].includes(p.treatment)?p.treatment:'expense';
 const debitAccount=treatment==='asset'?'investment':'expense';
 const costId=put('projectCost',{project:pr.id,title,amount,date:dt,category,notes,status:'active',paymentAccount,treatment,createdAt:time});
 journal('projectCost',(treatment==='asset'?'إثبات تكلفة رأسمالية للمشروع: ':'إثبات مصروف فعلي للمشروع: ')+title,dt,pair(pr.id,debitAccount,paymentAccount,amount),'project-cost:'+costId);
 description=(treatment==='asset'?'تسجيل تكلفة رأسمالية':'تسجيل مصروف فعلي')+' للمشروع: '+pr.data.name+' — '+title;
}
else if(action==='postLegacyProjectCost'){
 const cost=find(str(p.id),'projectCost'),d=cost.data;
 if(d.status==='deleted'||d.status==='cancelled')throw Error('سجل التكلفة ملغى ولا يمكن ترحيله.');
 if(w.journals.some(j=>j.source==='project-cost:'+cost.id))throw Error('هذه التكلفة مرحّلة محاسبيًا بالفعل أو لها قيد تاريخي؛ لا تكرر الترحيل.');
 const pr=project(String(d.project||'')),dt=date(String(d.date||today())),amount=Number(d.amount||0);
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('قيمة التكلفة القديمة غير صحيحة؛ راجع السجل قبل الترحيل.');
 const paymentAccount=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash';
 const available=Number(balance(w,pr.id,dt)[paymentAccount]||0);
 if(amount>available)throw Error('الرصيد المسجل في حساب الدفع لا يكفي لترحيل التكلفة القديمة بأمان. راجع الرصيد الافتتاحي والحساب المستخدم قبل الترحيل.');
 const treatment=['expense','asset'].includes(p.treatment)?p.treatment:'expense';
 const debitAccount=treatment==='asset'?'investment':'expense';
 journal('projectCost',(treatment==='asset'?'ترحيل تكلفة رأسمالية قديمة: ':'ترحيل مصروف قديم: ')+String(d.title||'تكلفة مشروع'),dt,pair(pr.id,debitAccount,paymentAccount,amount),'project-cost:'+cost.id);
 update(cost,{...d,paymentAccount,treatment,postedAt:time,postingMethod:'legacy-review'});
 description='ترحيل تكلفة قديمة بعد تحديد حساب الدفع وطبيعة المعالجة المحاسبية';
}
else if(action==='cancelProjectCost'){
 const cost=find(str(p.id),'projectCost'),d=cost.data;
 if(['deleted','cancelled'].includes(d.status))throw Error('سجل التكلفة ملغى بالفعل.');
 const original=w.journals.find(j=>j.source==='project-cost:'+cost.id);
 const dt=date(p.date||today());
 if(original){
   if(w.journals.some(j=>j.reversal===original.id))throw Error('يوجد قيد عكسي لهذه التكلفة بالفعل؛ راجع سجل التدقيق قبل أي تعديل إضافي.');
   if(dt<original.date)throw Error('تاريخ إلغاء التكلفة لا يمكن أن يسبق تاريخ القيد الأصلي.');
   journal('reversal','عكس تكلفة مشروع: '+String(d.title||cost.id)+' — '+str(p.reason||'إلغاء تكلفة',200),dt,original.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,original.id);
 }
 update(cost,{...d,status:'cancelled',cancelledAt:dt,cancellationReason:str(p.reason||'إلغاء تكلفة من سجل المشروع',200)});
 description=original?'إلغاء تكلفة مع عكس قيدها المحاسبي والحفاظ على سجل التدقيق':'إلغاء سجل تكلفة غير مرحّل مع الاحتفاظ بالتاريخ';
}
else if(action==='projectCommitment'){
 const pr=project(str(p.project)),title=str(p.title||'التزام مشروع',200),party=String(p.party||'').trim().slice(0,200),total=cents(p.totalAmount),costType=['construction','rent','expense'].includes(p.costType)?p.costType:'construction';
 if(total<=0)throw Error('أدخل إجمالي الالتزام أكبر من صفر.');
 const scheduleType=['once','monthly','quarterly','semiannual','yearly','custom'].includes(p.scheduleType)?p.scheduleType:(p.installments?'custom':'monthly'),firstDate=date(p.firstDate||today());
 const installments:{date:string;amount:number;status:string;obligationId:string}[]=[];
 if(scheduleType==='custom'){
  const raw=str(p.installments||'',12000);
  for(const line of raw.split('\n')){const parts=line.split(',').map((x:string)=>x.trim());if(parts.length!==2)throw Error('صيغة الأقساط: التاريخ,المبلغ — كل قسط في سطر مستقل.');const dueDate=date(parts[0]),amount=cents(parts[1]);if(amount<=0)throw Error('مبلغ كل قسط يجب أن يكون أكبر من صفر.');installments.push({date:dueDate,amount,status:'pending',obligationId:''});}
 }else if(scheduleType==='once')installments.push({date:firstDate,amount:total,status:'pending',obligationId:''});
 else{
  const count=num(p.installmentCount??12,1,360);if(!Number.isInteger(count))throw Error('عدد الأقساط يجب أن يكون عددًا صحيحًا من 1 إلى 360.');if(count>total)throw Error('عدد الأقساط أكبر من الممكن بالنسبة إلى إجمالي المبلغ.');
  const step=scheduleType==='monthly'?1:scheduleType==='quarterly'?3:scheduleType==='semiannual'?6:12,base=Math.floor(total/count);let remaining=total;
  for(let i=0;i<count;i++){const amount=i===count-1?remaining:base;if(amount>0)installments.push({date:monthAdd(firstDate,i*step),amount,status:'pending',obligationId:''});remaining-=amount;}
 }
 if(!installments.length)throw Error('أدخل موعد قسط واحدًا على الأقل.');
 if(installments.reduce((sum,x)=>sum+x.amount,0)!==total)throw Error('مجموع الأقساط يجب أن يساوي إجمالي الالتزام بالضبط.');
 installments.sort((a,b)=>a.date.localeCompare(b.date));
 const commitmentId=uid();
 for(let i=0;i<installments.length;i++){const item=installments[i],obligationId=uid();item.obligationId=obligationId;due({project:pr.id,title:'قسط التزام — '+title+' / '+(i+1),amount:item.amount,date:item.date,direction:'out',category:costType==='rent'||costType==='expense'?'expense':'payable',certainty:100,projectCommitmentId:commitmentId,commitmentInstallment:i+1,party,costType},obligationId);}
 put('projectCommitment',{project:pr.id,title,party,totalAmount:total,scheduleType,costType,createdOn:today(),status:'active',installments},commitmentId);
 description='إضافة التزام مشروع وجدولة '+installments.length+' قسطًا دون اشتراط مصدر السيولة: '+title;
}
else if(action==='projectTenantLease'){
 const pr=project(str(p.project)),tenantName=str(p.tenantName,200),title=str(p.title||'عقد تأجير المشروع',200),start=date(p.startDate),end=date(p.endDate),mode=['once','monthly','quarterly','semiannual','yearly','custom'].includes(p.scheduleType)?p.scheduleType:'monthly';let total=cents(p.totalAmount);
 if(mode!=='monthly'&&total<=0)throw Error('أدخل إجمالي قيمة العقد أكبر من صفر.');
 if(end<start)throw Error('نهاية العقد يجب ألا تسبق بدايته.');
 if(w.records.some(r=>r.kind==='projectTenantLease'&&r.data.project===pr.id&&r.data.status==='active'&&String(r.data.startDate)<=end&&String(r.data.endDate)>=start))throw Error('يوجد عقد تأجير آخر متداخل على المشروع خلال هذه المدة.');
 let installments:{date:string;amount:number;status:string;obligationId:string}[]=[];
 if(mode==='custom'){
  const raw=str(p.installments||'',12000);
  installments=raw.split('\n').map((line:string)=>{const parts=line.split(',').map((x:string)=>x.trim());if(parts.length!==2)throw Error('صيغة الدفعات: التاريخ,المبلغ — كل دفعة في سطر مستقل.');return {date:date(parts[0]),amount:cents(parts[1]),status:'pending',obligationId:''};}).filter(x=>x.amount>0);
  if(!installments.length)throw Error('أدخل دفعة إيجار واحدة على الأقل.');
 }else{
  const first=date(p.paymentDate||start);
  if(first<start||first>end)throw Error('تاريخ أول تحصيل يجب أن يقع داخل مدة العقد.');
  if(mode==='once')installments=[{date:first,amount:total,status:'pending',obligationId:''}];
  else if(mode==='monthly'){
   const monthlyAmount=cents(p.monthlyAmount);if(monthlyAmount<=0)throw Error('أدخل قيمة الإيجار الشهري أكبر من صفر.');
   for(let i=0;i<360;i++){const dueDate=monthAdd(first,i);if(dueDate>end)break;installments.push({date:dueDate,amount:monthlyAmount,status:'pending',obligationId:''});}
   if(!installments.length)throw Error('لا توجد استحقاقات شهرية داخل مدة العقد.');
   total=installments.reduce((sum,x)=>sum+x.amount,0);
  }else{
   const step=mode==='yearly'?12:mode==='quarterly'?3:6;
   const startMonth=Number(start.slice(0,4))*12+Number(start.slice(5,7))-1,endMonth=Number(end.slice(0,4))*12+Number(end.slice(5,7))-1;
   const count=Math.floor((endMonth-startMonth)/step)+1,base=Math.floor(total/count);let remaining=total;
   for(let i=0;i<count;i++){const dueDate=monthAdd(first,i*step);if(dueDate>end)break;const amount=i===count-1?remaining:base;if(amount>0){installments.push({date:dueDate,amount,status:'pending',obligationId:''});remaining-=amount;}}
   if(remaining>0){if(installments.length)installments[installments.length-1].amount+=remaining;else installments=[{date:first,amount:total,status:'pending',obligationId:''}];}
  }
 }
 if(installments.some(x=>x.date<start||x.date>end))throw Error('تواريخ التحصيل يجب أن تقع داخل مدة العقد.');
 if(installments.reduce((sum,x)=>sum+x.amount,0)!==total)throw Error('مجموع دفعات الإيجار يجب أن يساوي إجمالي العقد بالضبط.');
 installments.sort((a,b)=>a.date.localeCompare(b.date));
 const leaseId=uid();
 for(let i=0;i<installments.length;i++){const item=installments[i],obligationId=uid();item.obligationId=obligationId;due({project:pr.id,title:'تحصيل إيجار — '+tenantName+' — '+title+' / '+(i+1),amount:item.amount,date:item.date,direction:'in',category:'receivable',certainty:100,projectTenantLeaseId:leaseId,tenantName,leaseInstallment:i+1,leaseTotal:total},obligationId);}
 put('projectTenantLease',{project:pr.id,title,tenantName,totalAmount:total,startDate:start,endDate:end,scheduleType:mode,status:'active',installments},leaseId);
 description='تسجيل عقد تأجير المشروع وجدولة '+installments.length+' تحصيلًا: '+tenantName;
}
else if(action==='projectSchedulePayment'){
 const r=find(str(p.id),'obligation'),d=r.data;
 if(!d.projectCommitmentId&&!d.projectTenantLeaseId&&!d.tenantLeaseId)throw Error('هذا الموعد ليس من سجلات تنظيم المشروع.');
 if(d.status!=='pending')throw Error('تم تسجيل هذا الموعد من قبل.');
 const paidOn=date(p.date||today());
 if(paidOn>today())throw Error('تاريخ التحصيل أو السداد الفعلي لا يمكن أن يكون في المستقبل.');
 update(r,{...d,status:'paid',paidOn});
 // Both current and legacy tenant-lease schedules must post actual receipts to the ledger.
 if((d.projectTenantLeaseId||d.tenantLeaseId)&&d.direction==='in'){
  const receiptAccount=ensurePayment(p.paymentAccount||'bank');
  if(receiptAccount==='receivable')throw Error('اختر حساب التحصيل الفعلي؛ لا يمكن تسجيل التحصيل على حساب آجل.');
  const source=d.projectTenantLeaseId?'project-tenant-rent-payment:'+r.id:'tenant-rent-payment:'+r.id;
  const memo=d.projectTenantLeaseId?'تحصيل إيجار مشروع فعلي: ':'تحصيل إيجار وحدة فعلي: ';
  journal('income',memo+String(d.title||'إيجار مستأجر'),paidOn,pair(d.project,receiptAccount,'revenue',Number(d.amount||0)),source);
 }
 if(d.projectCommitmentId&&d.direction==='out'){
  const commitment=w.records.find(x=>x.kind==='projectCommitment'&&x.id===d.projectCommitmentId);
  const costType=String(d.costType||commitment?.data.costType||'construction');
  const accrued=w.journals.find(j=>j.source==='obligation-accrual:'+r.id);
  const pay=['cash','bank','mada','visa','mastercard'].includes(p.paymentAccount)?p.paymentAccount:'cash';
  if(accrued)journal('settle','سداد قسط مشروع: '+String(d.title||'التزام مشروع'),paidOn,[{project:d.project,account:'payable',debit:Number(d.amount||0),credit:0},{project:d.project,account:pay,debit:0,credit:Number(d.amount||0)}],'project-commitment-payment:'+r.id);
  else {const debitAccount=costType==='construction'?'fixed':'expense';if(costType==='construction'){const assetId=put('projectAsset',{project:d.project,category:'construction',categoryLabel:'إنشاءات وبناء',description:String(d.title||'تكلفة إنشاء'),amount:Number(d.amount||0),account:'fixed',paymentAccount:pay,date:paidOn,status:'active',sourceObligation:r.id});journal('projectAsset','سداد تكلفة إنشاء رأسمالية: '+String(d.title||'التزام مشروع'),paidOn,[{project:d.project,account:'fixed',debit:Number(d.amount||0),credit:0},{project:d.project,account:pay,debit:0,credit:Number(d.amount||0)}],'project-asset:'+assetId);}else journal('expense','سداد مصروف مشروع: '+String(d.title||'التزام مشروع'),paidOn,[{project:d.project,account:debitAccount,debit:Number(d.amount||0),credit:0},{project:d.project,account:pay,debit:0,credit:Number(d.amount||0)}],'project-commitment-payment:'+r.id);}
 }
 const parentId=d.projectCommitmentId||d.projectTenantLeaseId||d.tenantLeaseId,parentKind=d.projectCommitmentId?'projectCommitment':d.projectTenantLeaseId?'projectTenantLease':'tenantLease';
 const parent=find(parentId,parentKind);
 const installments=(Array.isArray(parent.data.installments)?parent.data.installments:[]).map((x:any,i:number)=>x.obligationId===r.id||(parentKind==='tenantLease'&&i+1===Number(d.leaseInstallment))?{...x,status:'paid',paidOn,obligationId:r.id}:x);
 const allPaid=installments.length>0&&installments.every((x:any)=>x.status==='paid');
 update(parent,{...parent.data,installments,status:parentKind==='projectCommitment'?(allPaid?'completed':'active'):parent.data.status,updatedAt:time});
 description=(d.direction==='in'?'تسجيل تحصيل مستأجر مع إثبات القيد المحاسبي':'تسجيل سداد التزام مشروع مع إثبات القيد المحاسبي')+': '+d.title;
}
// Keep the original rent due auditable while moving its value to a later scheduled collection.
else if(action==='deferRentInstallment'){
 const current=find(str(p.id),'obligation'),d=current.data;
 const parentId=d.projectTenantLeaseId||d.tenantLeaseId;
 const parentKind=d.projectTenantLeaseId?'projectTenantLease':d.tenantLeaseId?'tenantLease':'';
 if(!parentId||!parentKind||d.direction!=='in')throw Error('ترحيل الموعد متاح فقط لتحصيل إيجار مرتبط بعقد مستأجر.');
 if(d.status!=='pending')throw Error('لا يمكن ترحيل قسط تمت تسويته أو ترحيله مسبقًا.');
 const requestedDate=date(p.date);
 if(requestedDate<=String(d.date||''))throw Error('اختر تاريخ ترحيل بعد تاريخ الاستحقاق الأصلي.');
 const parent=find(parentId,parentKind);
 const siblings=w.records.filter(x=>x.kind==='obligation'&&(x.data.projectTenantLeaseId===parentId||x.data.tenantLeaseId===parentId)&&x.id!==current.id&&x.data.status==='pending'&&String(x.data.date||'')>=requestedDate).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date)));
 const target=siblings[0];
 const amount=Number(d.amount||0);
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('قيمة قسط الإيجار غير صالحة للترحيل.');
 const targetId=target?.id||uid(),targetDate=target?String(target.data.date):requestedDate;
 if(target)update(target,{...target.data,title:String(target.data.title||'إيجار مستحق')+' + قسط مرحّل',amount:Number(target.data.amount||0)+amount,deferredRentFrom:[...(Array.isArray(target.data.deferredRentFrom)?target.data.deferredRentFrom:[]),current.id]});
 else due({...d,status:'pending',date:targetDate,title:String(d.title||'إيجار مستحق')+' — قسط مرحّل',amount,paidOn:undefined,deferredFrom:current.id,leaseInstallment:(Array.isArray(parent.data.installments)?parent.data.installments.length:0)+1},targetId);
 update(current,{...d,status:'replaced',replacedBy:targetId,deferredToDate:targetDate,deferredAmount:amount,updatedAt:time});
 const items=Array.isArray(parent.data.installments)?parent.data.installments.slice():[];
 let foundCurrent=false;
 const revised=items.map((x:any)=>{if(x.obligationId===current.id){foundCurrent=true;return {...x,amount:0,status:'deferred',deferredAmount:amount,deferredToDate:targetDate,replacedBy:targetId};}if(target&&x.obligationId===target.id){return {...x,amount:Number(x.amount||0)+amount};}return x;});
 if(!foundCurrent)throw Error('تعذر مطابقة القسط مع جدول العقد؛ لم يتم ترحيل أي مبلغ.');
 if(!target)revised.push({date:targetDate,amount,status:'pending',obligationId:targetId,deferredFrom:current.id});
 update(parent,{...parent.data,installments:revised,updatedAt:time});
 description='ترحيل قسط إيجار '+d.title+' إلى '+targetDate+' دون تسجيل تحصيل فعلي';
}
else if(action==='project'){
 const projectId=uid(),name=str(p.name),parentIdRaw=String(p.parentId||'').trim(),parentId=parentIdRaw==='none'?'':parentIdRaw,propertyRole=['standard','land_owned','land_leased','building','unit'].includes(p.propertyRole)?p.propertyRole:'standard';
 const parent=parentId?find(parentId,'project'):null;
 if(parent?.data.status==='archived')throw Error('لا يمكن إضافة فروع جديدة إلى مشروع مؤرشف.');
 if(propertyRole==='unit'&&!parent)throw Error('الوحدة الفرعية يجب أن ترتبط بمشروع رئيسي.');
 if(parent&&parent.data.propertyRole==='unit')throw Error('لا يمكن إنشاء تفرع داخل وحدة عقارية؛ اختر المشروع الرئيسي أو المبنى.');
 const unitCountRaw=Number(p.unitCount||0);if(!Number.isInteger(unitCountRaw)||unitCountRaw<0||unitCountRaw>100)throw Error('عدد الوحدات يجب أن يكون عددًا صحيحًا من صفر إلى 100.');const unitCount=unitCountRaw;
 if(unitCount>0&&(parent||!['land_owned','land_leased','building'].includes(propertyRole)))throw Error('إنشاء وحدات متعددة متاح للمشروع العقاري الرئيسي فقط.');
 const monthlyRevenueMicro=planMoneyMicro(p.expectedMonthlyRevenue||0,'الإيراد الشهري المتوقع'),dailyRevenueMicro=planMoneyMicro(p.expectedDailyRevenue||0,'الإيراد اليومي المتوقع'),monthlyExpenseMicro=planMoneyMicro(p.expectedMonthlyExpense||0,'المصروف الشهري المتوقع'),monthlyNetMicro=planMoneyMicro(p.expectedNetMonthly||0,'صافي الدخل الشهري المتوقع');
 const base={name,activity:p.activity?str(p.activity,200):'متابعة مشروع',mode:['operating','investment'].includes(p.mode)?p.mode:'operating',managementMode:['self','leased','preparing','vacant'].includes(p.managementMode)?p.managementMode:propertyRole==='unit'?'vacant':'self',ownership:num(p.ownership??100,0.01,100),reserve:cents(p.reserve||0),payout:num(p.payout??30,0,100),expectedNetMonthly:monthlyNetMicro/1000,partner:p.partner?str(p.partner):'',closedThrough:'',parentId:parent?.id||'',propertyRole,unitNumber:null};
 put('project',base,projectId);
 if(base.mode==='operating')put('projectPlan',{project:projectId,effectiveFrom:date(p.planEffectiveFrom||today()),revenueMonthlyMicro:monthlyRevenueMicro,revenueDailyMicro:dailyRevenueMicro,expenseMonthlyMicro:monthlyExpenseMicro,expenseDailyMicro:0,netMonthlyMicro:monthlyNetMicro,source:'original_baseline',label:'الخطة الأصلية'});
 for(let i=1;i<=unitCount;i++){
  const childId=uid(),childName=name+' — '+(p.unitLabel?str(p.unitLabel,40)+' ':'')+i;
  put('project',{...base,name:childName,activity:'وحدة عقارية تابعة لـ '+name,managementMode:'vacant',parentId:projectId,propertyRole:'unit',unitNumber:i,expectedNetMonthly:0,reserve:0},childId);
  if(base.mode==='operating')put('projectPlan',{project:childId,effectiveFrom:date(p.planEffectiveFrom||today()),revenueMonthlyMicro:0,revenueDailyMicro:0,expenseMonthlyMicro:0,expenseDailyMicro:0,netMonthlyMicro:0,source:'original_baseline',label:'الخطة الأصلية'});
 }
 description='إضافة مشروع'+(parent?' فرعيًا تحت '+parent.data.name:'')+': '+name+(unitCount?' وإنشاء '+unitCount+' وحدة عقارية':'');
}
else if(action==='deleteProject'){
 const r=find(p.id,'project');
 if(r.data.status==='archived')throw Error('هذا المشروع مؤرشف بالفعل.');
 const projectId=r.id;
 if(w.records.some(x=>x.kind==='project'&&String(x.data.parentId||'')===projectId))throw Error('لا يمكن حذف مشروع رئيسي لديه فروع. احذف أو انقل الوحدات التابعة أولًا حتى لا تضيع بياناتها المالية.');
 const confirmName=str(p.confirmName||'',120);
 if(confirmName!==String(r.data.name||''))throw Error('اكتب اسم المشروع كاملًا لتأكيد الحذف.');
 const linkedRecords=w.records.filter(x=>x.id!==projectId&&x.data&&Object.values(x.data).some(v=>v===projectId));
 const linkedEmployeeIds=new Set(w.records.filter(x=>x.kind==='employee'&&x.data.project===projectId).map(x=>x.id));
 const employeeRecords=w.records.filter(x=>linkedEmployeeIds.has(x.data?.employee));
 const allRecordIds=new Set([projectId,...linkedRecords.map(x=>x.id),...employeeRecords.map(x=>x.id)]);
 const projectJournals=w.journals.filter(j=>j.lines.some(l=>l.project===projectId));
 const financialKinds=new Set(['projectCost','projectCommitment','projectAsset','landPurchase','projectFunding','fundingRepayment','loan','loanAllocation','loanUse','obligation','lease','tenantLease','projectTenantLease','dailyReport','dailyReportCorrection','entry','settlement','payroll','payrollAdjustment','ownerSettlement','ownerDistribution','investmentCycle','investmentReturn']);
 const hasOperationalHistory=linkedRecords.some(x=>financialKinds.has(x.kind))||employeeRecords.length>0;
 if(projectJournals.length||hasOperationalHistory){
   update(r,{...r.data,status:'archived',archivedAt:time,archiveReason:str(p.reason||'أرشفة للحفاظ على التاريخ المالي',200)});
   description='أرشفة المشروع مع الاحتفاظ بالقيود والسجلات التاريخية دون عكس الأرباح أو حذف البيانات: '+r.data.name;
 }else{
   ledgerLocks.delete(projectId);
   for(const x of w.records.filter(x=>allRecordIds.has(x.id)))ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(x.id,owner));
   description='حذف مشروع فارغ لا يحتوي على تاريخ مالي: '+r.data.name;
 }
}
else if(action==='projectSettings'){const r=find(p.id,'project');if(r.data.status==='archived')throw Error('لا يمكن تعديل إعدادات مشروع مؤرشف.');if(p.version!==r.version)throw Error('تغيرت البيانات. حدث الصفحة.');const oldPlan=projectPlansSnapshot(w,r.id);const legacyNetChanged=String(p.expectedNetMonthly??'')!==''&&halala(p.expectedNetMonthly,'صافي الدخل الشهري المتوقع')!==Number(r.data.expectedNetMonthly||0);const explicitTarget=String(p.expectedNetProfit??'')!==''||String(p.targetPeriod??'')!==''||String(p.expectedReceiptDate??'')!=='';const planChanged=explicitTarget||legacyNetChanged||['expectedMonthlyRevenue','expectedDailyRevenue','expectedMonthlyExpense'].some(k=>String(p[k]??'')!=='');update(r,{...r.data,name:str(p.name),managementMode:['self','leased','preparing','vacant'].includes(p.managementMode)?p.managementMode:(r.data.managementMode||'self'),reserve:cents(p.reserve),payout:num(p.payout,0,100),expectedNetMonthly:p.expectedNetMonthly?halala(p.expectedNetMonthly,'صافي الدخل الشهري المتوقع'):0,partner:p.partner?str(p.partner):''});if(r.data.mode==='operating'&&planChanged){const previousPlan=oldPlan.at(-1)?.data||{};const targetPeriod=explicitTarget?(p.targetPeriod==='annual'?'annual':'monthly'):(legacyNetChanged?'monthly':previousPlan.targetPeriod==='annual'?'annual':'monthly');const targetRaw=String(p.expectedNetProfit??'')!==''?p.expectedNetProfit:legacyNetChanged?p.expectedNetMonthly:Number(previousPlan.netTargetMicro||0)/100000;const targetMicro=planMoneyMicro(targetRaw,'صافي الربح المستهدف');const receiptDate=String(p.expectedReceiptDate??'')!==''?date(p.expectedReceiptDate):String(previousPlan.expectedReceiptDate||'');const rawInstallments=Array.isArray(p.expectedReceiptInstallments)?p.expectedReceiptInstallments:(Array.isArray(previousPlan.expectedReceiptInstallments)?previousPlan.expectedReceiptInstallments:[]);const expectedReceiptInstallments=rawInstallments.map((x:any)=>{const start=date(x.date);const repeatUntil=x.repeatUntil?date(x.repeatUntil):'';const rawInterval=x.repeatEveryMonths===undefined?(repeatUntil?1:0):Number(x.repeatEveryMonths);if(!Number.isInteger(rawInterval)||rawInterval<0||rawInterval>120)throw Error('تكرار الدفعة يجب أن يكون مرة واحدة أو كل 1 إلى 120 شهرًا.');if(rawInterval>0&&!repeatUntil)throw Error('حدد تاريخ نهاية التكرار للدفعة المتكررة.');if(repeatUntil&&repeatUntil<start)throw Error('نهاية تكرار الدفعة يجب ألا تسبق تاريخ بدايتها.');return {date:start,amountMicro:planMoneyMicro(x.amount,'مبلغ دفعة التحصيل المتوقع'),...(repeatUntil?{repeatUntil}:{}),...(rawInterval>0?{repeatEveryMonths:rawInterval}:{})};});if(expectedReceiptInstallments.some((x:any)=>x.amountMicro<=0))throw Error('مبلغ كل دفعة متوقعة يجب أن يكون أكبر من صفر.');put('projectPlan',{project:r.id,effectiveFrom:date(p.planEffectiveFrom||today()),revenueMonthlyMicro:planMoneyMicro(p.expectedMonthlyRevenue||0,'الإيراد الشهري المتوقع'),revenueDailyMicro:planMoneyMicro(p.expectedDailyRevenue||0,'الإيراد اليومي المتوقع'),expenseMonthlyMicro:planMoneyMicro(p.expectedMonthlyExpense||0,'المصروف الشهري المتوقع'),expenseDailyMicro:0,netMonthlyMicro:targetPeriod==='monthly'?targetMicro:Math.round(targetMicro/12),netAnnualMicro:targetPeriod==='annual'?targetMicro:0,netTargetMicro:targetMicro,targetPeriod,expectedReceiptDate:receiptDate,expectedReceiptInstallments,source:'plan_revision',label:'خطة صافي الربح المعدلة'});}description='تعديل إعدادات مشروع: '+r.data.name;}
else if(action==='setFiscalYear'||action==='fiscalYear'){const start=date(p.start);const end=date(p.end);if(start>=end)throw Error('بداية السنة المالية يجب أن تسبق نهايتها.');if((start.slice(0,4)==='')||(end.slice(0,4)===''))throw Error('تواريخ السنة المالية غير صحيحة.');const same=p.id?w.records.find(x=>x.kind==='fiscalYear'&&x.id===p.id):w.records.find(x=>x.kind==='fiscalYear'&&String(x.data.start)===start&&String(x.data.end)===end);const overlap=w.records.find(x=>x.kind==='fiscalYear'&&x.id!==same?.id&&String(x.data.start)<=end&&String(x.data.end)>=start);if(overlap)throw Error('الفترة تتداخل مع سنة مالية أخرى مسجلة ('+String(overlap.data.start)+' إلى '+String(overlap.data.end)+'). راجع حدود الفترتين.');const data={start,end,label:str(p.label||('السنة المالية '+start+' إلى '+end),120)};if(same)update(same,data);else put('fiscalYear',data);description=(same?'تعديل':'تحديد')+' السنة المالية من '+start+' إلى '+end;}
else if(action==='closePeriod'){const r=project(p.id);const d=date(p.date);if(d>today()||d<(r.data.closedThrough||''))throw Error('يمكن فقط إقفال فترة منتهية بعد آخر إقفال.');if(r.data.closedThrough&&d===r.data.closedThrough)throw Error('المشروع مقفل بالفعل حتى هذا التاريخ. اختر نهاية فترة مفتوحة لاحقة.');update(r,{...r.data,closedThrough:d});description='إقفال فترة '+r.data.name+' حتى '+d;}
else if(action==='projectAsset'){
 const pr=project(str(p.project)),amount=cents(p.amount),dt=date(p.date),category=String(p.category||'');
 const mapping:Record<string,{account:string;label:string}>={construction:{account:'fixed',label:'إنشاءات وبناء'},land:{account:'fixed',label:'أرض'},equipment:{account:'fixed',label:'معدات وتجهيزات'},furniture:{account:'fixed',label:'أثاث'},inventory:{account:'inventory',label:'بضاعة ومخزون'},other:{account:'fixed',label:'أصل آخر'}};
 const selected=mapping[category];if(!selected)throw Error('اختر تصنيفًا صحيحًا لاستخدام السيولة.');
 if(!amount||amount<=0)throw Error('أدخل مبلغًا أكبر من صفر.');
 const payment=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash';
 const available=w.journals.filter(j=>String(j.date||'')<=dt).flatMap(j=>j.lines).filter(l=>l.project===pr.id&&l.account===payment).reduce((sum,l)=>sum+l.debit-l.credit,0);
 if(amount>available)throw Error('المبلغ يتجاوز رصيد '+(payment==='bank'?'الحساب البنكي':'الصندوق')+' المتاح داخل المشروع. حدّث الأرصدة أو اختر مصدر السيولة الصحيح.');
 const descriptionText=str(p.description||selected.label,300);
 const assetId=put('projectAsset',{project:pr.id,category,categoryLabel:selected.label,description:descriptionText,amount,account:selected.account,paymentAccount:payment,date:dt,status:'active'});
 journal('projectAsset','تحويل سيولة إلى أصل بالمشروع: '+selected.label+' — '+descriptionText,dt,pair(pr.id,selected.account,payment,amount),'project-asset:'+assetId);
 description='تسجيل استخدام السيولة كرأس مال/أصل داخل المشروع: '+selected.label;
}
else if(action==='landPurchase'){
  const pr=project(p.project),title=str(p.title||'شراء أرض أو أصل بالتقسيط',200),seller=str(p.seller||'غير محدد',200),total=cents(p.totalAmount),down=cents(p.downPayment||0),contractDate=date(p.date),firstDate=date(p.firstDate||p.date),assetType=['land','building','construction','other'].includes(p.assetType)?p.assetType:'land',scheduleType=['once','monthly','quarterly','semiannual','yearly','custom'].includes(p.scheduleType)?p.scheduleType:'monthly',paymentAccount=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'bank';
  if(total<=0)throw Error('أدخل إجمالي سعر الشراء أكبر من صفر.');
  if(down>total)throw Error('الدفعة المقدمة لا يمكن أن تتجاوز إجمالي سعر الشراء.');
  if(contractDate>today())throw Error('تاريخ عقد الشراء الفعلي لا يمكن أن يكون في المستقبل؛ سجّل المواعيد المستقبلية في جدول الأقساط.');
  if(firstDate<contractDate)throw Error('تاريخ أول قسط لا يمكن أن يسبق تاريخ عقد الشراء.');
  if(down>0){const available=balance(w,pr.id,contractDate)[paymentAccount]||0;if(down>available)throw Error('الدفعة المقدمة تتجاوز رصيد '+(paymentAccount==='bank'?'البنك':'الكاش')+' المسجل للمشروع في تاريخ الشراء.');}
  const remaining=total-down,installments:{date:string;amount:number}[]=[];
  if(remaining>0){
   if(scheduleType==='custom'){
    const raw=str(p.installments||'',12000);
    for(const line of raw.split('\n')){const parts=line.split(',').map((x:string)=>x.trim());if(parts.length!==2)throw Error('صيغة الأقساط المخصصة: التاريخ,المبلغ');installments.push({date:date(parts[0]),amount:cents(parts[1])});}
    if(!installments.length||installments.some(x=>x.amount<=0))throw Error('أدخل أقساطًا مخصصة موجبة.');
    if(installments.reduce((sum,x)=>sum+x.amount,0)!==remaining)throw Error('مجموع الأقساط يجب أن يساوي المتبقي بعد الدفعة المقدمة بالهللة.');
   }else if(scheduleType==='once')installments.push({date:firstDate,amount:remaining});
   else{
    const count=num(p.installmentCount??12,1,360);if(!Number.isInteger(count))throw Error('عدد الأقساط يجب أن يكون عددًا صحيحًا من 1 إلى 360.');
    const step=scheduleType==='monthly'?1:scheduleType==='quarterly'?3:scheduleType==='semiannual'?6:12,base=Math.floor(remaining/count);let residue=remaining;
    for(let i=0;i<count;i++){const amount=i===count-1?residue:base;if(amount>0)installments.push({date:monthAdd(firstDate,i*step),amount});residue-=amount;}
   }
   if(installments.some(x=>x.date<contractDate))throw Error('تاريخ القسط لا يمكن أن يسبق عقد الشراء.');
   installments.sort((a,b)=>a.date.localeCompare(b.date));
   if(installments.reduce((sum,x)=>sum+x.amount,0)!==remaining)throw Error('مجموع الأقساط لا يطابق الرصيد المتبقي.');
  }
  const landId=put('landPurchase',{project:pr.id,title,seller,assetType,totalAmount:total,downPayment:down,remainingAmount:remaining,contractDate,firstDate,scheduleType,paymentAccount,status:remaining>0?'active':'completed',installments});
  const lines:Line[]=[{project:pr.id,account:'fixed',debit:total,credit:0}];
  if(down>0)lines.push({project:pr.id,account:paymentAccount,debit:0,credit:down});
  if(remaining>0)lines.push({project:pr.id,account:'payable',debit:0,credit:remaining});
  journal('asset','إثبات شراء أصل بالتقسيط — '+title+' — '+seller,contractDate,lines,'land-purchase:'+landId);
  for(const [i,item] of installments.entries())due({project:pr.id,title:'قسط شراء — '+title+' / '+(i+1),amount:item.amount,date:item.date,direction:'out',category:'payable',certainty:100,landPurchaseId:landId,paymentAccount,installmentNo:i+1,installmentCount:installments.length,totalAmount:total});
  description='تسجيل عقد شراء أصل '+title+' بقيمة '+(total/100).toFixed(2)+' ريال وجدولة '+installments.length+' قسط';
 }
 else if(action==='entry'){const pr=project(p.project),a=cents(p.amount);if(!a)throw Error('المبلغ يجب أن يكون أكبر من صفر.');const policy=taxPolicyFor(w,date(p.date));const taxableKind=['income','invoice','expense','bill','asset','inventory'].includes(p.kind);const taxMode=['none','inclusive','exclusive'].includes(p.taxMode)?p.taxMode:(taxableKind&&policy.enabled?policy.defaultMode:'none');const taxRate=percentBps(p.taxRate??(Number(policy.rateBps||0)/100),'نسبة الضريبة');const mappings:Record<string,string[]>={income:['cash','revenue'],invoice:['receivable','revenue'],collect:['cash','receivable'],expense:['expense','cash'],bill:['expense','payable'],paybill:['payable','cash'],capital:['cash','capital'],asset:['fixed','cash'],inventory:['inventory','cash'],cogs:['cogs','inventory'],depreciation:['depreciation','accumulated'],invest:['investment','cash'],dividend:['cash','dividend'],returnCapital:['cash','investment'],distribution:['distribution','cash'],cardSettlement:['bank','mada'],investmentStart:['investment','cash'],investmentReturn:['cash','investment']};let lines:Line[]=[];if(p.kind==='transfer'){project(p.target);if(p.target===p.project)throw Error('اختر مشروعين مختلفين.');lines=[...pair(p.project,'inter_receivable','cash',a),...pair(p.target,'cash','inter_payable',a)];}else if(p.kind==='repayTransfer'){project(p.target);if(p.target===p.project)throw Error('اختر مشروعين مختلفين.');if(a>Math.min(internalFunding(w,p.target,p.project,date(p.date)),internalFunding(w,p.target,p.project)))throw Error('المبلغ يتجاوز التمويل المستحق للمشروع المحدد.');lines=[...pair(p.project,'inter_payable','cash',a),...pair(p.target,'cash','inter_receivable',a)];}else if(p.kind==='manual'){if(p.debit===p.credit)throw Error('طرفا القيد يجب أن يكونا مختلفين.');if(['inter_receivable','inter_payable','distribution','loan','investment'].includes(p.debit)||['inter_receivable','inter_payable','distribution','loan','investment'].includes(p.credit))throw Error('لهذه الحسابات استخدم التحويل أو التوزيع أو التمويل أو الاستثمار المخصص لحفظ ترابط السجلات.');lines=pair(p.project,str(p.debit),str(p.credit),a);}else{if(!mappings[p.kind])throw Error('نوع حركة غير معروف.');const isSale=['income','invoice'].includes(p.kind),isPurchase=['expense','bill','asset','inventory'].includes(p.kind);if(taxMode!=='none'&&!policy.enabled)throw Error('الضريبة غير مفعلة في سياسة الفترة؛ فعّلها أو اختر بدون ضريبة.');if(taxMode!=='none'&&!((isSale&&policy.salesTax)||(isPurchase&&policy.purchaseTax)))throw Error('هذه الحركة لا تستخدم الضريبة حسب السياسة الحالية.');if(taxMode==='none')lines=pair(p.project,mappings[p.kind][0],mappings[p.kind][1],a);else{const t=taxParts(a,taxMode,taxRate);const debitAccount=mappings[p.kind][0],creditAccount=mappings[p.kind][1];if(isSale)lines=[{project:p.project,account:debitAccount,debit:t.total,credit:0},{project:p.project,account:creditAccount,debit:0,credit:t.base},...(t.tax?[{project:p.project,account:'tax_payable',debit:0,credit:t.tax}]:[])];else if(isPurchase)lines=[{project:p.project,account:debitAccount,debit:t.base,credit:0},...(t.tax?[{project:p.project,account:'tax_receivable',debit:t.tax,credit:0}]:[]),{project:p.project,account:creditAccount,debit:0,credit:t.total}];else lines=pair(p.project,debitAccount,creditAccount,a);}}if(p.kind==='distribution'){if(date(p.date)!==today())throw Error('توزيع الأرباح متاح بتاريخ اليوم لضمان فحص السيولة الحالية.');const entitlement=distributionEntitlement(w,pr);const f=forecast(w,p.project,pr.data.reserve,0,0,a);if(a>entitlement||f.min<pr.data.reserve)throw Error('السحب يتجاوز استحقاق المالك أو ينزل السيولة المتوقعة تحت الاحتياطي. راجع مركز القرار.');}if(['invest','dividend','returnCapital'].includes(p.kind)){find(p.investment,'project');if(find(p.investment).data.mode!=='investment')throw Error('اختر استثمارًا خارجيًا.');if(p.kind==='returnCapital'){const invested=w.journals.filter(j=>j.source?.startsWith('investment:'+p.investment+':')).flatMap(j=>j.lines).filter(l=>l.project===p.project&&l.account==='investment').reduce((s,l)=>s+l.debit-l.credit,0);if(a>invested)throw Error('الاسترداد يتجاوز رأس المال المسجل لهذا الاستثمار.');}}journal(p.kind,str(p.memo,500),date(p.date),lines,p.investment?'investment:'+p.investment+':'+id:null);description='تسجيل حركة مالية: '+p.memo;}
else if(action==='reverse'){const j=w.journals.find(x=>x.id===p.id);if(!j||j.reversal||j.source)throw Error('يمكن عكس القيود المباشرة فقط. القيود المرتبطة بالتزامات تحتاج تسوية مخصصة.');if(w.journals.some(x=>x.reversal===j.id))throw Error('تم عكس هذا القيد بالفعل.');journal('reversal','عكس: '+j.memo+' — '+str(p.reason,200),date(p.date),j.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,j.id);description='عكس قيد مع الاحتفاظ بالأصل';}
else if(action==='propertyUnit'){
 const pr=project(p.project),name=str(p.name),unitType=['retail','residential','office','other'].includes(p.unitType)?p.unitType:'retail',operatingMode=p.operatingMode==='self'?'self':'rent';
 if(w.records.some(r=>r.kind==='propertyUnit'&&r.data.project===pr.id&&String(r.data.name||'').trim().toLowerCase()===name.toLowerCase()&&r.data.status!=='archived'))throw Error('اسم الفتحة/الوحدة موجود بالفعل في هذا المشروع.');
 const areaRaw=String(p.area??'').trim(),area=areaRaw?num(areaRaw,0,1000000):0;
 put('propertyUnit',{project:pr.id,name,unitType,operatingMode,area,notes:String(p.notes||'').trim().slice(0,500),status:'active',createdOn:today()});
 description='إضافة وحدة عقارية: '+name+' — '+pr.data.name;
}
else if(action==='editPropertyUnit'){
 const unit=find(p.id,'propertyUnit'),pr=project(unit.data.project),name=str(p.name),unitType=['retail','residential','office','other'].includes(p.unitType)?p.unitType:'retail',operatingMode=p.operatingMode==='self'?'self':'rent';
 if(w.records.some(r=>r.kind==='propertyUnit'&&r.id!==unit.id&&r.data.project===pr.id&&String(r.data.name||'').trim().toLowerCase()===name.toLowerCase()&&r.data.status!=='archived'))throw Error('اسم الفتحة/الوحدة موجود بالفعل في هذا المشروع.');
 const activeLeases=w.records.filter(r=>r.kind==='tenantLease'&&r.data.unitId===unit.id&&r.data.status==='active'&&String(r.data.endDate||'')>=today());
 if(operatingMode==='self'&&activeLeases.length)throw Error('لا يمكن تحويل الوحدة إلى تشغيل ذاتي ما دام عليها عقد إيجار نشط أو مستقبلي. أنهِ العقود أولًا.');
 const areaRaw=String(p.area??'').trim(),area=areaRaw?num(areaRaw,0,1000000):0;
 update(unit,{...unit.data,name,unitType,operatingMode,area,notes:String(p.notes||'').trim().slice(0,500),updatedAt:time});
 description='تعديل إعدادات الوحدة العقارية: '+name;
}
else if(action==='tenantLease'){
 const pr=project(p.project),unit=find(p.unitId,'propertyUnit'),tenantName=str(p.tenantName),title=str(p.title||'عقد إيجار '+unit.data.name,200),start=date(p.startDate),end=date(p.endDate),total=cents(p.totalAmount);
 if(unit.data.project!==pr.id||unit.data.status==='archived')throw Error('الوحدة المحددة لا تتبع هذا المشروع أو مؤرشفة.');
 if(unit.data.operatingMode==='self')throw Error('هذه الوحدة محددة للتشغيل الذاتي. عدّل نمط الوحدة إلى التأجير قبل تسجيل عقد مستأجر.');
 if(end<start)throw Error('نهاية العقد يجب أن تكون بعد بدايته.');
 if(total<=0)throw Error('أدخل إجمالي إيجار أكبر من صفر.');
 if(w.records.some(r=>r.kind==='tenantLease'&&r.data.unitId===unit.id&&r.data.status==='active'&&String(r.data.startDate)<=end&&String(r.data.endDate)>=start))throw Error('توجد مدة عقد متداخلة لهذه الوحدة. أنهِ العقد السابق أو اختر فترة مختلفة.');
 const mode=['once','monthly','quarterly','semiannual','yearly','custom'].includes(p.scheduleType)?p.scheduleType:'monthly';
 let installments:{date:string;amount:number}[]=[];
 if(mode==='custom'){
  const raw=str(p.installments||'',12000);
  installments=raw.split('\n').map((line:string)=>{const parts=line.split(',').map(x=>x.trim());if(parts.length!==2)throw Error('صيغة الدفعات: التاريخ,المبلغ');return {date:date(parts[0]),amount:cents(parts[1])};}).filter(x=>x.amount>0);
  if(!installments.length)throw Error('أدخل دفعة إيجار واحدة على الأقل.');
 }else{
  const first=date(p.paymentDate||start);
  if(mode==='once')installments=[{date:first,amount:total}];
  else{
   const step=mode==='monthly'?1:mode==='quarterly'?3:mode==='yearly'?12:6;
   const startMonth=Number(start.slice(0,4))*12+Number(start.slice(5,7))-1,endMonth=Number(end.slice(0,4))*12+Number(end.slice(5,7))-1;
   const count=Math.floor((endMonth-startMonth)/step)+1,base=Math.floor(total/count);let remaining=total;
   for(let i=0;i<count;i++){const dueDate=monthAdd(first,i*step);if(dueDate>end&&i>0)break;const amount=i===count-1?remaining:base;if(amount>0){installments.push({date:dueDate,amount});remaining-=amount;}}
   if(remaining>0){if(installments.length)installments[installments.length-1].amount+=remaining;else installments=[{date:first,amount:total}];}
  }
 }
 if(installments.reduce((sum,x)=>sum+x.amount,0)!==total)throw Error('مجموع دفعات الإيجار يجب أن يساوي إجمالي العقد بالهللة.');
 if(installments.some(x=>x.date<start||x.date>end))throw Error('تواريخ تحصيل الإيجار يجب أن تقع داخل مدة العقد.');
 installments.sort((a,b)=>a.date.localeCompare(b.date));
 const leaseId=put('tenantLease',{project:pr.id,unitId:unit.id,unitName:unit.data.name,tenantName,title,totalAmount:total,startDate:start,endDate:end,scheduleType:mode,status:'active',installments});
 for(const [i,item] of installments.entries())due({project:pr.id,title:'إيجار مستحق — '+unit.data.name+' — '+tenantName+' / '+(i+1),amount:item.amount,date:item.date,direction:'in',category:'revenue',certainty:100,tenantLeaseId:leaseId,unitId:unit.id,tenantName,leaseInstallment:i+1,leaseTotal:total});
 description='إضافة عقد تأجير وحدة '+unit.data.name+' للمستأجر '+tenantName+' وجدولة '+installments.length+' تحصيل';
}
else if(action==='lease'){
 const pr=project(p.project);
 const total=cents(p.totalAmount);
 const start=date(p.startDate);
 const end=date(p.endDate);
 if(end<start)throw Error('تاريخ نهاية عقد الإيجار لا يمكن أن يسبق بدايته.');
 if(!total)throw Error('أدخل إجمالي قيمة الإيجار.');
 const mode=['once','monthly','quarterly','semiannual','yearly','custom'].includes(p.scheduleType)?p.scheduleType:'once';
 const leaseId=uid();
 let installments:{date:string;amount:number}[]=[];
 if(mode==='custom'){
   const raw=str(p.installments||'',12000);
   installments=raw.split('\n').map((line:string)=>{
     const parts=line.split(',').map(x=>x.trim());
     if(parts.length!==2)throw Error('صيغة دفعات الإيجار المخصصة: التاريخ,المبلغ');
     return {date:date(parts[0]),amount:cents(parts[1])};
   }).filter(x=>x.amount>0);
   if(!installments.length)throw Error('أدخل دفعة إيجار مخصصة واحدة على الأقل.');
 }else{
   const paymentDate=date(p.paymentDate||start);
   if(mode==='once')installments=[{date:paymentDate,amount:total}];
   else{
     const step=mode==='monthly'?1:mode==='quarterly'?3:6;
     const count=Math.max(1,Math.floor((Number(end.slice(0,4))-Number(start.slice(0,4)))*12+(Number(end.slice(5,7))-Number(start.slice(5,7)))/step)+1);
     const base=Math.floor(total/count);
     let remaining=total;
     for(let i=0;i<count;i++){
       const d=monthAdd(paymentDate,i*step);
       if(d>end&&i>0)break;
       const amount=i===count-1?remaining:base;
       if(amount>0){installments.push({date:d,amount});remaining-=amount;}
     }
     if(remaining>0){
       const last=installments.at(-1);
       if(last)last.amount+=remaining;
       else installments=[{date:paymentDate,amount:total}];
     }
   }
 }
 const scheduledTotal=installments.reduce((s,x)=>s+x.amount,0);
 if(scheduledTotal!==total)throw Error('مجموع دفعات الإيجار يجب أن يساوي إجمالي العقد بالهللة.');
 if(installments.some(x=>x.date<start||x.date>end))throw Error('تواريخ دفعات الإيجار يجب أن تقع داخل مدة العقد.');
 installments.sort((a,b)=>a.date.localeCompare(b.date));
 put('lease',{project:pr.id,title:str(p.title||'إيجار المشروع',200),totalAmount:total,startDate:start,endDate:end,scheduleType:mode,status:'active',accountingModel:'period-accrual-v2',paymentAccount:['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'bank',installments},leaseId);
 for(let i=0;i<installments.length;i++){const installment=installments[i],obligationId=uid();due({project:pr.id,title:'إيجار — '+str(p.title||pr.data.name,120)+' / '+(i+1),amount:installment.amount,date:installment.date,direction:'out',category:'expense',certainty:num(p.certainty??100,0,100),leaseId,leaseInstallment:i+1,leaseTotal:total},obligationId);}
 description='إضافة عقد إيجار وجدولة '+installments.length+' دفعة: '+pr.data.name;
}
else if(action==='cancelContract'){
 const contract=find(str(p.contractId,100));
 if(!['lease','tenantLease','projectTenantLease'].includes(contract.kind)&&!(contract.kind==='projectCommitment'&&contract.data.costType==='rent'))throw Error('نوع العقد غير مدعوم للإلغاء.');
 if(contract.data.status==='cancelled'||contract.data.status==='terminated')throw Error('هذا العقد ملغى بالفعل.');
 const reason=str(p.reason,1000);
 if(reason.length<3)throw Error('اكتب سبب إلغاء واضحًا.');
 const cancelledAt=today();
 update(contract,{...contract.data,status:'cancelled',cancelledAt,cancellationReason:reason});
 const linkField=contract.kind==='lease'?'leaseId':contract.kind==='tenantLease'?'tenantLeaseId':contract.kind==='projectTenantLease'?'projectTenantLeaseId':'projectCommitmentId';
 const linked=w.records.filter(r=>r.kind==='obligation'&&r.data[linkField]===contract.id);
 let cancelledCount=0,cancelledTotal=0;
 for(const obligation of linked){
  const d=obligation.data;
  if(d.status!=='pending'||String(d.date||'')<=cancelledAt)continue;
  update(obligation,{...d,status:'cancelled',cancelledAt,cancellationReason:'إلغاء العقد: '+reason});
  cancelledCount++;cancelledTotal+=Number(d.amount||0);
 }
 description='إلغاء عقد '+String(contract.data.title||contract.data.unitName||contract.id)+' بتاريخ '+cancelledAt+'؛ إيقاف '+cancelledCount+' دفعة مستقبلية بإجمالي '+cancelledTotal;
}
else if(action==='obligation'){project(p.project);const a=cents(p.amount);if(!a)throw Error('أدخل مبلغًا أكبر من صفر.');const start=date(p.date),repeat=p.repeat||'once',count=Math.trunc(num(p.count||1,1,365)),endRaw=String(p.repeatEnd||'').trim(),endDate=endRaw?date(endRaw):'';if(!['once','daily','monthly','yearly'].includes(repeat))throw Error('تكرار غير صحيح.');if(!['in','out'].includes(p.direction))throw Error('حدد اتجاه الحركة.');if(endDate&&endDate<start)throw Error('نهاية التكرار يجب أن تكون في تاريخ البداية أو بعده.');const category=str(p.category);const categoryType=accounts[category]?.type;const validCategory=p.direction==='in'?(categoryType==='income'||category==='receivable'):(categoryType==='expense'||['fixed','inventory','investment','payable','tax_payable','rent_payable'].includes(category));if(!accounts[category]||!validCategory)throw Error('اختر حسابًا يتوافق مع اتجاه السيولة وطبيعة المعالجة المحاسبية.');const dates:string[]=[];if(repeat==='once')dates.push(start);else if(endDate){for(let i=0;i<365;i++){const dueDate=repeat==='daily'?dayAdd(start,i):monthAdd(start,repeat==='yearly'?i*12:i);if(dueDate>endDate)break;dates.push(dueDate);}if(!dates.length||dates[dates.length-1]>endDate)throw Error('تعذر إنشاء مواعيد التكرار.');if(dates.length===365){const next=repeat==='daily'?dayAdd(start,365):monthAdd(start,repeat==='yearly'?365*12:365);if(next<=endDate)throw Error('الفترة تتجاوز الحد الأقصى البالغ 365 دفعة.');}}else{for(let i=0;i<count;i++)dates.push(repeat==='daily'?dayAdd(start,i):monthAdd(start,repeat==='yearly'?i*12:i));}for(const dueDate of dates){const rid=uid();due({project:p.project,title:str(p.title),amount:a,date:dueDate,direction:p.direction,category,certainty:num(p.certainty??100,0,100)},rid);if(dueDate<=today()&&['income','expense'].includes(categoryType))journal(p.direction==='out'?'bill':'invoice',p.direction==='out'?'إثبات مصروف مستحق: ':'إثبات إيراد مستحق: '+str(p.title),dueDate,directionLines(p.project,p.direction,category,a),'obligation-accrual:'+rid);}description='جدولة الاستحقاقات ('+dates.length+' موعد): '+p.title;}
else if(action==='settle'){const r=find(p.id,'obligation'),d=r.data;if(d.status!=='pending')throw Error('الاستحقاق تمت معالجته بالفعل.');const dt=date(p.date);let lines:Line[];if(d.loan){const loanRecord=w.records.find(x=>x.kind==='loan'&&x.id===d.loan),personal=loanRecord?.data?.holder==='personal';const paymentSource=['personal','thirdParty'].includes(p.loanPaymentSource)?p.loanPaymentSource:'liquidity';const pay=personal?'personal_cash':(['cash','bank','mada','visa','mastercard'].includes(p.paymentAccount)?p.paymentAccount:'cash');const loanAccount=personal?'personal_loan':'loan';const counterAccount=paymentSource==='personal'?'capital':paymentSource==='thirdParty'?'payable':pay;lines=[...(d.principal?[{project:d.project,account:loanAccount,debit:d.principal,credit:0}]:[]),...(d.interest?[{project:d.project,account:'interest',debit:d.interest,credit:0}]:[]),{project:d.project,account:counterAccount,debit:0,credit:d.amount}];if(paymentSource==='thirdParty'&&String(p.paymentParty||'').trim())d.title=String(d.title)+' — سداد بواسطة: '+str(p.paymentParty,200);else if(paymentSource==='personal')d.title=String(d.title)+' — سداد من أموال شخصية خارج السيولة المسجلة';}else {const lease=w.records.find(x=>x.kind==='lease'&&x.id===d.leaseId);const defaultPay=lease?.data.paymentAccount||d.paymentAccount||'cash';const pay=['cash','bank'].includes(p.paymentAccount||defaultPay)?(p.paymentAccount||defaultPay):'cash';const accrual=w.journals.find(j=>j.source==='obligation-accrual:'+r.id);if(lease&&lease.data.accountingModel==='period-accrual-v2'&&d.direction==='out'){const dueJournal=w.journals.find(j=>j.source==='lease-due:'+r.id);if(dueJournal&&dt<d.date)throw Error('تاريخ السداد يسبق تاريخ الاستحقاق المسجل؛ راجع تاريخ السداد قبل التسوية.');lines=dueJournal?pair(d.project,'rent_payable',pay,d.amount):pair(d.project,'prepaid_rent',pay,d.amount);}else lines=accrual?pair(d.project,d.direction==='in'?'cash':'payable',d.direction==='in'?'receivable':pay,d.amount):pair(d.project,d.direction==='in'?'cash':d.category,d.direction==='in'?d.category:pay,d.amount);}journal('settle',d.title,dt,lines,'obligation:'+r.id);update(r,{...d,status:'paid',paidOn:dt});if(d.leaseId){const lease=w.records.find(x=>x.kind==='lease'&&x.id===d.leaseId);if(lease){const remaining=w.records.some(x=>x.kind==='obligation'&&x.data.leaseId===d.leaseId&&x.id!==r.id&&x.data.status==='pending');if(!remaining)update(lease,{...lease.data,status:'completed'});}}if(d.landPurchaseId){const contract=w.records.find(x=>x.kind==='landPurchase'&&x.id===d.landPurchaseId);if(contract){const remaining=w.records.filter(x=>x.kind==='obligation'&&x.data.landPurchaseId===contract.id&&x.id!==r.id&&x.data.status==='pending').reduce((sum,x)=>sum+Number(x.data.amount||0),0);update(contract,{...contract.data,remainingAmount:remaining,status:remaining>0?'active':'completed',updatedAt:time});}}description='تسوية استحقاق: '+d.title;}
else if(action==='settleLoans'){const ids:string[]=Array.isArray(p.ids)?Array.from(new Set<string>((p.ids as any[]).map((x:any)=>String(x)))):[];if(!ids.length)throw Error('حدد قسطًا واحدًا على الأقل.');if(ids.length>120)throw Error('يمكن سداد 120 قسطًا كحد أقصى في العملية الواحدة.');const paymentSource=['personal','thirdParty'].includes(p.loanPaymentSource)?p.loanPaymentSource:'liquidity';const allowedAccounts=['cash','bank','mada','visa','mastercard'];const paymentAccount=allowedAccounts.includes(p.paymentAccount)?p.paymentAccount:'cash';const settlementDate=date(p.date||today());if(settlementDate>today())throw Error('لا يمكن تسجيل سداد قرض بتاريخ مستقبلي.');const dues=ids.map(id=>find(id,'obligation'));if(dues.some(r=>r.data.status!=='pending'||!r.data.loan))throw Error('كل السجلات المحددة يجب أن تكون أقساط قروض غير مسددة.');const loanIds=[...new Set(dues.map(r=>String(r.data.loan)))];if(loanIds.length!==1)throw Error('حدد أقساط قرض واحد في كل عملية سداد جماعي.');for(const r of dues){const d=r.data,dt=settlementDate,loanRecord=w.records.find(x=>x.kind==='loan'&&x.id===d.loan),personal=loanRecord?.data?.holder==='personal';if(loanRecord&&dt<String(loanRecord.data.start||''))throw Error('تاريخ السداد الفعلي لا يمكن أن يسبق تاريخ استلام/إثبات القرض.');const pay=personal?'personal_cash':paymentAccount;const loanAccount=personal?'personal_loan':'loan';const counterAccount=paymentSource==='personal'?'capital':paymentSource==='thirdParty'?'payable':pay;const lines:Line[]=[...(d.principal?[{project:d.project,account:loanAccount,debit:d.principal,credit:0}]:[]),...(d.interest?[{project:d.project,account:'interest',debit:d.interest,credit:0}]:[]),{project:d.project,account:counterAccount,debit:0,credit:d.amount}];let memo=String(d.title||'سداد قسط قرض');if(paymentSource==='personal')memo+=' — سداد من أموال شخصية خارج السيولة المسجلة';if(paymentSource==='thirdParty'&&String(p.paymentParty||'').trim())memo+=' — سداد بواسطة: '+str(p.paymentParty,200);journal('settle',memo,dt,lines,'obligation:'+r.id);update(r,{...d,status:'paid',paidOn:dt,paymentSource,paymentAccount:paymentSource==='liquidity'?pay:undefined,paymentParty:paymentSource==='thirdParty'?str(p.paymentParty,200):undefined});}description='سداد '+dues.length+' أقساط قرض بتاريخ السداد الفعلي '+settlementDate;}
else if(action==='cancelDue'){const r=find(p.id,'obligation');if(r.data.status!=='pending'||r.data.loan||r.data.landPurchaseId)throw Error('هذا الاستحقاق مرتبط بقرض أو عقد شراء أصل؛ لا يمكن إلغاؤه منفردًا حتى لا يختل رصيد الالتزام.');update(r,{...r.data,status:'cancelled',reason:str(p.reason)});description='إلغاء استحقاق: '+r.data.title;}
else if(action==='dailyReport'){
 const pr=project(p.project),d=date(p.date);if(d>today())throw Error('التقرير اليومي لا يمكن أن يكون مستقبليًا.');if(pr.data.closedThrough&&d<=pr.data.closedThrough)throw Error('الفترة مقفلة حتى '+pr.data.closedThrough+'؛ لا يمكن إضافة تقرير يومي بأثر رجعي. استخدم تسوية موثقة في فترة مفتوحة.');
 if(w.records.some(x=>x.kind==='dailyReport'&&x.data.project===pr.id&&x.data.date===d&&x.data.status==='approved'&&!x.data.correctedBy))throw Error('يوجد تقرير يومي معتمد لهذا المشروع في نفس التاريخ. استخدم مسار التصحيح بدل إنشاء تقرير ثانٍ.');
 const gross=halala(p.gross,'إجمالي دخل اليوم');if(gross===0)throw Error('إجمالي دخل اليوم يجب أن يكون أكبر من صفر.');
 const channels:any=p.channels||{};let allocated=0;const lines:Line[]=[];
 for(const key of paymentAccounts){const raw=channels[key]??'';if(raw===''||raw==null||Number(raw)===0)continue;const a=halala(raw,'مبلغ '+paymentLabels[key]);allocated+=a;lines.push({project:pr.id,account:key,debit:a,credit:0});}
 if(allocated!==gross)throw Error('مجموع طرق الإيداع يجب أن يساوي إجمالي دخل اليوم بالهللة. الفرق: '+((gross-allocated)/100).toFixed(2)+' ريال.');
 if(lines.length===0)throw Error('أدخل طريقة إيداع واحدة على الأقل.');
 lines.push({project:pr.id,account:'revenue',debit:0,credit:gross});
 const reportId=put('dailyReport',{project:pr.id,date:d,gross,channels:Object.fromEntries(paymentAccounts.map(k=>[k,halala(channels[k]||'0','مبلغ '+paymentLabels[k])])),status:'approved',approvedAt:time,manager:str(p.manager||'المدير')});
 journal('dailyReport','تقرير يومي معتمد — '+str(p.memo||d),d,lines,'daily-report:'+reportId);
 description='اعتماد تقرير يومي: '+pr.data.name+' — '+(gross/100).toFixed(2)+' ريال';
}
else if(action==='dailyReportCorrection'){
 const original=find(p.id,'dailyReport'),od=original.data;
 if(od.status!=='approved'||od.correctedBy)throw Error('هذا التقرير لا يمكن تصحيحه مرة أخرى. اختر التقرير المعتمد الحالي.');
 const pr=project(od.project),d=date(od.date);
 if(pr.data.closedThrough&&d<=pr.data.closedThrough)throw Error('الفترة التي تحتوي التقرير مقفلة؛ لا يمكن تعديل التقرير بعد الإقفال. استخدم قيد تسوية في الفترة الحالية مع مستند التصحيح.');
 const originalJournal=w.journals.find(j=>j.source==='daily-report:'+original.id);
 if(!originalJournal)throw Error('لم يُعثر على القيد المرتبط بالتقرير؛ أوقف التصحيح وراجع سجل المراجعة.');
 const gross=halala(p.gross,'إجمالي دخل اليوم المصحح');if(gross===0)throw Error('إجمالي دخل اليوم يجب أن يكون أكبر من صفر.');
 const channels:any=p.channels||{};let allocated=0;const correctedLines:Line[]=[];
 for(const key of paymentAccounts){const raw=channels[key]??'';if(raw===''||raw==null||Number(raw)===0)continue;const a=halala(raw,'مبلغ '+paymentLabels[key]);allocated+=a;correctedLines.push({project:pr.id,account:key,debit:a,credit:0});}
 if(allocated!==gross)throw Error('مجموع طرق الإيداع يجب أن يساوي الإجمالي المصحح بالهللة. الفرق: '+((gross-allocated)/100).toFixed(2)+' ريال.');
 if(correctedLines.length===0)throw Error('أدخل طريقة إيداع واحدة على الأقل.');
 correctedLines.push({project:pr.id,account:'revenue',debit:0,credit:gross});
 const reversalDate=date(p.reversalDate||d);if(reversalDate<d)throw Error('تاريخ التصحيح لا يسبق تاريخ التقرير.');
 const reversalLines=originalJournal.lines.map(l=>({...l,debit:l.credit,credit:l.debit}));
 journal('dailyReportReversal','عكس التقرير اليومي للتصحيح — '+str(p.reason,300),reversalDate,reversalLines,'daily-report-reversal:'+original.id,originalJournal.id);
 const correctedId=put('dailyReport',{project:pr.id,date:d,gross,channels:Object.fromEntries(paymentAccounts.map(k=>[k,halala(channels[k]||'0','مبلغ '+paymentLabels[k])])),status:'approved',approvedAt:time,manager:str(p.manager||od.manager||'المدير'),correctedFrom:original.id,correctionReason:str(p.reason,300),reversalDate});
 journal('dailyReport','تقرير يومي مصحح — '+str(p.memo||d),d,correctedLines,'daily-report:'+correctedId);
 update(original,{...od,status:'corrected',correctedBy:correctedId,correctedAt:time});
 description='تصحيح التقرير اليومي: '+pr.data.name+' — '+(gross/100).toFixed(2)+' ريال';
}
else if(action==='settleCards'){
 const pr=project(p.project),d=date(p.date),from=ensurePayment(p.fromAccount),to=ensurePayment(p.toAccount||'bank');
 if(!['mada','visa','mastercard'].includes(from)||to!=='bank')throw Error('تسوية البطاقات تكون من مدى/Visa/Mastercard إلى الحساب البنكي.');
 const a=halala(p.amount,'مبلغ التسوية');if(a===0)throw Error('مبلغ التسوية يجب أن يكون أكبر من صفر.');const b=balance(w,pr.id,d);if(a>(b[from]||0))throw Error('مبلغ التسوية أكبر من الرصيد المستحق لوسيلة الدفع.');
 journal('cardSettlement','تسوية '+paymentLabels[from]+' إلى البنك',d,[{project:pr.id,account:'bank',debit:a,credit:0},{project:pr.id,account:from,debit:0,credit:a}],'card-settlement:'+id);
 description='تسوية مستحقات '+paymentLabels[from]+' إلى البنك';
}
else if(action==='investmentStart'){
 const lender=project(p.lender),borrower=project(p.borrower);if(lender.id===borrower.id)throw Error('اختر مشروعين مختلفين.');
 const amount=halala(p.amount,'رأس مال الاستثمار');if(amount===0)throw Error('رأس مال الاستثمار يجب أن يكون أكبر من صفر.');const start=date(p.start||today()),maturity=date(p.maturity);if(maturity<start)throw Error('تاريخ نهاية الدورة يجب أن يكون بعد بدايتها.');const available=balance(w,lender.id,start).cash||0;if(amount>available)throw Error('سيولة المشروع المستثمر لا تكفي لتمويل هذه الدورة في التاريخ المحدد.');
 const expectedReturn=p.expectedReturn?halala(p.expectedReturn,'العائد المتوقع'):0;
 const rid=put('investmentCycle',{lender:lender.id,borrower:borrower.id,principal:amount,start,maturity,expectedReturn,actualReturn:0,status:'active',memo:str(p.memo||'دورة استثمار داخلية')});
 journal('investmentStart','بدء دورة استثمار داخلية',start,[{project:lender.id,account:'investment',debit:amount,credit:0},{project:lender.id,account:'cash',debit:0,credit:amount},{project:borrower.id,account:'cash',debit:amount,credit:0},{project:borrower.id,account:'inter_payable',debit:0,credit:amount}],'investment-cycle:'+rid);
 description='بدء دورة استثمار داخلية';
}
else if(action==='investmentReturn'){
 const r=find(p.id,'investmentCycle'),d=r.data;if(d.status!=='active')throw Error('دورة الاستثمار ليست نشطة.');
 const dt=date(p.date);if(dt<d.start)throw Error('تاريخ الاسترداد لا يسبق بداية الدورة.');
 const principal=d.principal,actual=d.actualReturn||0,ret=p.actualReturn?halala(p.actualReturn,'العائد الفعلي'):actual;
 const borrower=project(d.borrower),lender=project(d.lender);const b=balance(w,borrower.id,dt);if(principal>Math.max(0,-(b.inter_payable||0)))throw Error('رصيد أصل الاستثمار المستحق على المشروع لا يكفي للاسترداد.');
 const total=principal+ret;if(total>(b.cash||0))throw Error('سيولة المشروع المستثمر فيه لا تكفي لرد أصل الاستثمار والعائد الفعلي.');
 journal('investmentReturn','إغلاق دورة استثمار داخلية',dt,[
   {project:borrower.id,account:'inter_payable',debit:principal,credit:0},
   ...(ret?[{project:borrower.id,account:'interest',debit:ret,credit:0}]:[]),
   {project:borrower.id,account:'cash',debit:0,credit:total},
   {project:lender.id,account:'cash',debit:total,credit:0},
   {project:lender.id,account:'investment',debit:0,credit:principal},
   ...(ret?[{project:lender.id,account:'dividend',debit:0,credit:ret}]:[])
 ],'investment-return:'+r.id);
 update(r,{...d,status:'closed',closedOn:dt,actualReturn:ret,totalReturned:total});
 description='إغلاق دورة الاستثمار واسترداد رأس المال والعائد';
}
else if(action==='setTaxPolicy'){
 const effectiveFrom=date(p.effectiveFrom||today());
 const enabled=p.enabled===true||p.enabled===1||p.enabled==='1'||p.enabled==='true'; const rateBps=percentBps(p.rate||0,'نسبة الضريبة');
 const defaultMode=['none','inclusive','exclusive'].includes(p.defaultMode)?p.defaultMode:'none';
 const existing=w.records.find(x=>x.kind==='taxPolicy'&&String(x.data.effectiveFrom||'')===effectiveFrom);
 const data={enabled,rateBps,defaultMode,salesTax:p.salesTax!==false,purchaseTax:p.purchaseTax!==false,effectiveFrom};
 if(existing)update(existing,data);else put('taxPolicy',data);
 description='تحديث سياسة الضريبة: '+(enabled?(rateBps/100).toFixed(2)+'%':'غير مطبقة');
}
else if(action==='setOwnerPolicy'){
 const pct=percentBps(p.percent,'نسبة المالك السنوية');
 const effectiveFrom=date(p.effectiveFrom||today());
 const same=w.records.find(x=>x.kind==='ownerPolicy'&&String(x.data.effectiveFrom||'')===effectiveFrom);
 if(same)update(same,{...same.data,percentBps:pct,effectiveFrom});
 else put('ownerPolicy',{percentBps:pct,effectiveFrom});
 description='تحديث نسبة المالك السنوية إلى '+(pct/100).toFixed(2)+'%';
}
else if(action==='annualOwnerDistribution'){
 const year=Math.trunc(num(p.year,2000,2100));const fy=fiscalYearForStart(w,year);const existing=w.records.find(x=>x.kind==='ownerSettlement'&&x.data.fiscalYearStart===fy.start);if(existing)throw Error('تم اعتماد تسوية المالك لهذه السنة مسبقًا.');
 const policy=ownerPolicyForYear(w,year);
 if(!policy)throw Error('حدد نسبة المالك السنوية أولاً.');
 const pct=Number(policy.data.percentBps||0);if(pct<=0)throw Error('نسبة المالك السنوية يجب أن تكون أكبر من صفر.');
 const rows=operatingRows(w,year);const totalProfit=rows.reduce((s,x)=>s+x.net,0);if(totalProfit<=0)throw Error('لا يوجد صافي ربح موجب للمحفظة في هذه السنة.');
 const totalOwner=Math.floor(totalProfit*pct/10000);if(totalOwner<=0)throw Error('حصة المالك أقل من هللة بعد التقريب.');
 const positive=rows.filter(x=>x.net>0);let remaining=totalOwner;const lines:Line[]=[];const allocations:any[]=[];
 for(let i=0;i<positive.length;i++){const x=positive[i];const a=i===positive.length-1?remaining:Math.floor(totalOwner*x.net/positive.reduce((s,y)=>s+y.net,0));if(a<=0)continue;remaining-=a;const pay=ensurePayment(p.paymentAccount||'bank');if(!['cash','bank'].includes(pay))throw Error('حساب دفع المالك يجب أن يكون كاش أو بنك.');const b=balance(w,x.id,today());if(a>Math.max(0,(b.cash||0)+(b.bank||0)-Number(x.reserve||0)))throw Error('السيولة المتاحة في '+x.name+' لا تكفي لحصتها من توزيع المالك بعد الاحتياطي.');if(a>(b[pay]||0))throw Error('حساب '+paymentLabels[pay]+' في '+x.name+' لا يحتوي على المبلغ المطلوب للدفع.');lines.push({project:x.id,account:'distribution',debit:a,credit:0},{project:x.id,account:pay,debit:0,credit:a});allocations.push({project:x.id,amount:a});}
 if(remaining!==0)throw Error('تعذر توزيع المبلغ بدقة على المشاريع.');
 const source='owner-annual:'+year;journal('annualOwnerDistribution','توزيع حصة المالك السنوية لعام '+year,today(),lines,source);
 put('ownerSettlement',{year,fiscalYearId:fy.id||'',fiscalYearStart:fy.start,fiscalYearEnd:fy.end,percentBps:pct,totalProfit,totalOwner,allocations,status:'paid',paidOn:today(),paymentAccount:p.paymentAccount||'bank'},uid());
 description='اعتماد توزيع المالك السنوي لعام '+year;
}
else if(action==='projectFunding'){const target=project(p.project);const amount=cents(p.amount);const dt=date(p.date||today());if(!amount)throw Error('أدخل مبلغ التمويل.');const source=['personal','project','external'].includes(p.sourceType)?p.sourceType:'personal';let lines:Line[];let sourceLabel='تمويل شخصي';if(source==='project'){if(!p.sourceProject||p.sourceProject===p.project)throw Error('اختر مشروعًا آخر كمصدر للتمويل.');project(p.sourceProject);guardProject(p.sourceProject);const available=balance(w,p.sourceProject,dt).cash||0;if(amount>available)throw Error('رصيد النقدية المتاح في المشروع المصدر لا يكفي لهذا التحويل.');lines=[...pair(p.sourceProject,'inter_receivable','cash',amount),...pair(p.project,'cash','inter_payable',amount)];sourceLabel='تمويل من مشروع آخر';}else if(source==='external'){lines=pair(p.project,'cash','payable',amount);sourceLabel='تمويل خارجي مستحق';}else{lines=pair(p.project,'cash','capital',amount);}const rid=put('projectFunding',{project:p.project,sourceType:source,sourceProject:source==='project'?p.sourceProject:'',amount,date:dt,memo:str(p.memo||sourceLabel,300)});journal('transfer',sourceLabel+' — '+target.data.name,dt,lines,'projectFunding:'+rid);description='تمويل '+target.data.name+' — '+sourceLabel;}
else if(action==='cancelFunding'){
 const funding=find(p.id,'projectFunding');
 const fd=funding.data as any;
 if(fd.status==='cancelled')throw Error('هذا التمويل ملغى بالفعل.');
 const repayments=w.records.filter(x=>x.kind==='fundingRepayment'&&x.data.fundingId===funding.id&&x.data.status!=='cancelled');
 if(repayments.length)throw Error('لا يمكن إلغاء التمويل بعد وجود استرداد مرتبط به. اعكس الاسترداد أولًا.');
 const related=w.records.filter(x=>x.id!==funding.id&&((x.kind==='fundingRepayment'&&x.data.fundingId===funding.id&&x.data.status!=='cancelled')||(x.kind!=='fundingRepayment'&&x.data&&x.data.fundingId===funding.id)));
 if(related.length)throw Error('لا يمكن إلغاء التمويل لأنه مرتبط بحركة أخرى. صحح الحركة التابعة أولًا.');
 const original=w.journals.find(j=>j.source==='projectFunding:'+funding.id);
 if(!original)throw Error('لم يتم العثور على القيد الأصلي للتمويل.');
 if(w.journals.some(j=>j.reversal===original.id))throw Error('تم عكس قيد التمويل بالفعل.');
 const cancelDate=date(p.date||today());
 if(cancelDate<date(fd.date))throw Error('تاريخ الإلغاء لا يمكن أن يسبق تاريخ التمويل.');
 const availableCash=balance(w,String(fd.project||''),cancelDate).cash||0;
 if(Number(fd.amount||0)>availableCash)throw Error('لا يمكن إلغاء التمويل لأن النقدية المتاحة في المشروع لا تكفي لعكس المبلغ بأمان.');
 journal('reversal','عكس تمويل: '+(fd.memo||fd.project)+' — '+str(p.reason||'تصحيح تمويل',200),cancelDate,original.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,original.id);
 update(funding,{...fd,status:'cancelled',cancelledAt:cancelDate,cancelReason:str(p.reason||'تصحيح تمويل',200)});
 description='إلغاء تمويل مع عكس أثره المحاسبي: '+funding.id;
}
else if(action==='ownerAdvanceGeneral'){
 const amount=cents(p.amount),dt=date(p.date||today());if(!amount)throw Error('أدخل مبلغًا أكبر من صفر.');if(dt>today())throw Error('لا يمكن تسجيل سلفة فعلية بتاريخ مستقبلي.');
 const pay=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash',memo=str(p.memo||'سلفة عامة من المالك على إجمالي المشاريع',300);const duplicate=w.records.some(x=>x.kind==='deficitPayment'&&!x.data.project&&x.data.date===dt&&Number(x.data.amount)===amount&&String(x.data.memo||'')===memo&&x.data.status!=='cancelled');if(duplicate)throw Error('توجد سلفة عامة مطابقة بالفعل؛ راجع السجل لتجنب التكرار.');
 const rid=put('deficitPayment',{project:'',deficitMonth:'',amount,date:dt,paymentAccount:pay,memo,repaid:0,status:'open',scope:'all'});journal('deficitPayment','سلفة عامة من المالك — إجمالي المشاريع',dt,pair('',pay,'owner_advance',amount),'deficitPayment:'+rid);description='تسجيل سلفة عامة من المالك على إجمالي المشاريع بقيمة '+(amount/100).toFixed(2)+' ريال؛ دون تحميلها على مشروع منفرد';
}
else if(action==='deficitPayment'){
 const pr=project(p.project),amount=cents(p.amount),dt=date(p.date||today()),month=String(p.deficitMonth||'');
 if(!amount)throw Error('أدخل مبلغًا أكبر من صفر.');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('حدد شهر العجز بصيغة صحيحة.');
 if(dt>today())throw Error('لا يمكن تسجيل دفعة فعلية بتاريخ مستقبلي.');if(month>dt.slice(0,7))throw Error('لا يمكن تسجيل تغطية لعجز شهر لم ينتهِ بعد.');
 const monthEnd=dayAdd(monthAdd(month+'-01',1),-1),deficit=Math.max(0,-profit(w,pr.id,month+'-01',monthEnd).net);const already=w.records.filter(x=>x.kind==='deficitPayment'&&x.data.project===pr.id&&x.data.deficitMonth===month&&x.data.status!=='cancelled').reduce((s,x)=>s+Number(x.data.amount||0),0);if(deficit>0&&amount>Math.max(0,deficit-already))throw Error('المبلغ يتجاوز العجز التشغيلي المتبقي لهذا المشروع والشهر. إذا كانت السلفة عامة وليست لتغطية هذا العجز، سجّلها كتمويل/التزام مناسب بدل ربطها بعجز مثبت.');
 const pay=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash';const duplicate=w.records.some(x=>x.kind==='deficitPayment'&&x.data.project===pr.id&&x.data.deficitMonth===month&&x.data.date===dt&&Number(x.data.amount)===amount&&String(x.data.memo||'')===String(p.memo||''));if(duplicate)throw Error('توجد دفعة عجز مطابقة بالفعل؛ راجع السجل لتجنب التكرار.');
 const rid=put('deficitPayment',{project:pr.id,deficitMonth:month,amount,date:dt,paymentAccount:pay,memo:str(p.memo||'تغطية عجز من أموال المالك',300),repaid:0,status:'open'});journal('deficitPayment','سلفة من المالك لتغطية عجز '+month+' — '+pr.data.name,dt,pair(pr.id,pay,'owner_advance',amount),'deficitPayment:'+rid);description='تسجيل سلفة مالك مستحقة الرد لتغطية عجز '+month+' بقيمة '+(amount/100).toFixed(2)+' ريال';
}
else if(action==='repayOwnerAdvance'){
 const r=find(p.id,'deficitPayment'),d=r.data,amount=cents(p.amount),dt=date(p.date||today());if(!amount)throw Error('أدخل مبلغًا أكبر من صفر.');if(d.status==='cancelled')throw Error('لا يمكن تسوية سجل ملغى.');
 if(dt<date(d.date))throw Error('تاريخ رد السلفة لا يمكن أن يسبق تاريخ تسجيلها.');const repaid=Number(d.repaid||0),remaining=Number(d.amount||0)-repaid;if(amount>remaining)throw Error('مبلغ الرد يتجاوز السلفة المتبقية.');const pay=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:(d.paymentAccount||'cash');if((balance(w,d.project||'all',dt)[pay]||0)<amount)throw Error('الرصيد المتاح في حساب الدفع لا يكفي لرد السلفة.');
 const rid=put('ownerAdvanceRepayment',{advanceId:r.id,project:d.project||'',scope:d.project?'project':'all',amount,date:dt,paymentAccount:pay,status:'posted'});const repaymentLabel=d.project?'رد سلفة مالك عن عجز '+String(d.deficitMonth||''):'رد سلفة مالك عامة على إجمالي المشاريع';journal('repayOwnerAdvance',repaymentLabel+' — '+String(d.memo||''),dt,pair(d.project||'', 'owner_advance',pay,amount),'ownerAdvanceRepayment:'+rid);const next=repaid+amount;update(r,{...d,repaid:next,status:next>=Number(d.amount||0)?'repaid':'open',lastRepaidOn:dt});description='رد سلفة مالك بقيمة '+(amount/100).toFixed(2)+' ريال؛ المتبقي '+((Number(d.amount||0)-next)/100).toFixed(2)+' ريال';
}
else if(action==='fundingRepayment'){
 const funding=w.records.find(x=>x.kind==='projectFunding'&&x.id===p.fundingId);
 if(!funding)throw Error('لم يتم العثور على عملية التمويل الأصلية.');
 const fd=funding.data as any;
 if(fd.status==='cancelled')throw Error('لا يمكن استرداد تمويل ملغى.');
 const recipient=project(fd.project),amount=cents(p.amount),dt=date(p.date||today());
 if(!amount)throw Error('أدخل مبلغ الاسترداد.');
 if(dt<date(fd.date))throw Error('تاريخ الاسترداد لا يمكن أن يسبق تاريخ التمويل.');
 const pay=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'cash';
 const available=balance(w,recipient.id,dt)[pay]||0;
 if(amount>available)throw Error((pay==='bank'?'الرصيد البنكي':'الرصيد النقدي')+' المتاح في المشروع لا يكفي لتنفيذ استرداد التمويل.');
 const prior=w.records.filter(x=>x.kind==='fundingRepayment'&&x.data.fundingId===funding.id&&x.data.status!=='cancelled').reduce((s,x)=>s+Number(x.data.amount||0),0);
 const outstanding=Math.max(0,Number(fd.amount||0)-prior);
 if(amount>outstanding)throw Error('مبلغ الاسترداد يتجاوز رأس المال المتبقي لهذا التمويل.');
 let lines:Line[],memo='';
 if(fd.sourceType==='project'){
   const lender=project(fd.sourceProject);guardProject(lender.id);
   lines=[...pair(recipient.id,'inter_payable',pay,amount),...pair(lender.id,pay,'inter_receivable',amount)];
   memo='استرداد تمويل مشروع → مشروع';
 }else if(fd.sourceType==='external'){
   lines=pair(recipient.id,'payable',pay,amount);
   memo='استرداد تمويل خارجي';
 }else{
   lines=pair(recipient.id,'capital',pay,amount);
   memo='استرداد رأس مال المالك';
 }
 const rid=put('fundingRepayment',{fundingId:funding.id,project:recipient.id,sourceType:fd.sourceType,sourceProject:fd.sourceProject||'',amount,date:dt,memo:str(p.memo||memo,300)});
 journal('fundingRepayment',memo+' — '+recipient.data.name,dt,lines,'fundingRepayment:'+rid);
 description='استرداد مرتبط بالتمويل الأصلي: '+funding.id;
}
else if(action==='cancelFundingRepayment'){
 const repayment=find(p.id,'fundingRepayment'),rd=repayment.data as any;
 if(rd.status==='cancelled')throw Error('تم عكس استرداد التمويل بالفعل.');
 const funding=w.records.find(x=>x.kind==='projectFunding'&&x.id===rd.fundingId);
 if(!funding)throw Error('لم يتم العثور على التمويل المرتبط بهذا الاسترداد.');
 const original=w.journals.find(j=>j.source==='fundingRepayment:'+repayment.id);
 if(!original)throw Error('لم يتم العثور على القيد الأصلي للاسترداد.');
 if(w.journals.some(j=>j.reversal===original.id))throw Error('تم عكس قيد الاسترداد بالفعل.');
 const cancelDate=date(p.date||today());
 if(cancelDate<date(rd.date||original.date))throw Error('تاريخ العكس لا يمكن أن يسبق تاريخ الاسترداد.');
 const recipient=project(String(rd.project||funding.data.project||''));
 guardProject(recipient.id);
 if(rd.sourceType==='project'){
  const lender=project(String(rd.sourceProject||funding.data.sourceProject||''));
  guardProject(lender.id);
  const available=balance(w,lender.id,cancelDate).cash||0;
  if(Number(rd.amount||0)>available)throw Error('لا يمكن عكس الاسترداد لأن النقدية المتاحة لدى المشروع المُموِّل لا تكفي لإرجاع المبلغ.');
 }
 journal('reversal','عكس استرداد تمويل: '+str(p.reason||'تصحيح استرداد',200),cancelDate,original.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,original.id);
 update(repayment,{...rd,status:'cancelled',cancelledAt:cancelDate,cancelReason:str(p.reason||'تصحيح استرداد',200)});
 description='عكس استرداد التمويل مع الاحتفاظ بالأصل وسجل المراجعة: '+repayment.id;
}
else if(action==='employee'){project(p.project);const salary=cents(p.salary),start=date(p.firstDate),count=Math.trunc(num(p.months??12,1,24));if(!salary)throw Error('أدخل راتبًا أكبر من صفر.');const rid=put('employee',{name:str(p.name),job:str(p.job),project:p.project,salary,baseSalary:cents(p.baseSalary??p.salary),housingAllowance:cents(p.housingAllowance||0),transportAllowance:cents(p.transportAllowance||0),otherAllowance:cents(p.otherAllowance||0),incentiveType:['none','fixed','percent'].includes(p.incentiveType)?p.incentiveType:'none',incentiveValue:Number(p.incentiveValue||0),hireDate:start,contractEnd:p.contractEnd?date(p.contractEnd):'',firstDate:start,months:count,status:'active'});for(let i=0;i<count;i++)due({project:p.project,title:'راتب '+p.name,amount:salary,date:monthAdd(start,i),direction:'out',category:'salary',employee:rid,certainty:100});description='إضافة موظف وجدولة راتبه: '+p.name;}
else if(action==='employeeUpdate'){const r=find(p.id,'employee');const salary=cents(p.salary),effective=date(p.effectiveFrom||today());if(!salary)throw Error('أدخل راتبًا أكبر من صفر.');if(r.data.status!=='active'&&p.status==='active')throw Error('لا يمكن إعادة تنشيط الموظف بهذا المسار؛ أنشئ تاريخ خدمة جديدًا.');const pendingSalary=w.records.filter(x=>x.kind==='obligation'&&x.data.employee===r.id&&x.data.status==='pending'&&x.data.date>=effective);for(const o of pendingSalary)update(o,{...o.data,status:'replaced',reason:'تعديل ملف الموظف/الأجر'});const next={...r.data,name:str(p.name),job:str(p.job),salary,baseSalary:cents(p.baseSalary??p.salary),housingAllowance:cents(p.housingAllowance||0),transportAllowance:cents(p.transportAllowance||0),otherAllowance:cents(p.otherAllowance||0),incentiveType:['none','fixed','percent'].includes(p.incentiveType)?p.incentiveType:'none',incentiveValue:Number(p.incentiveValue||0),hireDate:p.hireDate?date(p.hireDate):r.data.hireDate,contractEnd:p.contractEnd?date(p.contractEnd):'',status:p.status||r.data.status};update(r,next);const months=Math.trunc(num(p.months??12,1,24));for(let i=0;i<months;i++)due({project:r.data.project,title:'راتب '+next.name,amount:salary,date:monthAdd(effective,i),direction:'out',category:'salary',employee:r.id,certainty:100});description='تحديث ملف وأجر الموظف: '+next.name;}
else if(action==='payrollAdjustment'){const r=find(p.employee,'employee');if(r.data.status!=='active')throw Error('الموظف غير نشط.');const type=['bonus','commission','overtime','allowance'].includes(p.type)?p.type:'bonus';const amount=cents(p.amount);const d=date(p.date||today());if(!amount)throw Error('قيمة الحافز/الإضافة يجب أن تكون أكبر من صفر.');const title=str(p.title||({bonus:'حافز',commission:'عمولة',overtime:'عمل إضافي',allowance:'بدل إضافي'} as any)[type]);const rid=put('payrollAdjustment',{employee:r.id,project:r.data.project,type,title,amount,date:d,reason:str(p.reason||title,300),status:'approved'});due({project:r.data.project,title:title+' — '+r.data.name,amount,date:d,direction:'out',category:'salary',employee:r.id,payrollAdjustment:rid,certainty:100});description='إضافة '+title+' للموظف: '+r.data.name;}
else if(action==='renewPayroll'){
 const r=find(p.id,'employee');if(r.data.status!=='active')throw Error('الموظف غير نشط.');
 const count=num(p.months,1,24);if(!Number.isInteger(count))throw Error('أدخل عدد أشهر صحيحًا.');
 const previous=w.records.filter(o=>o.kind==='obligation'&&o.data.employee===r.id).map(o=>o.data.date).sort().at(-1);
 const salary=cents(p.salary);if(!salary)throw Error('أدخل راتبًا أكبر من صفر.');
 let offset=0;while(previous&&monthAdd(r.data.firstDate,offset)<=previous){offset++;if(offset>1200)throw Error('راجع فترة جدولة الموظف.');}
 const start=monthAdd(r.data.firstDate,offset);
 for(let i=0;i<count;i++)due({project:r.data.project,title:'راتب '+r.data.name,amount:salary,date:monthAdd(r.data.firstDate,offset+i),direction:'out',category:'salary',employee:r.id,certainty:100});
 update(r,{...r.data,salary,scheduledThrough:monthAdd(r.data.firstDate,offset+count-1)});
 description='تجديد رواتب '+r.data.name+' بدءًا من '+start;
}
else if(action==='stopEmployee'){const r=find(p.id,'employee'),from=date(p.date);update(r,{...r.data,status:'stopped',endDate:from});for(const o of w.records.filter(o=>o.kind==='obligation'&&o.data.employee===r.id&&o.data.status==='pending'&&o.data.date>=from))update(o,{...o.data,status:'cancelled',reason:'إيقاف الموظف'});description='إيقاف استحقاقات موظف: '+r.data.name;}else if(action==='deleteEmployee'){
 const r=find(p.id,'employee');
 const employeeObligations=w.records.filter(x=>x.kind==='obligation'&&x.data.employee===r.id);
 const paid=employeeObligations.filter(x=>x.data.status==='paid');
 if(paid.length)throw Error('لا يمكن حذف الموظف لأن له استحقاقات تم دفعها بالفعل. استخدم إيقاف الاستحقاقات للحفاظ على السجل المالي.');
 const adjustments=w.records.filter(x=>x.kind==='payrollAdjustment'&&x.data.employee===r.id);
 const journalRefs=w.journals.filter(j=>JSON.stringify(j.lines).includes(r.id)||j.source?.includes(r.id));
 if(journalRefs.length)throw Error('لا يمكن حذف الموظف لوجود أثر محاسبي مرتبط به. استخدم الإيقاف أو التصحيح.');
 for(const o of employeeObligations)ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(o.id,owner));
 for(const a of adjustments)ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(a.id,owner));
 ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(r.id,owner));
 description='حذف موظف وسجلاته غير المدفوعة: '+r.data.name;
}
else if(action==='loan'){const projectId=String(p.project||'')==='__unallocated'?'':String(p.project||'');const holder=['personal','business'].includes(p.holder)?p.holder:'business';if(holder==='personal'&&projectId)throw Error('القرض الشخصي يُسجل أولًا في السيولة الشخصية، ثم استخدم خيار تخصيص جزء لمشروع عند ضخ الأموال فيه.');if(projectId)project(projectId);const amountExact=money5(p.amount,'أصل التمويل'),paymentExact=money5(p.monthlyPayment,'القسط الشهري'),start=date(p.start),first=date(p.firstDate),months=Math.trunc(num(p.months,1,360));if(first<start)throw Error('أول قسط يجب أن يكون بعد استلام التمويل.');if(paymentExact<=0)throw Error('أدخل القسط الشهري المحدد من البنك.');const annual=loanRateFromPaymentExact(amountExact,paymentExact,months);const schedule=loanScheduleFromPaymentExact(amountExact,paymentExact,months,first);const amount=Math.round(amountExact*100),payment=Math.round(paymentExact*100);const rid=put('loan',{project:projectId,holder,name:str(p.name),principal:amount,principalExact:amountExact.toFixed(5),rate:annual,monthlyPayment:payment,monthlyPaymentExact:paymentExact.toFixed(5),months,start,firstDate:first,scheduleType:'estimate',fundingMode:p.fundingMode==='opening'?'opening':'new',rateMethod:'implied_from_bank_payment'});for(const [i,s]of schedule.entries())due({...s,project:projectId,title:'قسط '+p.name+' / '+(i+1),direction:'out',category:'loan',loan:rid,certainty:100});const cashAccount=holder==='personal'?'personal_cash':'cash',loanAccount=holder==='personal'?'personal_loan':'loan';const lines:Line[]=projectId?pair(projectId,p.fundingMode==='opening'?'capital':cashAccount,loanAccount,amount):[{project:'',account:p.fundingMode==='opening'?'capital':cashAccount,debit:amount,credit:0},{project:'',account:loanAccount,debit:0,credit:amount}];journal('loan',(p.fundingMode==='opening'?'رصيد تمويل افتتاحي: ':'استلام تمويل: ')+p.name+' — '+(holder==='personal'?'قرض شخصي':'قرض مؤسسة/شركة'),start,lines,'loan:'+rid);description='إضافة تمويل وجدوله التقديري';}
else if(action==='editLoan'){
 const loan=find(p.id,'loan'),d=loan.data;
 if(d.status==='deleted')throw Error('هذا القرض محذوف بالفعل.');
 const dues=w.records.filter(x=>x.kind==='obligation'&&x.data.loan===loan.id),paidDues=dues.filter(x=>x.data.status==='paid'||x.data.status==='settled');
 if(w.records.some(x=>(x.kind==='loanAllocation'||x.kind==='loanUse')&&x.data.loanId===loan.id&&x.data.status!=='cancelled'))throw Error('لا يمكن تعديل قرض له تخصيصات أو استخدامات نشطة؛ ألغِ/صحح هذه الحركات أولًا أو استخدم حذف القرض مع العكس المحاسبي.');
 const linkedPrepayments=w.journals.filter(j=>String(j.source||'').startsWith('prepay:')&&(String(j.source||'').startsWith('prepay:'+loan.id+':')||j.memo==='سداد مبكر: '+String(d.name||'')));
 if(linkedPrepayments.length)throw Error('يوجد سداد مبكر مرتبط بهذا القرض. للحفاظ على صحة الرصيد، لا يمكن تغيير أصل القرض تلقائيًا؛ استخدم حذف القرض مع العكس المحاسبي أو سجّل تصحيحًا مخصصًا.');
 const name=str(p.name),amountExact=money5(p.amount,'أصل القرض'),paymentExact=money5(p.monthlyPayment,'القسط الشهري'),months=Math.trunc(num(p.months,1,360)),start=date(p.start),first=date(p.firstDate);
 const holder=['personal','business'].includes(p.holder)?p.holder:'business',fundingMode=p.fundingMode==='opening'?'opening':'new';
 const projectId=holder==='personal'||String(p.project||'')==='__unallocated'?'':String(p.project||'');
 if(projectId)project(projectId);
 if(start>today())throw Error('تاريخ استلام/إثبات القرض لا يمكن أن يكون مستقبليًا.');
 if(first<=start)throw Error('أول قسط يجب أن يكون بعد تاريخ استلام/إثبات القرض.');
 if(first<=today())throw Error('تاريخ أول قسط الجديد يجب أن يكون في المستقبل؛ غيّر موعده لتجنب إعادة إنشاء استحقاقات قديمة.');
 if(paymentExact<=0)throw Error('القسط الشهري يجب أن يكون أكبر من صفر.');
 const amount=Math.round(amountExact*100),payment=Math.round(paymentExact*100),loanAccount=holder==='personal'?'personal_loan':'loan',cashAccount=holder==='personal'?'personal_cash':'cash';
 if(months<paidDues.length)throw Error('عدد الأقساط الجديد أقل من عدد الأقساط المسددة بالفعل.');
 if(paidDues.length&&(start!==String(d.start||'')||projectId!==String(d.project||'')||holder!==String(d.holder||'business')||fundingMode!==(d.fundingMode==='opening'?'opening':'new')))throw Error('يمكن تعديل أصل القرض وجدوله بعد سداد أقساط، لكن لا يمكن تغيير تاريخ الاستلام أو جهة القرض أو المشروع أو نوع التسجيل بعد السداد؛ استخدم حذف القرض مع العكس المحاسبي لإعادة تصنيفه بالكامل.');
 const paidPrincipal=paidDues.reduce((sum,o)=>sum+Number(o.data.principal||0),0);
 if(amount<paidPrincipal)throw Error('أصل القرض الجديد أقل من أصل الأقساط التي سددتها بالفعل؛ لا يمكن تسجيل هذا التعديل.');
 const remainingPrincipal=Math.max(0,amount-paidPrincipal),remainingMonths=months-paidDues.length;
 if(remainingPrincipal>0&&remainingMonths<1)throw Error('عدد الأقساط المتبقية غير كافٍ لسداد أصل الدين بعد الأقساط المسددة.');
 const annual=remainingPrincipal>0?loanRateFromPaymentExact(remainingPrincipal/100,paymentExact,remainingMonths):0;
 const schedule=remainingPrincipal>0?loanScheduleFromPaymentExact(remainingPrincipal/100,paymentExact,remainingMonths,first):[];
 const activeOrigin=w.journals.filter(j=>(j.source==='loan:'+loan.id||String(j.source||'').startsWith('loan-edit:'+loan.id+':'))&&!w.journals.some(x=>x.reversal===j.id));
 if(activeOrigin.length!==1)throw Error('تعذر تحديد قيد استلام القرض النشط بشكل فريد؛ أوقفنا التعديل لحماية الأستاذ.');
 const original=activeOrigin[0],oldCashAccount=d.holder==='personal'?'personal_cash':'cash',oldProject=String(d.project||'');
 if(!paidDues.length){
  if(d.fundingMode!=='opening'){
   const currentCash=w.journals.flatMap(j=>j.lines).filter(l=>String(l.project||'')===oldProject&&l.account===oldCashAccount).reduce((sum,l)=>sum+Number(l.debit||0)-Number(l.credit||0),0);
   const oldPrincipal=Math.round(Number(d.principal||0)),sameCashDestination=oldProject===projectId&&oldCashAccount===(holder==='personal'?'personal_cash':'cash')&&fundingMode==='new';
   const cashNeeded=sameCashDestination?Math.max(0,oldPrincipal-amount):oldPrincipal;
   if(currentCash<cashNeeded)throw Error('لا يمكن تعديل أصل القرض أو وجهته بأمان لأن السيولة الأصلية صُرفت أو لم تعد متاحة في حسابها الحالي. سجّل مصدر التمويل/التصحيح أولًا ثم أعد المحاولة.');
  }
  const newProject=w.records.find(x=>x.kind==='project'&&x.id===projectId);
  if(newProject&&newProject.data.closedThrough&&start<=newProject.data.closedThrough)throw Error('تاريخ القرض الجديد يقع داخل فترة محاسبية مقفلة في المشروع.');
  journal('reversal','عكس قيد القرض قبل التعديل: '+String(d.name||''),today(),original.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,original.id);
  const debitAccount=fundingMode==='opening'?'capital':cashAccount;
  const lines:Line[]=projectId?pair(projectId,debitAccount,loanAccount,amount):[{project:'',account:debitAccount,debit:amount,credit:0},{project:'',account:loanAccount,debit:0,credit:amount}];
  journal('loan','تصحيح بيانات القرض وإعادة إثباته: '+name+' — '+(holder==='personal'?'قرض شخصي':'قرض مؤسسة/شركة'),start,lines,'loan-edit:'+loan.id+':'+uid());
 }else{
  const samePrincipal=amount===Number(d.principal||0);
  if(!samePrincipal){
   const delta=amount-Number(d.principal||0),oldMode=d.fundingMode==='opening'?'opening':'new';
   if(delta<0&&oldMode==='new'){
    const currentCash=w.journals.flatMap(j=>j.lines).filter(l=>String(l.project||'')===oldProject&&l.account===oldCashAccount).reduce((sum,l)=>sum+Number(l.debit||0)-Number(l.credit||0),0);
    if(currentCash<Math.abs(delta))throw Error('لا يمكن تخفيض أصل القرض لأن رصيد السيولة الحالي لا يكفي لإثبات فرق التخفيض بأمان.');
   }
   const debitAccount=delta>0?(oldMode==='opening'?'capital':cashAccount):loanAccount,creditAccount=delta>0?loanAccount:(oldMode==='opening'?'capital':cashAccount),adjustment=Math.abs(delta);
   const lines:Line[]=projectId?pair(projectId,debitAccount,creditAccount,adjustment):[{project:'',account:debitAccount,debit:adjustment,credit:0},{project:'',account:creditAccount,debit:0,credit:adjustment}];
   journal('loanAdjustment','تعديل أصل القرض بعد أقساط مسددة: '+name,today(),lines,'loan-edit-adjustment:'+loan.id+':'+uid());
  }
 }
 for(const o of dues)if(o.data.status==='pending')update(o,{...o.data,status:'cancelled',cancelledAt:time,cancellationReason:'إعادة بناء بيانات القرض من شاشة التعديل'});
 update(loan,{...d,name,holder,project:projectId,principal:amount,principalExact:amountExact.toFixed(5),rate:annual,monthlyPayment:payment,monthlyPaymentExact:paymentExact.toFixed(5),months,start,firstDate:first,fundingMode,scheduleType:'estimate',rateMethod:'implied_from_bank_payment',scheduleEditedAt:time,status:'active'});
 for(const [i,item] of schedule.entries())due({...item,project:projectId,title:'قسط '+name+' / '+(paidDues.length+i+1),direction:'out',category:'loan',loan:loan.id,certainty:100});
 description=paidDues.length?'تعديل أصل القرض وشروط الأقساط المتبقية مع الحفاظ على الأقساط المسددة':'تعديل جميع بيانات القرض وإعادة بناء القيد والجدول';
}
else if(action==='deleteLoan'){
 const loan=find(p.id,'loan'),d=loan.data;
 if(d.status==='deleted')throw Error('هذا القرض محذوف بالفعل.');
 const dues=w.records.filter(x=>x.kind==='obligation'&&x.data.loan===loan.id);
 const allocations=w.records.filter(x=>x.kind==='loanAllocation'&&x.data.loanId===loan.id);
 const uses=w.records.filter(x=>x.kind==='loanUse'&&x.data.loanId===loan.id);
 const dueSources=new Set(dues.map(x=>'obligation:'+x.id)),allocationSources=new Set(allocations.map(x=>'loan-allocation:'+x.id)),useSources=new Set(uses.map(x=>'loan-use:'+x.id));
 const legacyPrepayments=w.journals.filter(j=>String(j.source||'').startsWith('prepay:')&&j.memo==='سداد مبكر: '+String(d.name||'')&&!String(j.source||'').startsWith('prepay:'+loan.id+':'));
 if(legacyPrepayments.length&&w.records.filter(x=>x.kind==='loan'&&x.data.status!=='deleted'&&String(x.data.name||'')===String(d.name||'')).length>1)throw Error('يوجد أكثر من قرض بالاسم نفسه وسداد مبكر قديم غير مرتبط بمعرّف القرض؛ لم نحذف لتجنب عكس قيد القرض الخطأ.');
 const linked=w.journals.filter(j=>j.source==='loan:'+loan.id||String(j.source||'').startsWith('loan-edit:'+loan.id+':')||String(j.source||'').startsWith('loan-edit-adjustment:'+loan.id+':')||String(j.source||'').startsWith('loan-reassign-general:'+loan.id)||dueSources.has(String(j.source||''))||allocationSources.has(String(j.source||''))||useSources.has(String(j.source||''))||String(j.source||'').startsWith('prepay:'+loan.id+':')||legacyPrepayments.some(x=>x.id===j.id));
 if(!linked.length)throw Error('لم يُعثر على قيود مرتبطة بالقرض. لم يتم حذف أي بيانات؛ راجع سجل القرض أولًا.');
 const alreadyReversed=new Set(w.journals.map(j=>j.reversal).filter(Boolean));
 const toReverse=linked.filter(j=>!alreadyReversed.has(j.id));
 for(const j of toReverse)for(const line of j.lines){if(!line.project)continue;const pr=w.records.find(x=>x.kind==='project'&&x.id===line.project);if(pr&&pr.data.closedThrough&&today()<=pr.data.closedThrough)throw Error('تعذر حذف القرض لأن أحد قيوده مرتبط بفترة مقفلة حتى '+pr.data.closedThrough+'. لا يمكن إنشاء عكس داخل فترة مقفلة.');}
 for(const j of toReverse.slice().reverse())journal('reversal','عكس مرتبط بحذف القرض '+String(d.name||'')+': '+j.memo,today(),j.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,j.id);
 for(const o of dues)update(o,{...o.data,...(o.data.status==='pending'?{status:'cancelled',cancelledAt:time,cancellationReason:'حذف القرض المرتبط'}:{}),loanDeletedAt:time});
 for(const r of [...allocations,...uses])if(r.data.status!=='cancelled')update(r,{...r.data,status:'cancelled',cancelledAt:time,cancellationReason:'حذف القرض المرتبط'});
 update(loan,{...d,status:'deleted',deletedAt:time,deleteReason:'حذف من شاشة القروض مع عكس القيود المرتبطة'});
 description='حذف القرض مع عكس قيود الاستلام والأقساط والتخصيصات والاستخدامات المرتبطة';
}
else if(action==='reassignLoanToGeneral'){
 const loan=find(p.id,'loan'),d=loan.data,from=String(d.project||'');
 if(!from)throw Error('القرض بالفعل عام وغير مخصص لمشروع.');
 if(d.holder==='personal')throw Error('القرض الشخصي يجب أن يبقى في السيولة الشخصية.');
 if(d.fundingMode==='opening')throw Error('لا يمكن تحويل رصيد افتتاحي إلى سيولة عامة؛ فهذا الرصيد لا يمثل نقدًا مستلمًا.');
 const pr=project(from),dt=date(p.date||today());
 if(dt>today())throw Error('تاريخ التصحيح لا يمكن أن يكون مستقبليًا.');
 const dues=w.records.filter(x=>x.kind==='obligation'&&x.data.loan===loan.id);
 if(dues.some(x=>x.data.status==='paid'))throw Error('لا يمكن تغيير الوجهة آليًا بعد سداد أي قسط؛ يلزم تصحيح محاسبي مخصص يحافظ على تاريخ السداد.');
 if(dues.some(x=>String(x.data.date||'')<=today()))throw Error('يوجد قسط مستحق أو مؤرخ اليوم/سابقًا. سوِّ الاستحقاقات أو راجعها قبل تغيير الوجهة.');
 if(w.records.some(x=>(x.kind==='loanAllocation'||x.kind==='loanUse')&&x.data.loanId===loan.id&&x.data.status!=='cancelled'))throw Error('للقرض تخصيصات أو استخدامات مسجلة؛ يجب تسويتها أولًا قبل تغيير وجهته.');
 const amount=Math.round(Number(d.principal||0));
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('تعذر تحديد أصل القرض المسجل بدقة.');
 const cashNow=w.journals.flatMap(j=>j.lines).filter(l=>l.project===from&&l.account==='cash').reduce((s,l)=>s+l.debit-l.credit,0);
 if(cashNow<amount)throw Error('رصيد الصندوق داخل المشروع أقل من أصل القرض؛ لا يمكن نقل القيد بأمان. راجع حركة النقد أولًا.');
 if(pr.data.closedThrough&&dt<=pr.data.closedThrough)throw Error('الفترة المحاسبية للمشروع مقفلة في هذا التاريخ.');
 const loanAccount='loan';
 const lines:Line[]=[
  {project:from,account:loanAccount,debit:amount,credit:0},
  {project:from,account:'cash',debit:0,credit:amount},
  {project:'',account:'cash',debit:amount,credit:0},
  {project:'',account:loanAccount,debit:0,credit:amount}
 ];
 journal('transfer','تصحيح وجهة القرض إلى التمويل العام: '+str(d.name,200),dt,lines,'loan-reassign-general:'+loan.id);
 update(loan,{...d,project:'',reassignedToGeneralOn:dt,previousProject:from});
 for(const o of dues)if(o.data.status==='pending')update(o,{...o.data,project:''});
 description='تصحيح وجهة القرض من مشروع إلى التمويل العام مع قيد إعادة تصنيف متوازن';
}
else if(action==='allocateLoanFunds'){const loan=find(p.loanId,'loan');if(!p.project||p.project==='__choose')throw Error('اختر المشروع المستفيد.');const target=project(p.project),dt=date(p.date||today()),holder=loan.data.holder==='personal'?'personal':'business',pay=holder==='personal'?'personal_cash':(['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'bank');if(loan.data.project)throw Error('هذا القرض مرتبط بمشروع بالفعل؛ اختر قرضًا عامًا غير مخصص.');if(loan.data.fundingMode==='opening')throw Error('الرصيد الافتتاحي لا يمثل نقدًا مستلمًا قابلًا للتخصيص.');if(dt>today())throw Error('تخصيص السيولة لا يمكن تسجيله بتاريخ مستقبلي.');const amount=halala(p.amount,'مبلغ التخصيص');if(amount<=0)throw Error('أدخل مبلغًا أكبر من صفر.');const allocated=w.records.filter(x=>(x.kind==='loanAllocation'||x.kind==='loanUse')&&x.data.loanId===loan.id&&x.data.status!=='cancelled').reduce((s,x)=>s+Number(x.data.amount||0),0);if(allocated+amount>Number(loan.data.principal||0))throw Error('إجمالي التخصيصات يتجاوز أصل القرض المسجل.');const generalCash=w.journals.filter(j=>j.date<=dt).flatMap(j=>j.lines).filter(l=>!l.project&&l.account===pay).reduce((s,l)=>s+l.debit-l.credit,0);if(amount>generalCash)throw Error('رصيد الحساب العام المحدد لا يكفي للتخصيص.');const rid=put('loanAllocation',{loanId:loan.id,project:target.id,amount,date:dt,paymentAccount:pay,holder:loan.data.holder||'business'});journal('transfer','تخصيص جزء من قرض '+loan.data.name+' إلى '+target.data.name,dt,[{project:'',account:'inter_receivable',debit:amount,credit:0},{project:'',account:pay,debit:0,credit:amount},{project:target.id,account:'cash',debit:amount,credit:0},{project:target.id,account:'inter_payable',debit:0,credit:amount}],'loan-allocation:'+rid);description='تخصيص سيولة قرض لمشروع دون اعتبارها إيرادًا أو ربحًا';}
else if(action==='useLoanFundsOutsideProjects'){const loan=find(p.loanId,'loan');if(loan.data.project)throw Error('هذا القرض مرتبط بمشروع؛ اختر قرضًا عامًا غير مخصص.');if(loan.data.fundingMode==='opening')throw Error('الرصيد الافتتاحي لا يمثل نقدًا مستلمًا قابلًا للاستخدام.');const dt=date(p.date||today());if(dt>today())throw Error('استخدام السيولة لا يمكن تسجيله بتاريخ مستقبلي.');const amount=halala(p.amount,'مبلغ الاستخدام');if(amount<=0)throw Error('أدخل مبلغًا أكبر من صفر.');const holder=loan.data.holder==='personal'?'personal':'business',pay=holder==='personal'?'personal_cash':(['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'bank');const used=w.records.filter(x=>(x.kind==='loanAllocation'||x.kind==='loanUse')&&x.data.loanId===loan.id&&x.data.status!=='cancelled').reduce((s,x)=>s+Number(x.data.amount||0),0);if(used+amount>Number(loan.data.principal||0))throw Error('إجمالي التخصيصات والاستخدامات يتجاوز أصل القرض.');const available=w.journals.filter(j=>j.date<=dt).flatMap(j=>j.lines).filter(l=>!l.project&&l.account===pay).reduce((s,l)=>s+l.debit-l.credit,0);if(amount>available)throw Error('رصيد السيولة العامة لا يكفي لهذا الاستخدام.');const rid=put('loanUse',{loanId:loan.id,amount,date:dt,holder,paymentAccount:pay,memo:str(p.memo||'استخدام خارج المشاريع')});const debitAccount=holder==='personal'?'personal_use':'expense';journal('expense','استخدام من القرض خارج المشاريع: '+loan.data.name,dt,[{project:'',account:debitAccount,debit:amount,credit:0},{project:'',account:pay,debit:0,credit:amount}],'loan-use:'+rid);description='تسجيل استخدام من السيولة العامة خارج المشاريع';}
else if(action==='replaceSchedule'){const r=find(p.id,'loan'),d=r.data;const pending=w.records.filter(x=>x.kind==='obligation'&&x.data.loan===r.id&&x.data.status==='pending');const remaining=pending.reduce((s,x)=>s+x.data.principal,0),prepay=cents(p.prepay||0),fee=cents(p.fee||0),dt=date(p.date);if(dt>today())throw Error('تاريخ الاعتماد لا يمكن أن يكون مستقبليًا.');if(prepay>remaining)throw Error('السداد أكبر من أصل الدين المتبقي.');const rows=(p.rows||'').trim()?str(p.rows,30000).split('\n').map((line:string)=>{const [dateStr,pr,it]=line.trim().split(',');return {date:date(dateStr),principal:cents(pr),interest:cents(it)};}):[];if(rows.length>360)throw Error('الحد الأقصى 360 قسطًا.');if(rows.some((s:any,i:number)=>s.date<dt||s.principal+s.interest<=0||(i>0&&s.date<=rows[i-1].date)))throw Error('تواريخ الأقساط يجب أن تكون متزايدة وبعد تاريخ التسوية.');if(rows.reduce((s:number,x:any)=>s+x.principal,0)!==remaining-prepay)throw Error('مجموع أصل الأقساط الجديدة لا يساوي الرصيد المتبقي بعد السداد.');update(r,{...d,scheduleType:'confirmed',revisedOn:dt});for(const o of pending)update(o,{...o.data,status:'replaced'});for(const [i,s]of rows.entries())due({...s,amount:s.principal+s.interest,project:d.project,title:'قسط '+d.name+' / '+(i+1),direction:'out',category:'loan',loan:r.id,certainty:100});if(prepay+fee>0){const pay=['cash','bank'].includes(p.paymentAccount)?p.paymentAccount:'bank';journal('prepay','سداد مبكر: '+d.name,dt,[...(prepay?[{project:d.project,account:d.holder==='personal'?'personal_loan':'loan',debit:prepay,credit:0}]:[]),...(fee?[{project:d.project,account:'interest',debit:fee,credit:0}]:[]),{project:d.project,account:pay,debit:0,credit:prepay+fee}],'prepay:'+r.id+':'+id);}description='اعتماد جدول البنك وتسجيل السداد المبكر';}
else if(action==='risk'){if(p.project!=='all')find(p.project,'project');put('risk',{project:p.project,title:str(p.title),likelihood:num(p.likelihood,1,5),impact:num(p.impact,1,5),control:str(p.control,1000),responsible:str(p.responsible),reviewDate:date(p.reviewDate),status:'open'});description='إضافة خطر: '+p.title;}
else if(action==='resolveRisk'){const r=find(p.id,'risk');update(r,{...r.data,status:'resolved',resolution:str(p.resolution,500),resolvedOn:today()});description='توثيق معالجة خطر';}
else throw Error('عملية غير معروفة.');
// Bound JSON keeps SQL and parameter counts small even for a 360-month loan.
if(inserts.length)ops.push(db.prepare("INSERT INTO records(id,owner,kind,data,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.data'),? FROM json_each(?)").bind(owner,time,JSON.stringify(inserts)));
if(patches.size){
 ops.push(db.prepare("UPDATE records SET data=json_extract(patch.value,'$.data'),version=records.version+1 FROM json_each(?) AS patch WHERE records.id=json_extract(patch.value,'$.id') AND records.owner=? AND records.version=json_extract(patch.value,'$.version')").bind(JSON.stringify([...patches.values()]),owner));
 // A stale patch must abort the whole D1 batch. The conditional duplicate command below intentionally creates a UNIQUE violation only when the version check fails, rolling back journals/records/audit together.
 ops.push(db.prepare("INSERT INTO commands(id,owner,created) SELECT ?,?,? WHERE changes()<>?").bind(id,owner,time,patches.size));
}
for(const [pid,version]of ledgerLocks){
 // A record already updated through the optimistic patch map is version-guarded by that UPDATE.
 // Do not lock/version-bump it a second time using its now-stale snapshot version.
 if(patches.has(pid))continue;
 ops.push(db.prepare('UPDATE records SET version=version+1 WHERE id=? AND owner=? AND version=?').bind(pid,owner,version));
 // Same atomic conflict guard for project ledger locks.
 ops.push(db.prepare("INSERT INTO commands(id,owner,created) SELECT ?,?,? WHERE changes()<>1").bind(id,owner,time));
}
ops.push(db.prepare('INSERT INTO audit(id,owner,action,detail,created) VALUES(?,?,?,?,?)').bind(uid(),owner,action,req.headers.get('oai-authenticated-user-email')?description+' — '+req.headers.get('oai-authenticated-user-email'):description,time));ops.push(db.prepare('INSERT INTO commands(id,owner,created) VALUES(?,?,?)').bind(id,owner,time));try{await db.batch(ops);}catch(e:any){if(await db.prepare('SELECT id FROM commands WHERE id=? AND owner=?').bind(id,owner).first())return Response.json({ok:true,replayed:true});if(/UNIQUE|malformed JSON/.test(e.message))throw Error('تغيرت البيانات أو تم تسجيل العملية مسبقًا. حدث الصفحة.');throw e;}return Response.json({ok:true});
}catch(e:any){console.error('workspace operation:',e.message);return Response.json({error:e.message==='AUTH'?'سجل الدخول أولًا.':(/D1|SQLITE|syntax|no such/.test(e.message)?'تعذر حفظ العملية. لم يتم اعتمادها. حاول مجددًا.':e.message||'تعذر حفظ العملية.')},{status:e.message==='AUTH'?401:400});}}
