export type ReportPeriod = {start:string;end:string};

export function validReportDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function monthPeriod(month:string):ReportPeriod{
 const start=month+'-01';
 if(!validReportDate(start))throw Error('شهر غير صحيح');
 const date=new Date(start+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);
 return {start,end:date.toISOString().slice(0,10)};
}
export function shiftReportPeriod(period:ReportPeriod,direction:number):ReportPeriod{
 const fullMonth=monthPeriod(period.start.slice(0,7));
 if(period.start===fullMonth.start&&period.end===fullMonth.end){
  const date=new Date(period.start+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+direction);
  return monthPeriod(date.toISOString().slice(0,7));
 }
 if(period.start.endsWith('-01-01')&&period.end===period.start.slice(0,4)+'-12-31'){const year=String(Number(period.start.slice(0,4))+direction).padStart(4,'0');return {start:year+'-01-01',end:year+'-12-31'};}
 const days=Math.round((Date.parse(period.end)-Date.parse(period.start))/86400000)+1;
 const shift=(value:string)=>new Date(Date.parse(value+'T12:00:00Z')+direction*days*86400000).toISOString().slice(0,10);
 return {start:shift(period.start),end:shift(period.end)};
}
export const inReportPeriod=(date:unknown,period:ReportPeriod)=>typeof date==='string'&&date>=period.start&&date<=period.end;
