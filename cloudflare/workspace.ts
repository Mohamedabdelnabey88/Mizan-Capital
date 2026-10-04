import {database} from '@/db';
import {projectPerformance} from '@/lib/project-performance';
import {accounts,cents,dayAdd,monthAdd,today,validateLines,loanSchedule,loanRateFromPayment,loanScheduleFromPayment,loanRateFromPaymentExact,loanScheduleFromPaymentExact,balance,profit,forecast,internalFunding,distributionEntitlement,fiscalYearForStart,type Workspace,type Line} from '@/lib/finance';
export const dynamic='force-dynamic'; // financial operations: halala-safe ledger, auditable daily corrections, investments, annual owner settlement, historical owner-policy effective dates
const uid=()=>crypto.randomUUID();
function str(v:any,n=200){if(typeof v!=='string'||!v.trim()||v.length>n)throw Error('راجع الحقول المطلوبة وطول النص.');return v.trim();}
function date(v:any){const s=str(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s+'T12:00Z'))||new Date(s+'T12:00Z').toISOString().slice(0,10)!==s)throw Error('تاريخ غير صحيح.');return s;}
function num(v:any,min:number,max:number){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error('قيمة رقمية خارج النطاق المسموح.');return n;}
async function snapshot(db:D1Database,owner:string):Promise<Workspace>{const [a,b,c]=await Promise.all([db.prepare('SELECT * FROM records WHERE owner=? ORDER BY created').bind(owner).all(),db.prepare('SELECT * FROM journals WHERE owner=? ORDER BY date DESC,created DESC').bind(owner).all(),db.prepare('SELECT * FROM audit WHERE owner=? ORDER BY created DESC LIMIT 200').bind(owner).all()]);const base:any={records:a.results.map((r:any)=>({...r,data:JSON.parse(r.data)})),journals:b.results.map((r:any)=>({...r,lines:JSON.parse(r.lines)})),audit:c.results};for(const pr of base.records.filter((r:any)=>r.kind==='project')){const plans=base.records.filter((r:any)=>r.kind==='projectPlan'&&r.data.project===pr.id).sort((x:any,y:any)=>String(x.data.effectiveFrom).localeCompare(String(y.data.effectiveFrom)));const lp=plans.at(-1)?.data;if(lp){pr.data.planMonthlyRevenueMicro=Number(lp.revenueMonthlyMicro||0);pr.data.planDailyRevenueMicro=Number(lp.revenueDailyMicro||0);pr.data.planMonthlyExpenseMicro=Number(lp.expenseMonthlyMicro||0);pr.data.planNetMonthlyMicro=Number(lp.netMonthlyMicro||0);pr.data.planEffectiveFrom=lp.effectiveFrom;}}base.projectPerformance=Object.fromEntries(base.records.filter((r:any)=>r.kind==='project'&&r.data.mode==='operating').map((r:any)=>[r.id,projectPerformance(base,r.id,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric'}).format(new Date())+'-01-01',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))]));return base;}
function identify(req:Request){const owner=req.headers.get('oai-authenticated-user-id');if(!owner)throw Error('AUTH');return owner;}
export async function GET(req:Request){try{const owner=identify(req);return Response.json(await snapshot(database(),owner),{headers:{'Cache-Control':'no-store'}});}catch(e:any){return Response.json({error:e.message==='AUTH'?'سجل الدخول للوصول إلى بياناتك.':'تعذر تحميل البيانات. حاول مجددًا.'},{status:e.message==='AUTH'?401:503});}}
function operatingRows(w:Workspace,year:number){const fy=fiscalYearForStart(w,year);return w.records.filter(r=>r.kind==='project'&&r.data.mode==='operating').map(r=>({...r.data,id:r.id,net:profit(w,r.id,fy.start,fy.end).net}));}
function ownerPolicyForYear(w:Workspace,year:number){const end=fiscalYearForStart(w,year).end;return w.records.filter(r=>r.kind==='ownerPolicy'&&String(r.data.effectiveFrom||'')<=end).sort((a,b)=>String(a.data.effectiveFrom||'').localeCompare(String(b.data.effectiveFrom||''))).at(-1);}
export async function POST(req:Request){try{const owner=identify(req);if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'طلب غير مسموح'},{status:403});if(!req.headers.get('content-type')?.includes('application/json'))throw Error('نوع الطلب غير صحيح.');const raw=await req.text();if(raw.length>100000)throw Error('حجم الطلب أكبر من المسموح.');const body=JSON.parse(raw);const action=str(body.action,50),id=str(body.requestId,100),p=body.payload||{};const db=database();if(await db.prepare('SELECT id FROM commands WHERE id=? AND owner=?').bind(id,owner).first())return Response.json({ok:true,replayed:true});const w=await snapshot(db,owner),time=new Date().toISOString();let ops:D1PreparedStatement[]=[];const ledgerLocks=new Map<string,number>();const inserts:{id:string;kind:string;data:string}[]=[];
const patches=new Map<string,{id:string;version:number;data:string}>();
const guardProject=(pid:string)=>{const pr=w.records.find(r=>r.id===pid&&r.kind==='project');if(pr)ledgerLocks.set(pr.id,pr.version);};
const put=(kind:string,data:any,rid=uid())=>{inserts.push({id:rid,kind,data:JSON.stringify(data)});if(data.project)guardProject(data.project);return rid;};
const find=(rid:string,kind?:string)=>{const r=w.records.find(r=>r.id===rid&&(!kind||r.kind===kind));if(!r)throw Error('السجل غير موجود أو غير مسموح.');return r;};
const update=(r:any,data:any)=>{patches.set(r.id,{id:r.id,version:r.version,data:JSON.stringify(data)});if(data.project)guardProject(data.project);};
const money5=(v:any,label='المبلغ')=>{const s=String(v??'').trim().replace(/,/g,'');if(!/^\d+(?:\.\d{1,5})?$/.test(s))throw Error(label+' يجب أن يصل إلى 5 منازل عشرية كحد أقصى.');const n=Number(s);if(!Number.isFinite(n)||n<0||n>1000000000)throw Error(label+' خارج النطاق المسموح.');return Number(n.toFixed(5));};
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
const project=(rid:string)=>{const r=find(rid,'project');if(r.data.mode==='investment')throw Error('الاستثمار الخارجي يسجل في دفاتر المشروع الممول.');return r;};
const journal=(kind:string,memo:string,d:string,lines:Line[],source:string|null=null,reversal:string|null=null)=>{validateLines(lines);date(d);if(d>today())throw Error('سجل العمليات المستقبلية في الالتزامات، وليس في القيود الفعلية.');for(const l of lines){const pr=project(l.project);ledgerLocks.set(pr.id,pr.version);if(pr.data.closedThrough&&d<=pr.data.closedThrough)throw Error('الفترة مقفلة في هذا المشروع.');}ops.push(db.prepare('INSERT INTO journals(id,owner,date,memo,kind,lines,source,reversal,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(),owner,d,str(memo,500),kind,JSON.stringify(lines),source,reversal,time));};
const pair=(pr:string,debit:string,credit:string,a:number):Line[]=>[{project:pr,account:debit,debit:a,credit:0},{project:pr,account:credit,debit:0,credit:a}];
const due=(data:any,rid=uid())=>put('obligation',{status:'pending',...data},rid);
let description=action;
if(action==='deleteRecord'){
 const r=find(p.id);
 const financialKinds=new Set(['projectFunding','fundingRepayment','dailyReport','dailyReportCorrection','entry','obligation','settlement','loan','loanSchedule','journal','ownerSettlement','ownerDistribution','investmentCycle','investmentReturn','payroll','payrollAdjustment','closing','fiscalYear']);
 if(financialKinds.has(r.kind)) throw Error('السجل المالي لا يُحذف نهائيًا حتى لا يختفي أثره من الأستاذ والتقارير. استخدم عكس القيد أو التصحيح من الشاشة المناسبة.');
 const refs=w.records.filter(x=>x.id!==r.id&&JSON.stringify(x.data).includes(r.id));
 const journalRefs=w.journals.filter(j=>j.source===r.id||j.reversal===r.id||JSON.stringify(j.lines).includes(r.id));
 if(refs.length||journalRefs.length) throw Error('لا يمكن حذف هذا السجل لأنه مرتبط بسجلات أخرى. احذف الروابط التابعة أولًا أو استخدم الإجراء المحاسبي الآمن.');
 ops.push(db.prepare('DELETE FROM records WHERE id=? AND owner=?').bind(r.id,owner));
 description='حذف سجل غير مالي: '+r.kind;
}
else if(action==='project'){const projectId=uid();const monthlyRevenueMicro=planMoneyMicro(p.expectedMonthlyRevenue||0,'الإيراد الشهري المتوقع');const dailyRevenueMicro=planMoneyMicro(p.expectedDailyRevenue||0,'الإيراد اليومي المتوقع');const monthlyExpenseMicro=planMoneyMicro(p.expectedMonthlyExpense||0,'المصروف الشهري المتوقع');const monthlyNetMicro=planMoneyMicro(p.expectedNetMonthly||0,'صافي الدخل الشهري المتوقع');put('project',{name:str(p.name),activity:str(p.activity),mode:['operating','investment'].includes(p.mode)?p.mode:'operating',ownership:num(p.ownership,0.01,100),reserve:cents(p.reserve||0),payout:num(p.payout??30,0,100),expectedNetMonthly:monthlyNetMicro/1000,partner:p.partner?str(p.partner):'',closedThrough:''},projectId);if(p.mode==='operating')put('projectPlan',{project:projectId,effectiveFrom:date(p.planEffectiveFrom||today()),revenueMonthlyMicro:monthlyRevenueMicro,revenueDailyMicro:dailyRevenueMicro,expenseMonthlyMicro:monthlyExpenseMicro,expenseDailyMicro:0,netMonthlyMicro:monthlyNetMicro,source:'original_baseline',label:'الخطة الأصلية'});description='إضافة مشروع: '+p.name;}
else if(action==='projectSettings'){const r=find(p.id,'project');if(p.version!==r.version)throw Error('تغيرت البيانات. حدث الصفحة.');const oldPlan=projectPlansSnapshot(w,r.id);const planChanged=['expectedMonthlyRevenue','expectedDailyRevenue','expectedMonthlyExpense','expectedNetMonthly'].some(k=>String(p[k]??'')!=='');update(r,{...r.data,name:str(p.name),reserve:cents(p.reserve),payout:num(p.payout,0,100),expectedNetMonthly:p.expectedNetMonthly?halala(p.expectedNetMonthly,'صافي الدخل الشهري المتوقع'):0,partner:p.partner?str(p.partner):''});if(r.data.mode==='operating'&&planChanged){put('projectPlan',{project:r.id,effectiveFrom:date(p.planEffectiveFrom||today()),revenueMonthlyMicro:planMoneyMicro(p.expectedMonthlyRevenue||0,'الإيراد الشهري المتوقع'),revenueDailyMicro:planMoneyMicro(p.expectedDailyRevenue||0,'الإيراد اليومي المتوقع'),expenseMonthlyMicro:planMoneyMicro(p.expectedMonthlyExpense||0,'المصروف الشهري المتوقع'),expenseDailyMicro:0,netMonthlyMicro:planMoneyMicro(p.expectedNetMonthly||0,'صافي الدخل الشهري المتوقع'),source:'plan_revision',label:'خطة معدلة'});}description='تعديل إعدادات مشروع: '+r.data.name;}
else if(action==='setFiscalYear'){const start=date(p.start);const end=date(p.end);if(start>=end)throw Error('بداية السنة المالية يجب أن تسبق نهايتها.');if((start.slice(0,4)==='')||(end.slice(0,4)===''))throw Error('تواريخ السنة المالية غير صحيحة.');const overlap=w.records.find(x=>x.kind==='fiscalYear'&&String(x.data.start)<=end&&String(x.data.end)>=start&&!(String(x.data.start)===start&&String(x.data.end)===end));if(overlap)throw Error('الفترة تتداخل مع سنة مالية مسجلة بالفعل.');const same=w.records.find(x=>x.kind==='fiscalYear'&&String(x.data.start)===start&&String(x.data.end)===end);const data={start,end,label:str(p.label||('السنة المالية '+start+' إلى '+end),120)};if(same)update(same,data);else put('fiscalYear',data);description='تحديد السنة المالية من '+start+' إلى '+end;}
else if(action==='closePeriod'){const r=project(p.id);const d=date(p.date);if(d>today()||d<(r.data.closedThrough||''))throw Error('يمكن فقط إقفال فترة منتهية بعد آخر إقفال.');update(r,{...r.data,closedThrough:d});description='إقفال فترة '+r.data.name+' حتى '+d;}
else if(action==='entry'){const pr=project(p.project),a=cents(p.amount);if(!a)throw Error('المبلغ يجب أن يكون أكبر من صفر.');const policy=taxPolicyFor(w,date(p.date));const taxMode=['none','inclusive','exclusive'].includes(p.taxMode)?p.taxMode:(policy.enabled?policy.defaultMode:'none');const taxRate=percentBps(p.taxRate??(Number(policy.rateBps||0)/100),'نسبة الضريبة');const mappings:Record<string,string[]>={income:['cash','revenue'],invoice:['receivable','revenue'],collect:['cash','receivable'],expense:['expense','cash'],bill:['expense','payable'],paybill:['payable','cash'],capital:['cash','capital'],asset:['fixed','cash'],inventory:['inventory','cash'],cogs:['cogs','inventory'],depreciation:['depreciation','accumulated'],invest:['investment','cash'],dividend:['cash','dividend'],returnCapital:['cash','investment'],distribution:['distribution','cash'],cardSettlement:['bank','mada'],investmentStart:['investment','cash'],investmentReturn:['cash','investment']};let lines:Line[]=[];if(p.kind==='transfer'){project(p.target);if(p.target===p.project)throw Error('اختر مشروعين مختلفين.');lines=[...pair(p.project,'inter_receivable','cash',a),...pair(p.target,'cash','inter_payable',a)];}else if(p.kind==='repayTransfer'){project(p.target);if(p.target===p.project)throw Error('اختر مشروعين مختلفين.');if(a>Math.min(internalFunding(w,p.target,p.project,date(p.date)),internalFunding(w,p.target,p.project)))throw Error('المبلغ يتجاوز التمويل المستحق للمشروع المحدد.');lines=[...pair(p.project,'inter_payable','cash',a),...pair(p.target,'cash','inter_receivable',a)];}else if(p.kind==='manual'){if(p.debit===p.credit)throw Error('طرفا القيد يجب أن يكونا مختلفين.');if(['inter_receivable','inter_payable','distribution','loan','investment'].includes(p.debit)||['inter_receivable','inter_payable','distribution','loan','investment'].includes(p.credit))throw Error('لهذه الحسابات استخدم التحويل أو التوزيع أو التمويل أو الاستثمار المخصص لحفظ ترابط السجلات.');lines=pair(p.project,str(p.debit),str(p.credit),a);}else{if(!mappings[p.kind])throw Error('نوع حركة غير معروف.');const isSale=['income','invoice'].includes(p.kind),isPurchase=['expense','bill','asset','inventory'].includes(p.kind);if(taxMode!=='none'&&!policy.enabled)throw Error('الضريبة غير مفعلة في سياسة الفترة؛ فعّلها أو اختر بدون ضريبة.');if(taxMode!=='none'&&!((isSale&&policy.salesTax)||(isPurchase&&policy.purchaseTax)))throw Error('هذه الحركة لا تستخدم الضريبة حسب السياسة الحالية.');if(taxMode==='none')lines=pair(p.project,mappings[p.kind][0],mappings[p.kind][1],a);else{const t=taxParts(a,taxMode,taxRate);const cashAccount=mappings[p.kind][0],counter=mappings[p.kind][1];if(isSale)lines=[{project:p.project,account:cashAccount,debit:t.total,credit:0},{project:p.project,account:counter,debit:0,credit:t.base},...(t.tax?[{project:p.project,account:'tax_payable',debit:0,credit:t.tax}]:[])];else if(isPurchase)lines=[{project:p.project,account:counter,debit:t.base,credit:0},...(t.tax?[{project:p.project,account:'tax_receivable',debit:t.tax,credit:0}]:[]),{project:p.project,account:cashAccount,debit:0,credit:t.total}];else lines=pair(p.project,cashAccount,counter,a);}}if(p.kind==='distribution'){if(date(p.date)!==today())throw Error('توزيع الأرباح متاح بتاريخ اليوم لضمان فحص السيولة الحالية.');const entitlement=distributionEntitlement(w,pr);const f=forecast(w,p.project,pr.data.reserve,0,0,a);if(a>entitlement||f.min<pr.data.reserve)throw Error('السحب يتجاوز استحقاق المالك أو ينزل السيولة المتوقعة تحت الاحتياطي. راجع مركز القرار.');}if(['invest','dividend','returnCapital'].includes(p.kind)){find(p.investment,'project');if(find(p.investment).data.mode!=='investment')throw Error('اختر استثمارًا خارجيًا.');if(p.kind==='returnCapital'){const invested=w.journals.filter(j=>j.source?.startsWith('investment:'+p.investment+':')).flatMap(j=>j.lines).filter(l=>l.project===p.project&&l.account==='investment').reduce((s,l)=>s+l.debit-l.credit,0);if(a>invested)throw Error('الاسترداد يتجاوز رأس المال المسجل لهذا الاستثمار.');}}journal(p.kind,str(p.memo,500),date(p.date),lines,p.investment?'investment:'+p.investment+':'+id:null);description='تسجيل حركة مالية: '+p.memo;}
else if(action==='reverse'){const j=w.journals.find(x=>x.id===p.id);if(!j||j.reversal||j.source)throw Error('يمكن عكس القيود المباشرة فقط. القيود المرتبطة بالتزامات تحتاج تسوية مخصصة.');if(w.journals.some(x=>x.reversal===j.id))throw Error('تم عكس هذا القيد بالفعل.');journal('reversal','عكس: '+j.memo+' — '+str(p.reason,200),date(p.date),j.lines.map(l=>({...l,debit:l.credit,credit:l.debit})),null,j.id);description='عكس قيد مع الاحتفاظ بالأصل';}
else if(action==='obligation'){project(p.project);const a=cents(p.amount);if(!a)throw Error('أدخل مبلغًا أكبر من صفر.');const start=date(p.date),count=Math.trunc(num(p.count||1,1,365)),repeat=p.repeat||'once';if(!['once','daily','monthly','yearly'].includes(repeat))throw Error('تكرار غير صحيح.');if(!['in','out'].includes(p.direction))throw Error('حدد اتجاه الحركة.');const category=str(p.category);if(!accounts[category]||['cash','inter_receivable','inter_payable','loan','investment','distribution'].includes(category))throw Error('اختر حسابًا مقابلًا صالحًا.');for(let i=0;i<(repeat==='once'?1:count);i++){due({project:p.project,title:str(p.title),amount:a,date:repeat==='daily'?dayAdd(start,i):monthAdd(start,repeat==='yearly'?i*12:i),direction:p.direction,category,certainty:num(p.certainty??100,0,100)});}description='جدولة: '+p.title;}
else if(action==='settle'){const r=find(p.id,'obligation'),d=r.data;if(d.status!=='pending')throw Error('الاستحقاق تمت معالجته بالفعل.');const dt=date(p.date);let lines:Line[];if(d.loan){lines=[...(d.principal?[{project:d.project,account:'loan',debit:d.principal,credit:0}]:[]),...(d.interest?[{project:d.project,account:'interest',debit:d.interest,credit:0}]:[]),{project:d.project,account:'cash',debit:0,credit:d.amount}];}else lines=pair(d.project,d.direction==='in'?'cash':d.category,d.direction==='in'?d.category:'cash',d.amount);journal('settle',d.title,dt,lines,'obligation:'+r.id);update(r,{...d,status:'paid',paidOn:dt});description='تسوية استحقاق: '+d.title;}
else if(action==='cancelDue'){const r=find(p.id,'obligation');if(r.data.status!=='pending'||r.data.loan)throw Error('هذا الاستحقاق لا يمكن إلغاؤه من هنا.');update(r,{...r.data,status:'cancelled',reason:str(p.reason)});description='إلغاء استحقاق: '+r.data.title;}
else if(action==='dailyReport'){
 const pr=project(p.project),d=date(p.date);if(d>today())throw Error('التقرير اليومي لا يمكن أن يكون مستقبليًا.');
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
 const amount=halala(p.amount,'رأس مال الاستثمار');if(amount===0)throw Error('رأس مال الاستثمار يجب أن يكون أكبر من صفر.');const start=date(p.start||today()),maturity=date(p.maturity);if(maturity<start)throw Error('تاريخ نهاية الدورة يجب أن يكون بعد بدايتها.');
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
else if(action==='projectFunding'){const target=project(p.project);const amount=cents(p.amount);const dt=date(p.date||today());if(!amount)throw Error('أدخل مبلغ التمويل.');const source=['personal','project','external'].includes(p.sourceType)?p.sourceType:'personal';let lines:Line[];let sourceLabel='تمويل شخصي';if(source==='project'){if(!p.sourceProject||p.sourceProject===p.project)throw Error('اختر مشروعًا آخر كمصدر للتمويل.');project(p.sourceProject);lines=[...pair(p.sourceProject,'inter_receivable','cash',amount),...pair(p.project,'cash','inter_payable',amount)];sourceLabel='تمويل من مشروع آخر';}else if(source==='external'){lines=pair(p.project,'cash','payable',amount);sourceLabel='تمويل خارجي مستحق';}else{lines=pair(p.project,'cash','capital',amount);}const rid=put('projectFunding',{project:p.project,sourceType:source,sourceProject:source==='project'?p.sourceProject:'',amount,date:dt,memo:str(p.memo||sourceLabel,300)});journal('transfer',sourceLabel+' — '+target.data.name,dt,lines,'projectFunding:'+rid);description='تمويل '+target.data.name+' — '+sourceLabel;}
else if(action==='fundingRepayment'){
 const funding=w.records.find(x=>x.kind==='projectFunding'&&x.id===p.fundingId);
 if(!funding)throw Error('لم يتم العثور على عملية التمويل الأصلية.');
 const fd=funding.data as any;
 const recipient=project(fd.project),amount=cents(p.amount),dt=date(p.date||today());
 if(!amount)throw Error('أدخل مبلغ الاسترداد.');
 if(dt<date(fd.date))throw Error('تاريخ الاسترداد لا يمكن أن يسبق تاريخ التمويل.');
 const prior=w.records.filter(x=>x.kind==='fundingRepayment'&&x.data.fundingId===funding.id).reduce((s,x)=>s+Number(x.data.amount||0),0);
 const outstanding=Math.max(0,Number(fd.amount||0)-prior);
 if(amount>outstanding)throw Error('مبلغ الاسترداد يتجاوز رأس المال المتبقي لهذا التمويل.');
 let lines:Line[],memo='';
 if(fd.sourceType==='project'){
   const lender=project(fd.sourceProject);
   lines=[...pair(recipient.id,'inter_payable','cash',amount),...pair(lender.id,'cash','inter_receivable',amount)];
   memo='استرداد تمويل مشروع → مشروع';
 }else if(fd.sourceType==='external'){
   lines=pair(recipient.id,'payable','cash',amount);
   memo='استرداد تمويل خارجي';
 }else{
   lines=pair(recipient.id,'capital','cash',amount);
   memo='استرداد رأس مال المالك';
 }
 const rid=put('fundingRepayment',{fundingId:funding.id,project:recipient.id,sourceType:fd.sourceType,sourceProject:fd.sourceProject||'',amount,date:dt,memo:str(p.memo||memo,300)});
 journal('fundingRepayment',memo+' — '+recipient.data.name,dt,lines,'fundingRepayment:'+rid);
 description='استرداد مرتبط بالتمويل الأصلي: '+funding.id;
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
else if(action==='loan'){project(p.project);const amountExact=money5(p.amount,'أصل التمويل'),paymentExact=money5(p.monthlyPayment,'القسط الشهري'),start=date(p.start),first=date(p.firstDate),months=Math.trunc(num(p.months,1,360));if(first<start)throw Error('أول قسط يجب أن يكون بعد استلام التمويل.');if(paymentExact<=0)throw Error('أدخل القسط الشهري المحدد من البنك.');const annual=loanRateFromPaymentExact(amountExact,paymentExact,months);const schedule=loanScheduleFromPaymentExact(amountExact,paymentExact,months,first);const amount=Math.round(amountExact*100),payment=Math.round(paymentExact*100);const rid=put('loan',{project:p.project,name:str(p.name),principal:amount,principalExact:amountExact.toFixed(5),rate:annual,monthlyPayment:payment,monthlyPaymentExact:paymentExact.toFixed(5),months,start,firstDate:first,scheduleType:'estimate',fundingMode:p.fundingMode==='opening'?'opening':'new',rateMethod:'implied_from_bank_payment'});for(const [i,s]of schedule.entries())due({...s,project:p.project,title:'قسط '+p.name+' / '+(i+1),direction:'out',category:'loan',loan:rid,certainty:100});journal('loan',(p.fundingMode==='opening'?'رصيد تمويل افتتاحي: ':'استلام تمويل: ')+p.name,start,pair(p.project,p.fundingMode==='opening'?'capital':'cash','loan',amount),'loan:'+rid);description='إضافة تمويل وجدوله التقديري';}
else if(action==='replaceSchedule'){const r=find(p.id,'loan'),d=r.data;const pending=w.records.filter(x=>x.kind==='obligation'&&x.data.loan===r.id&&x.data.status==='pending');const remaining=pending.reduce((s,x)=>s+x.data.principal,0),prepay=cents(p.prepay||0),fee=cents(p.fee||0),dt=date(p.date);if(dt>today())throw Error('تاريخ الاعتماد لا يمكن أن يكون مستقبليًا.');if(prepay>remaining)throw Error('السداد أكبر من أصل الدين المتبقي.');const rows=(p.rows||'').trim()?str(p.rows,30000).split('\n').map((line:string)=>{const [dateStr,pr,it]=line.trim().split(',');return {date:date(dateStr),principal:cents(pr),interest:cents(it)};}):[];if(rows.length>360)throw Error('الحد الأقصى 360 قسطًا.');if(rows.some((s:any,i:number)=>s.date<dt||s.principal+s.interest<=0||(i>0&&s.date<=rows[i-1].date)))throw Error('تواريخ الأقساط يجب أن تكون متزايدة وبعد تاريخ التسوية.');if(rows.reduce((s:number,x:any)=>s+x.principal,0)!==remaining-prepay)throw Error('مجموع أصل الأقساط الجديدة لا يساوي الرصيد المتبقي بعد السداد.');update(r,{...d,scheduleType:'confirmed',revisedOn:dt});for(const o of pending)update(o,{...o.data,status:'replaced'});for(const [i,s]of rows.entries())due({...s,amount:s.principal+s.interest,project:d.project,title:'قسط '+d.name+' / '+(i+1),direction:'out',category:'loan',loan:r.id,certainty:100});if(prepay+fee>0){journal('prepay','سداد مبكر: '+d.name,dt,[...(prepay?[{project:d.project,account:'loan',debit:prepay,credit:0}]:[]),...(fee?[{project:d.project,account:'interest',debit:fee,credit:0}]:[]),{project:d.project,account:'cash',debit:0,credit:prepay+fee}],'prepay:'+id);}description='اعتماد جدول البنك وتسجيل السداد المبكر';}
else if(action==='risk'){if(p.project!=='all')find(p.project,'project');put('risk',{project:p.project,title:str(p.title),likelihood:num(p.likelihood,1,5),impact:num(p.impact,1,5),control:str(p.control,1000),responsible:str(p.responsible),reviewDate:date(p.reviewDate),status:'open'});description='إضافة خطر: '+p.title;}
else if(action==='resolveRisk'){const r=find(p.id,'risk');update(r,{...r.data,status:'resolved',resolution:str(p.resolution,500),resolvedOn:today()});description='توثيق معالجة خطر';}
else throw Error('عملية غير معروفة.');
// Bound JSON keeps SQL and parameter counts small even for a 360-month loan.
if(inserts.length)ops.push(db.prepare("INSERT INTO records(id,owner,kind,data,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.data'),? FROM json_each(?)").bind(owner,time,JSON.stringify(inserts)));
if(patches.size){
 ops.push(db.prepare("UPDATE records SET data=json_extract(patch.value,'$.data'),version=records.version+1 FROM json_each(?) AS patch WHERE records.id=json_extract(patch.value,'$.id') AND records.owner=? AND records.version=json_extract(patch.value,'$.version')").bind(JSON.stringify([...patches.values()]),owner));
 ops.push(db.prepare("SELECT json(CASE WHEN changes()=? THEN 'true' ELSE 'conflict' END)").bind(patches.size));
}
for(const [pid,version]of ledgerLocks){ops.push(db.prepare('UPDATE records SET version=version+1 WHERE id=? AND owner=? AND version=?').bind(pid,owner,version));ops.push(db.prepare("SELECT json(CASE WHEN changes()=1 THEN 'true' ELSE 'conflict' END)"));}
ops.push(db.prepare('INSERT INTO audit(id,owner,action,detail,created) VALUES(?,?,?,?,?)').bind(uid(),owner,action,req.headers.get('oai-authenticated-user-email')?description+' — '+req.headers.get('oai-authenticated-user-email'):description,time));ops.push(db.prepare('INSERT INTO commands(id,owner,created) VALUES(?,?,?)').bind(id,owner,time));try{await db.batch(ops);}catch(e:any){if(await db.prepare('SELECT id FROM commands WHERE id=? AND owner=?').bind(id,owner).first())return Response.json({ok:true,replayed:true});if(/UNIQUE|malformed JSON/.test(e.message))throw Error('تغيرت البيانات أو تم تسجيل العملية مسبقًا. حدث الصفحة.');throw e;}return Response.json({ok:true});
}catch(e:any){console.error('workspace operation:',e.message);return Response.json({error:e.message==='AUTH'?'سجل الدخول أولًا.':(/D1|SQLITE|syntax|no such/.test(e.message)?'تعذر حفظ العملية. لم يتم اعتمادها. حاول مجددًا.':e.message||'تعذر حفظ العملية.')},{status:e.message==='AUTH'?401:400});}}
