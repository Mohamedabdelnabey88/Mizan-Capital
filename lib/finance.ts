export type RecordItem={id:string;kind:string;data:any;version:number};
export type Line={project:string;account:string;debit:number;credit:number};
export type Journal={id:string;date:string;memo:string;kind:string;lines:Line[];source?:string;reversal?:string;created?:string};
export type Workspace={records:RecordItem[];journals:Journal[];audit:any[]};
export const accounts:Record<string,{name:string;type:string}>={cash:{name:'الصندوق / كاش',type:'asset'},bank:{name:'الحساب البنكي',type:'asset'},mada:{name:'مستحقات مدى',type:'asset'},visa:{name:'مستحقات Visa',type:'asset'},mastercard:{name:'مستحقات Mastercard',type:'asset'},receivable:{name:'الذمم المدينة / آجل',type:'asset'},inventory:{name:'المخزون',type:'asset'},fixed:{name:'الأصول الثابتة',type:'asset'},investment:{name:'استثمارات قيد التشغيل',type:'asset'},inter_receivable:{name:'تمويل مستحق من مشروع',type:'asset'},accumulated:{name:'مجمع الإهلاك',type:'contra'},payable:{name:'الموردون والمستحقات',type:'liability'},loan:{name:'أصل التمويل',type:'liability'},inter_payable:{name:'تمويل مستحق لمشروع',type:'liability'},tax_payable:{name:'ضريبة مستحقة',type:'liability'},capital:{name:'رأس المال / أرصدة افتتاحية',type:'equity'},retained:{name:'أرباح سابقة',type:'equity'},distribution:{name:'توزيعات الملاك',type:'distribution'},revenue:{name:'إيرادات التشغيل',type:'income'},dividend:{name:'عوائد استثمارات',type:'income'},expense:{name:'مصروفات التشغيل',type:'expense'},salary:{name:'الرواتب',type:'expense'},interest:{name:'تكلفة التمويل',type:'expense'},cogs:{name:'تكلفة المبيعات',type:'expense'},depreciation:{name:'مصروف الإهلاك',type:'expense'},tax_expense:{name:'مصروف ضريبة / زكاة',type:'expense'}};
export const kinds:Record<string,string>={income:'إيراد محصّل',invoice:'إيراد آجل',collect:'تحصيل ذمة',expense:'مصروف مدفوع',bill:'مصروف مستحق',paybill:'سداد مستحقات',capital:'إيداع رأس مال',asset:'شراء أصل',inventory:'شراء مخزون',cogs:'تكلفة بضاعة مباعة',depreciation:'إهلاك أصل',invest:'ضخ استثمار',dividend:'عائد استثمار',returnCapital:'استرداد رأس مال استثمار',distribution:'توزيع أرباح',transfer:'تمويل بين مشروعين',repayTransfer:'رد تمويل إلى مشروع',investmentStart:'بدء دورة استثمار داخلية',investmentReturn:'استرداد دورة استثمار داخلية',dailyReport:'اعتماد تقرير يومي',cardSettlement:'تسوية مستحقات بطاقات',annualOwnerDistribution:'توزيع مالك سنوي',manual:'قيد محاسبي',reversal:'قيد عكسي',loan:'استلام تمويل',settle:'سداد التزام',prepay:'سداد مبكر'};
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function dayAdd(s:string,n:number){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function monthAdd(s:string,n:number){const d=new Date(s+'T12:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
export function cents(v:unknown){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1000000000)throw Error('أدخل مبلغًا صحيحًا بين صفر ومليار ريال.');return Math.round(n*100);}
export function validateLines(lines:Line[]){if(lines.length<2||lines.length>100)throw Error('القيد يحتاج طرفين على الأقل.');let debit=0,credit=0;for(const l of lines){if(!accounts[l.account]||!l.project||!Number.isSafeInteger(l.debit)||!Number.isSafeInteger(l.credit)||l.debit<0||l.credit<0||(!l.debit&&!l.credit)||(l.debit&&l.credit))throw Error('طرف محاسبي غير صحيح.');debit+=l.debit;credit+=l.credit;}if(debit!==credit||!debit)throw Error('القيد غير متوازن.');}
export const PAYMENT_ACCOUNTS=['cash','bank','mada','visa','mastercard','receivable'] as const;
export type PaymentAccount=typeof PAYMENT_ACCOUNTS[number];
export const paymentAccountNames:Record<PaymentAccount,string>={cash:'كاش',bank:'حساب بنكي',mada:'مدى',visa:'Visa',mastercard:'Mastercard',receivable:'آجل'};
export function sumAmounts(values:number[]){return values.reduce((s,v)=>s+v,0);}
export function assertHalalaAmount(v:unknown){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('المبلغ يجب أن يكون بالهللة وبقيمة صحيحة أكبر من صفر.');return n;}
export function liquidity(w:Workspace,project='all',end=today()){
 const b=balance(w,project,end);
 return (b.cash||0)+(b.bank||0)+(b.mada||0)+(b.visa||0)+(b.mastercard||0);
}
export function cardReceivables(w:Workspace,project='all',end=today()){
 const b=balance(w,project,end);
 return (b.mada||0)+(b.visa||0)+(b.mastercard||0);
}
export type FiscalYear={id?:string;start:string;end:string;label?:string};
export function fiscalYearForDate(w:Workspace,at=today()):FiscalYear{
 const rows=w.records.filter(r=>r.kind==='fiscalYear'&&String(r.data.start)<=at&&String(r.data.end)>=at).sort((a,b)=>String(a.data.start).localeCompare(String(b.data.start)));
 const row=rows.at(-1);
 if(row)return {id:row.id,start:String(row.data.start),end:String(row.data.end),label:String(row.data.label||'')};
 const y=Number(at.slice(0,4));return {start:y+'-01-01',end:y+'-12-31',label:'السنة الميلادية '+y};
}
export function fiscalYearForStart(w:Workspace,startYear:number):FiscalYear{
 const rows=w.records.filter(r=>r.kind==='fiscalYear'&&String(r.data.start).slice(0,4)===String(startYear)).sort((a,b)=>String(a.data.start).localeCompare(String(b.data.start)));
 const row=rows.at(-1);if(row)return {id:row.id,start:String(row.data.start),end:String(row.data.end),label:String(row.data.label||'')};
 return {start:startYear+'-01-01',end:startYear+'-12-31',label:'السنة الميلادية '+startYear};
}
export function yearlyProfit(w:Workspace,year:number,project='all'){
 const fy=fiscalYearForStart(w,year);return profit(w,project,fy.start,fy.end).net;
}
export function allocationTotal(a:Record<string,unknown>){
 return Object.values(a).reduce<number>((s,v)=>s+Number(v||0),0);
}
export function balance(w:Workspace,project='all',end=today()){const a:Record<string,number>={};for(const j of w.journals){if(j.date>end)continue;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;a[l.account]=(a[l.account]||0)+l.debit-l.credit;}}return a;}
export function profit(w:Workspace,project='all',start=today().slice(0,4)+'-01-01',end=today()){let revenue=0,expense=0;for(const j of w.journals){if(j.date<start||j.date>end)continue;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;if(accounts[l.account]?.type==='income')revenue+=l.credit-l.debit;if(accounts[l.account]?.type==='expense')expense+=l.debit-l.credit;}}return {revenue,expense,net:revenue-expense};}
export type AccountingTrace={transactionId:string;date:string;kind:string;memo:string;lines:Line[];ledgerDelta:Record<string,number>;cashDelta:number;profitDelta:number;project:string;};
export function traceTransaction(w:Workspace,transactionId:string):AccountingTrace|undefined{
 const j=w.journals.find(x=>x.id===transactionId||x.source===transactionId);
 if(!j)return;
 const ledgerDelta:Record<string,number>={};let cashDelta=0,profitDelta=0,project='all';
 for(const l of j.lines){ledgerDelta[l.account]=(ledgerDelta[l.account]||0)+l.debit-l.credit;if(l.account==='cash'||l.account==='bank')cashDelta+=l.debit-l.credit;if(accounts[l.account]?.type==='income')profitDelta+=l.credit-l.debit;if(accounts[l.account]?.type==='expense')profitDelta-=l.debit-l.credit;if(project==='all'&&l.project)project=l.project;}
 return {transactionId,date:j.date,kind:j.kind,memo:j.memo,lines:j.lines,ledgerDelta,cashDelta,profitDelta,project};
}
export function accountingControlTotals(w:Workspace,start='0000-01-01',end=today(),project='all'){
 let debit=0,credit=0,cash=0,profitDelta=0;
 for(const j of w.journals){if(j.date<start||j.date>end)continue;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;debit+=l.debit;credit+=l.credit;if(l.account==='cash'||l.account==='bank')cash+=l.debit-l.credit;if(accounts[l.account]?.type==='income')profitDelta+=l.credit-l.debit;if(accounts[l.account]?.type==='expense')profitDelta-=l.debit-l.credit;}}
 const cf=actualCashFlow(w,project,start,end);const b=balance(w,project,end);const balanceCheck=debit-credit;const cashFromBalance=(b.cash||0)+(b.bank||0);return {debit,credit,balanceCheck,cash,cashFromBalance,cashFlowClosing:cf.closing,profitDelta,profitNet:profit(w,project,start,end).net,cashFlowDifference:cf.closing-cashFromBalance};
}

export function loanRateFromPaymentExact(principalSar:number,paymentSar:number,months:number){if(!Number.isFinite(principalSar)||!Number.isFinite(paymentSar)||principalSar<=0||paymentSar<=0||!Number.isInteger(months)||months<1||months>360)throw Error('راجع أصل التمويل والقسط وعدد الأشهر.');if(paymentSar*months<principalSar)throw Error('إجمالي الأقساط أقل من أصل التمويل؛ لا يمكن استنتاج تكلفة تمويل موجبة.');if(Math.abs(paymentSar*months-principalSar)<0.000000001)return 0;let lo=0,hi=1;const f=(r:number)=>paymentSar*(1-Math.pow(1+r,-months))/r-principalSar;while(f(hi)>0&&hi<100)hi*=2;for(let i=0;i<120;i++){const mid=(lo+hi)/2;if(f(mid)>0)lo=mid;else hi=mid;}return ((lo+hi)/2)*12*100;}
export function loanScheduleFromPaymentExact(principalSar:number,paymentSar:number,months:number,first:string){const annual=loanRateFromPaymentExact(principalSar,paymentSar,months),r=annual/1200;let rest=principalSar;return Array.from({length:months},(_,i)=>{const interest=Math.round(rest*r*100),principalPart=i===months-1?Math.round(rest*100):Math.min(Math.round(rest*100),Math.max(0,Math.round(paymentSar*100)-interest));const amount=principalPart+interest;rest=Math.max(0,rest-principalPart/100);return {date:monthAdd(first,i),principal:principalPart,interest,amount};});}

export function loanRateFromPayment(principal:number,payment:number,months:number){
 if(principal<=0||payment<=0||!Number.isInteger(months)||months<1||months>360)throw Error('راجع أصل التمويل والقسط وعدد الأشهر.');
 if(payment*months<principal)throw Error('إجمالي الأقساط أقل من أصل التمويل؛ لا يمكن استنتاج تكلفة تمويل موجبة.');
 if(payment*months===principal)return 0;
 const pv=principal/100,emi=payment/100;
 let lo=0,hi=1;
 const f=(r:number)=>emi*(1-Math.pow(1+r,-months))/r-pv;
 while(f(hi)>0&&hi<100)hi*=2;
 for(let i=0;i<100;i++){const mid=(lo+hi)/2;if(f(mid)>0)lo=mid;else hi=mid;}
 return ((lo+hi)/2)*12*100;
}
export function loanScheduleFromPayment(principal:number,payment:number,months:number,first:string){
 const annual=loanRateFromPayment(principal,payment,months),r=annual/1200;let rest=principal;
 return Array.from({length:months},(_,i)=>{
  const interest=Math.round((rest/100)*r*100), principalPart=i===months-1?rest:Math.min(rest,Math.max(0,payment-interest));
  const amount=principalPart+interest;rest-=principalPart;
  return {date:monthAdd(first,i),principal:principalPart,interest,amount};
 });
}

export function loanSchedule(principal:number,annual:number,months:number,first:string){if(principal<=0||!Number.isInteger(months)||months<1||months>360||principal<months||annual<0||annual>100)throw Error('راجع مبلغ التمويل والنسبة وعدد الأشهر.');const r=annual/1200;const payment=r?Math.round(principal*r/(1-Math.pow(1+r,-months))):Math.round(principal/months);let rest=principal;return Array.from({length:months},(_,i)=>{const interest=Math.round(rest*r);let p=i===months-1?rest:Math.min(rest,Math.max(0,payment-interest));rest-=p;return {date:monthAdd(first,i),principal:p,interest,amount:p+interest};});}
// Daily cash ordering is deliberately conservative: payments precede collections
// on the same date because the bank's actual settlement times are not known.
export function forecast(w:Workspace,project='all',reserve=0,shock=0,delay=0,outlay=0){
 const now=today(), opening=(balance(w,project).cash||0)-Math.round(outlay);
 const days=Array.from({length:91},(_,i)=>({date:dayAdd(now,i),income:0,out:0,cash:0,min:0}));
 const byDate=new Map(days.map(d=>[d.date,d]));
 for(const r of w.records){
  const d=r.data;
  if(r.kind!=='obligation'||d.status!=='pending'||(project!=='all'&&d.project!==project))continue;
  const effective=d.direction==='in'?dayAdd(d.date,delay):d.date;
  const point=byDate.get(effective<now?now:effective);if(!point)continue;
  if(d.direction==='in')point.income+=Math.round(d.amount*(1-shock/100));else point.out+=d.amount;
 }
 let cash=opening,min=opening,firstGap:string|undefined=opening<reserve?now:undefined;
 for(const d of days){d.min=cash-d.out;cash=d.min+d.income;d.cash=cash;min=Math.min(min,d.min);if(!firstGap&&d.min<reserve)firstGap=d.date;}
 const buckets=Array.from({length:13},(_,i)=>{const week=days.slice(i*7,i*7+7);return {date:week[0].date,income:week.reduce((s,d)=>s+d.income,0),out:week.reduce((s,d)=>s+d.out,0),cash:week[6].cash,min:Math.min(...week.map(d=>d.min))};});
 return {days,buckets,min,ending:cash,shortfall:Math.max(0,reserve-min),firstGap};
}
export type ProjectFunding={id:string;project:string;sourceType:'personal'|'project'|'external';sourceProject?:string;amount:number;date:string;memo?:string};
export type FundingSummary=ProjectFunding&{repaid:number;outstanding:number;recoveryPct:number};
export function projectFundingSummaries(w:Workspace,project='all',end=today()):FundingSummary[]{
 const fundings=w.records.filter(r=>r.kind==='projectFunding'&&r.data.status!=='cancelled'&&String(r.data.date)<=end&&(project==='all'||r.data.project===project||r.data.sourceProject===project));
 return fundings.map(r=>{
  const d=r.data as ProjectFunding;
  const repaid=w.records.filter(x=>x.kind==='fundingRepayment'&&x.data.fundingId===r.id&&String(x.data.date)<=end).reduce((s,x)=>s+Number(x.data.amount||0),0);
  const original=Number(d.amount||0);
  const paid=Math.min(original,Math.max(0,repaid));
  return {...d,repaid:paid,outstanding:Math.max(0,original-paid),recoveryPct:original?paid*100/original:0};
 });
}
export function internalFunding(w:Workspace,lender:string,borrower:string,end=today()){
 let funded=0,repaid=0;
 for(const j of w.journals){
  if(j.date>end)continue;
  const lenderReceivable=j.lines.find(l=>l.project===lender&&l.account==='inter_receivable');
  const borrowerPayable=j.lines.find(l=>l.project===borrower&&l.account==='inter_payable');
  const borrowerReceivable=j.lines.find(l=>l.project===borrower&&l.account==='inter_receivable');
  const lenderPayable=j.lines.find(l=>l.project===lender&&l.account==='inter_payable');
  if(lenderReceivable&&borrowerPayable) funded+=Math.max(0,lenderReceivable.debit-lenderReceivable.credit);
  if(borrowerReceivable&&lenderPayable) repaid+=Math.max(0,borrowerReceivable.credit-borrowerReceivable.debit);
 }
 return Math.max(0,funded-repaid);
}
export type CashFlowRow={date:string;operatingIn:number;operatingOut:number;investingIn:number;investingOut:number;financingIn:number;financingOut:number;transferIn:number;transferOut:number;otherIn:number;otherOut:number;net:number;};
export function actualCashFlow(w:Workspace,project='all',start='0000-01-01',end=today()){
 const openingDate= start==='0000-01-01'?'0000-01-01':dayAdd(start,-1);
 const openingBalance=balance(w,project,openingDate);
 const opening=(openingBalance.cash||0)+(openingBalance.bank||0);
 const rows=new Map<string,CashFlowRow>();
 const get=(date:string)=>{let r=rows.get(date);if(!r){r={date,operatingIn:0,operatingOut:0,investingIn:0,investingOut:0,financingIn:0,financingOut:0,transferIn:0,transferOut:0,otherIn:0,otherOut:0,net:0};rows.set(date,r);}return r;};
 const category=(j:{kind:string;memo:string})=>{
  const kind=j.kind;
  if(['income','collect','dailyReport','cardSettlement','expense','paybill','cogs','inventory','salary'].includes(kind))return 'operating';
  if(['asset','invest','dividend','returnCapital','investmentStart','investmentReturn'].includes(kind))return 'investing';
  if(['capital','loan','settle','prepay','distribution','annualOwnerDistribution'].includes(kind))return 'financing';
  if(['transfer','repayTransfer','fundingRepayment'].includes(kind)){
   if(kind==='transfer'&&/تمويل شخصي|تمويل خارجي مستحق/.test(j.memo))return 'financing';
   if(kind==='fundingRepayment')return /تمويل من مشروع آخر/.test(j.memo)?'transfer':'financing';
   return 'transfer';
  }
  return 'other';
 };
 for(const j of w.journals){if(j.date<start||j.date>end)continue;const interestOut=(j.kind==='settle'||j.kind==='prepay')?j.lines.filter(l=>l.account==='interest').reduce((s,l)=>s+l.debit-l.credit,0):0;const principalOut=(j.kind==='settle'||j.kind==='prepay')?j.lines.filter(l=>l.account==='loan').reduce((s,l)=>s+l.debit-l.credit,0):0;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;if(l.account!=='cash'&&l.account!=='bank')continue;const r=get(j.date),cat=category(j),inflow=l.debit,outflow=l.credit;if(j.kind==='settle'||j.kind==='prepay'){if(outflow){r.operatingOut+=Math.min(outflow,Math.max(0,interestOut));r.financingOut+=Math.max(0,outflow-Math.min(outflow,Math.max(0,interestOut)));}else if(inflow){r.financingIn+=inflow;}}else{if(inflow){(r as any)[cat+'In']+=inflow;}if(outflow){(r as any)[cat+'Out']+=outflow;}}r.net+=inflow-outflow;}}
 const days=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
 let running=opening;for(const r of days){running+=r.net;}
 return {opening,rows:days,net:running-opening,closing:running};
}
export function investmentFundingReport(w:Workspace,project='all',start='0000-01-01',end=today()){
 const investments=w.records.filter(r=>r.kind==='investmentCycle'&&String(r.data.start)<=end&&String(r.data.maturity||r.data.start)>=start&&(project==='all'||r.data.lender===project||r.data.borrower===project)).map(r=>{const d=r.data;return {id:r.id,start:d.start,maturity:d.maturity,lender:d.lender,borrower:d.borrower,principal:Number(d.principal||0),expectedReturn:Number(d.expectedReturn||0),actualReturn:Number(d.actualReturn||0),status:d.status||'active'};});
 const map=new Map<string,{lender:string;borrower:string;funded:number;repaid:number;outstanding:number}>();
 for(const j of w.journals){if(j.date>end||!['transfer','repayTransfer'].includes(j.kind))continue;const receivable=j.lines.find(l=>l.account==='inter_receivable');const payable=j.lines.find(l=>l.account==='inter_payable');if(!receivable||!payable)continue;const lender=j.kind==='transfer'?receivable.project:payable.project,borrower=j.kind==='transfer'?payable.project:receivable.project;if(project!=='all'&&lender!==project&&borrower!==project)continue;const amount=Math.max(receivable.debit-receivable.credit,payable.credit-payable.debit);if(amount<=0)continue;const key=lender+'|'+borrower;const row=map.get(key)||{lender,borrower,funded:0,repaid:0,outstanding:0};if(j.kind==='transfer')row.funded+=amount;else row.repaid+=amount;row.outstanding=row.funded-row.repaid;map.set(key,row);}
 const funding=[...map.values()].filter(r=>r.funded!==0||r.repaid!==0).map(r=>({...r,outstanding:Math.max(0,r.outstanding)}));
 return {investments,funding,activeInvestment:investments.filter(r=>r.status==='active').reduce((s,r)=>s+r.principal,0),expectedReturn:investments.reduce((s,r)=>s+r.expectedReturn,0),actualReturn:investments.filter(r=>r.status!=='active').reduce((s,r)=>s+r.actualReturn,0),fundingOutstanding:funding.reduce((s,r)=>s+r.outstanding,0)};
}
export function annualOwnerReport(w:Workspace,year:number){
 const fy=fiscalYearForStart(w,year),fyEnd=fy.end;
 const projects=w.records.filter(r=>r.kind==='project'&&r.data.mode==='operating');
 const policies=w.records.filter(r=>r.kind==='ownerPolicy'&&String(r.data.effectiveFrom||'')<=fyEnd).sort((a,b)=>String(a.data.effectiveFrom||'').localeCompare(String(b.data.effectiveFrom||'')));
 const policy=policies.at(-1);const percentBps=Number(policy?.data.percentBps||0);
 const rows=projects.map(p=>({project:p.id,name:p.data.name,ownership:Number(p.data.ownership||0),profit:profit(w,p.id,fy.start,fy.end).net}));
 const totalProfit=rows.reduce((s,r)=>s+r.profit,0),ownerShare=Math.floor(totalProfit*percentBps/10000);
 const settlement=w.records.find(r=>r.kind==='ownerSettlement'&&(String(r.data.fiscalYearStart||'')===fy.start||(!r.data.fiscalYearStart&&Number(r.data.year)===year)));
 return {year,fyStart:fy.start,fyEnd:fy.end,fiscalYearId:fy.id||'',fiscalLabel:fy.label||'',percentBps,policyDate:policy?.data.effectiveFrom||'',rows,totalProfit,ownerShare,paid:Number(settlement?.data.totalOwner||0),settlementDate:settlement?.data.paidOn||'',status:settlement?'paid':'pending',remaining:Math.max(0,ownerShare-Number(settlement?.data.totalOwner||0))};
}
export function distributionEntitlement(w:Workspace,project:RecordItem){
 const b=balance(w,project.id),net=profit(w,project.id,'0000-01-01').net;
 return Math.max(0,Math.floor((net-(b.retained||0))*project.data.ownership/100*project.data.payout/100)-(b.distribution||0));
}
export function firstAffordableDate(f:ReturnType<typeof forecast>,amount:number,reserve:number){
 let futureMinimum=Infinity;let candidate:string|undefined;
 for(let i=f.days.length-1;i>=0;i--){const d=f.days[i];futureMinimum=Math.min(futureMinimum,d.cash);if(futureMinimum-amount>=reserve)candidate=d.date;futureMinimum=Math.min(futureMinimum,d.min);}
 return candidate;
}
