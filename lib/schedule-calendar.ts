import type {RecordItem} from './finance';
import {parseCalendarDate,serializeCalendarDate} from './calendar-date';

export function scheduleCalendarDays(month:string,obligations:RecordItem[],status='all'){
 const first=parseCalendarDate(month,'month');if(!first)return [];
 const offset=(first.getDay()+1)%7;
 return Array.from({length:42},(_,index)=>{
  const day=new Date(first.getFullYear(),first.getMonth(),index-offset+1,12),date=serializeCalendarDate(day),inside=date.startsWith(month);
  const items=inside?obligations.filter(r=>r.kind==='obligation'&&r.data.date===date&&['pending','paid'].includes(r.data.status)&&(status==='all'||r.data.status===status)):[];
  const sum=(direction:string)=>items.filter(r=>r.data.direction===direction).reduce((total,r)=>total+Number(r.data.amount||0),0);
  return {date,day:day.getDate(),inside,weekend:day.getDay()===5||day.getDay()===6,items,incoming:sum('in'),outgoing:sum('out'),paid:items.filter(r=>r.data.status==='paid').length};
 });
}
