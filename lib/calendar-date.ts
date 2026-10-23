/** Date-only values stay in the Gregorian calendar; no timezone conversion on save. */
export type CalendarPrecision='date'|'month';
export const calendarMonths=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
export function parseCalendarDate(value:string,precision:CalendarPrecision='date'){
 const raw=precision==='month'?value+'-01':value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return undefined;
 const [year,month,day]=raw.split('-').map(Number);
 const date=new Date(0);date.setFullYear(year,month-1,day);date.setHours(12,0,0,0);
 return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?date:undefined;
}
export function serializeCalendarDate(date:Date,precision:CalendarPrecision='date'){
 const month=String(date.getMonth()+1).padStart(2,'0'),year=String(date.getFullYear()).padStart(4,'0');
 return precision==='month'?year+'-'+month:year+'-'+month+'-'+String(date.getDate()).padStart(2,'0');
}
export function withinCalendarBounds(value:string,precision:CalendarPrecision,min?:string,max?:string){
 return !!parseCalendarDate(value,precision)&&(!min||value>=min)&&(!max||value<=max);
}
export function calendarValueLabel(value:string,precision:CalendarPrecision='date'){
 const date=parseCalendarDate(value,precision);if(!date)return '';
 return (precision==='date'?date.getDate()+' ':'')+calendarMonths[date.getMonth()]+' '+date.getFullYear();
}
