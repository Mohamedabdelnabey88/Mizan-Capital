'use client';
import {ArrowDownLeft,ArrowUpRight,Check} from 'lucide-react';
import {scheduleCalendarDays} from '@/lib/schedule-calendar';
import {calendarValueLabel} from '@/lib/calendar-date';
import {today,type RecordItem} from '@/lib/finance';

const amount=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n/100);
export function ScheduleCalendar({month,items,status,selected,onSelect}:{month:string;items:RecordItem[];status:string;selected:string;onSelect:(date:string)=>void}){
 const days=scheduleCalendarDays(month,items,status),current=today();
 return <section className="schedule-calendar" aria-label={'تقويم استحقاقات '+calendarValueLabel(month,'month')}>
  <div className="schedule-calendar-legend"><span><i className="incoming"/>تحصيل</span><span><i className="outgoing"/>سداد</span><span><Check size={13}/>المنفذ من المواعيد</span><small>اضغط اليوم لعرض كل عملياته أسفل التقويم · المبالغ بالريال</small></div>
  <p className="schedule-calendar-mobile-hint">اسحب التقويم أفقيًا لعرض باقي أيام الأسبوع.</p><div className="schedule-calendar-scroll"><div className="schedule-calendar-grid"><div className="schedule-calendar-week">{['السبت','الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'].map(day=><span className="schedule-calendar-weekday" key={day}>{day}</span>)}</div>{Array.from({length:6},(_,week)=><div className="schedule-calendar-week" key={week}>{days.slice(week*7,week*7+7).map(day=><button type="button" key={day.date} disabled={!day.inside} aria-pressed={selected===day.date} aria-label={calendarValueLabel(day.date)+' · '+day.items.length+' موعد · تحصيل '+amount(day.incoming)+' ريال · سداد '+amount(day.outgoing)+' ريال'} className={'schedule-calendar-day '+(!day.inside?'outside ':'')+(day.weekend?'weekend ':'')+(day.date===current?'today ':'')+(selected===day.date?'selected':'')} onClick={()=>onSelect(selected===day.date?'':day.date)}><span className="schedule-calendar-day-top"><b>{day.day}</b>{day.date===current&&<small>اليوم</small>}{day.items.length>0&&<em>{day.items.length}</em>}</span>{day.items.length>0?<><span className="schedule-calendar-day-totals">{day.incoming>0&&<span className="incoming"><ArrowDownLeft size={13}/><span>تحصيل</span><strong dir="ltr">{amount(day.incoming)}</strong></span>}{day.outgoing>0&&<span className="outgoing"><ArrowUpRight size={13}/><span>سداد</span><strong dir="ltr">{amount(day.outgoing)}</strong></span>}</span><span className="schedule-calendar-day-foot">{day.paid>0?<><Check size={12}/>{day.paid} منفّذ{day.paid<day.items.length?' · '+(day.items.length-day.paid)+' معلّق':''}</>:day.items.length+' موعد معلّق'}</span></>:day.inside?<span className="schedule-calendar-day-empty">—</span>:null}</button>)}</div>)}</div></div>
 </section>;
}
