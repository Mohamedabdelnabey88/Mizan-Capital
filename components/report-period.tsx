'use client';
import {DateInput} from '@/components/date-input';
import {useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {monthPeriod,shiftReportPeriod,validReportDate,type ReportPeriod} from '@/lib/report-period';

function ReportPeriodEditor({start,end,currentDate,fiscalYear,onChange,description,savedPeriods=[]}:{savedPeriods?:Array<ReportPeriod&{label:string}>;start:string;end:string;currentDate:string;fiscalYear:ReportPeriod;onChange:(period:ReportPeriod)=>void;description:string}){
 const [draftStart,setDraftStart]=useState(start),[draftEnd,setDraftEnd]=useState(end),[error,setError]=useState('');
 const apply=(period:ReportPeriod)=>{setDraftStart(period.start);setDraftEnd(period.end);setError('');onChange(period);};
 const current=monthPeriod(currentDate.slice(0,7));
 const lastDate=new Date(current.start+'T12:00:00Z');lastDate.setUTCDate(0);
 const previous=monthPeriod(lastDate.toISOString().slice(0,7));
 const presets=[['الشهر الحالي',current],['الشهر السابق',previous],['السنة الحالية',{start:currentDate.slice(0,4)+'-01-01',end:currentDate.slice(0,4)+'-12-31'}],['السنة المالية',fiscalYear]] as const;
 return <section className="report-period-control" aria-label="فترة الصفحة">
  <div className="report-period-heading"><span><CalendarDays size={18}/> الفترة المعروضة</span><output aria-live="polite" dir="ltr">{start} — {end}</output></div>
  {savedPeriods.length>0&&<label className="saved-period-picker">الفترات المحفوظة<select aria-label="اختيار فترة مالية محفوظة" value={savedPeriods.findIndex(period=>period.start===start&&period.end===end)} onChange={e=>{const period=savedPeriods[Number(e.target.value)];if(period)apply(period);}}><option value={-1}>فترة مخصصة</option>{savedPeriods.map((period,index)=><option value={index} key={period.start+period.end}>{period.label}</option>)}</select></label>}<div className="report-period-inputs"><button type="button" className="icon-button" aria-label="الفترة السابقة" onClick={()=>apply(shiftReportPeriod({start,end},-1))}><ChevronRight size={18}/></button>
   <label>من<DateInput aria-label="بداية فترة التقرير" type="date" value={draftStart} onChange={e=>setDraftStart(e.target.value)}/></label>
   <label>إلى<DateInput aria-label="نهاية فترة التقرير" type="date" value={draftEnd} onChange={e=>setDraftEnd(e.target.value)}/></label>
   <button type="button" className="btn primary" onClick={()=>{if(!validReportDate(draftStart)||!validReportDate(draftEnd)||draftStart>draftEnd){setError('اختر تاريخين صحيحين؛ نهاية الفترة يجب ألا تسبق بدايتها.');return;}apply({start:draftStart,end:draftEnd});}}>تطبيق الفترة</button>
   <button type="button" className="icon-button" aria-label="الفترة التالية" onClick={()=>apply(shiftReportPeriod({start,end},1))}><ChevronLeft size={18}/></button>
  </div>
  <div className="period-quick-actions" role="group" aria-label="اختصارات فترة التقارير">{presets.map(([label,period])=><button type="button" key={label} aria-pressed={start===period.start&&end===period.end} onClick={()=>apply(period)}>{label}</button>)}</div>
  {error&&<p className="form-error" role="alert">{error}</p>}<p className="filter-caption">{description}</p>
 </section>;
}

export function ReportPeriodControl(props:Parameters<typeof ReportPeriodEditor>[0]){return <ReportPeriodEditor key={props.start+'|'+props.end} {...props}/>;}
