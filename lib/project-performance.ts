import type {Workspace} from '@/lib/finance';
import {dayAdd} from '@/lib/finance';

export type ProjectPlanMetrics={
  projectId:string;start:string;end:string;
  expectedRevenueMicro:number;expectedExpenseMicro:number;expectedNetMicro:number;
  actualRevenueMicro:number;actualExpenseMicro:number;actualNetMicro:number;
  varianceRevenueMicro:number;varianceNetMicro:number;attainmentPct:number;
  reportedDays:number;unreportedDays:number;forecastRevenueMicro:number;forecastNetMicro:number;
  days:Array<{date:string;expectedRevenueMicro:number;expectedExpenseMicro:number;expectedNetMicro:number;actualRevenueMicro:number;actualExpenseMicro:number;actualNetMicro:number;varianceMicro:number;reported:boolean;status:string}>;
};
const daysInMonth=(s:string)=>new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0)).getUTCDate();

export function projectPlans(w:Workspace,projectId:string){
  return w.records.filter(r=>r.kind==='projectPlan'&&r.data.project===projectId)
    .sort((a,b)=>String(a.data.effectiveFrom).localeCompare(String(b.data.effectiveFrom))||String((a as any).created||'').localeCompare(String((b as any).created||'')))
    .map(r=>r.data);
}

export function projectPerformance(w:Workspace,projectId:string,start:string,end:string):ProjectPlanMetrics{
  const project=w.records.find(r=>r.kind==='project'&&r.id===projectId);
  const plans=projectPlans(w,projectId);
  const fallbackNet=Number(project?.data.expectedNetMonthly||0)*1000;
  const days:ProjectPlanMetrics['days']=[];
  for(let d=start;d<=end;d=dayAdd(d,1)){
    let plan:any=plans[0]||null;
    for(const p of plans){if(String(p.effectiveFrom)<=d)plan=p;else break;}
    const dim=daysInMonth(d);
    const expectedRevenue=plan?(Number(plan.revenueDailyMicro||0)||Math.round(Number(plan.revenueMonthlyMicro||0)/dim)):0;
    const expectedExpense=plan?(Number(plan.expenseDailyMicro||0)||Math.round(Number(plan.expenseMonthlyMicro||0)/dim)):0;
    const expectedNet=plan?(Number(plan.netDailyMicro||0)||((Number(plan.revenueDailyMicro||0)||Math.round(Number(plan.revenueMonthlyMicro||0)/dim))-(Number(plan.expenseDailyMicro||0)||Math.round(Number(plan.expenseMonthlyMicro||0)/dim)))):Math.round(fallbackNet/dim);
    const rows=w.records.filter(r=>r.kind==='dailyReport'&&r.data.project===projectId&&r.data.date===d&&r.data.status==='approved'&&!r.data.correctedBy);
    const actualRevenue=rows.reduce((s,r)=>s+Number(r.data.gross||0)*1000,0);
    const reported=rows.length>0;
    days.push({date:d,expectedRevenueMicro:expectedRevenue,expectedExpenseMicro:expectedExpense,expectedNetMicro:expectedNet,actualRevenueMicro:actualRevenue,actualExpenseMicro:0,actualNetMicro:actualRevenue,varianceMicro:actualRevenue-expectedRevenue,reported,status:reported?'approved':'unreported'});
  }
  const sum=(k:keyof ProjectPlanMetrics['days'][number])=>days.reduce((s,d)=>s+Number(d[k]||0),0);
  const expectedRevenueMicro=sum('expectedRevenueMicro'),expectedExpenseMicro=sum('expectedExpenseMicro'),expectedNetMicro=sum('expectedNetMicro');
  const actualRevenueMicro=sum('actualRevenueMicro'),actualExpenseMicro=sum('actualExpenseMicro'),actualNetMicro=actualRevenueMicro-actualExpenseMicro;
  const reportedDays=days.filter(d=>d.reported).length,unreportedDays=days.length-reportedDays;
  const forecastRevenueMicro=reportedDays?Math.round(actualRevenueMicro/days.length*days.length/reportedDays):0;
  const forecastNetMicro=forecastRevenueMicro-expectedExpenseMicro;
  return {projectId,start,end,expectedRevenueMicro,expectedExpenseMicro,expectedNetMicro,actualRevenueMicro,actualExpenseMicro,actualNetMicro,varianceRevenueMicro:actualRevenueMicro-expectedRevenueMicro,varianceNetMicro:actualNetMicro-expectedNetMicro,attainmentPct:expectedRevenueMicro?actualRevenueMicro/expectedRevenueMicro*100:0,reportedDays,unreportedDays,forecastRevenueMicro,forecastNetMicro,days};
}
