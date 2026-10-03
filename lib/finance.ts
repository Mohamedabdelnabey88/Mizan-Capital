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
export function yearlyProfit(w:Workspace,year:number,project='all'){
 return profit(w,project,year+'-01-01',year+'-12-31').net;
}
export function allocationTotal(a:Record<string,unknown>){
 return Object.values(a).reduce((s,v)=>s+Number(v||0),0);
}
export function balance(w:Workspace,project='all',end=today()){const a:Record<string,number>={};for(const j of w.journals){if(j.date>end)continue;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;a[l.account]=(a[l.account]||0)+l.debit-l.credit;}}return a;}
export function profit(w:Workspace,project='all',start=today().slice(0,4)+'-01-01',end=today()){let revenue=0,expense=0;for(const j of w.journals){if(j.date<start||j.date>end)continue;for(const l of j.lines){if(project!=='all'&&l.project!==project)continue;if(accounts[l.account]?.type==='income')revenue+=l.credit-l.debit;if(accounts[l.account]?.type==='expense')expense+=l.debit-l.credit;}}return {revenue,expense,net:revenue-expense};}
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
export function internalFunding(w:Workspace,lender:string,borrower:string,end=today()){
 return w.journals.filter(j=>j.date<=end&&j.lines.some(l=>l.project===borrower&&l.account==='inter_payable'))
  .flatMap(j=>j.lines).filter(l=>l.project===lender&&l.account==='inter_receivable')
  .reduce((sum,l)=>sum+l.debit-l.credit,0);
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
