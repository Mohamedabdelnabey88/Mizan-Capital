import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json')),{build}=wr('esbuild');
await fs.mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/calendar-date.ts','lib/schedule-calendar.ts'],bundle:true,format:'esm',platform:'node',outdir:'.sites-runtime/calendar-system'});
const {parseCalendarDate,serializeCalendarDate,withinCalendarBounds,calendarValueLabel}=await import('../.sites-runtime/calendar-system/calendar-date.js');
const {scheduleCalendarDays}=await import('../.sites-runtime/calendar-system/schedule-calendar.js');
for(const timezone of ['UTC','Asia/Riyadh','America/Los_Angeles','Pacific/Kiritimati']){
 process.env.TZ=timezone;
 for(const value of ['2026-10-01','2028-02-29','2026-12-31','2026-03-08'])assert.equal(serializeCalendarDate(parseCalendarDate(value)),value,'date must remain unchanged in '+timezone);
 assert.equal(serializeCalendarDate(parseCalendarDate('2026-10','month'),'month'),'2026-10');
}
process.env.TZ='UTC';
assert.equal(parseCalendarDate('2026-02-29'),undefined);assert.equal(parseCalendarDate('2026-13-01'),undefined);assert.equal(parseCalendarDate('2026-10-32'),undefined);
assert.equal(withinCalendarBounds('2026-10-24','date','2026-10-24','2026-10-31'),true);
assert.equal(withinCalendarBounds('2026-10-23','date','2026-10-24','2026-10-31'),false);
assert.equal(withinCalendarBounds('2026-11-01','date',undefined,'2026-10-31'),false);
assert.equal(withinCalendarBounds('2026-10','month','2026-10','2026-12'),true);
assert.equal(withinCalendarBounds('2026-09','month','2026-10','2026-12'),false);
assert.equal(calendarValueLabel('2026-10-01'),'1 أكتوبر 2026');assert.equal(calendarValueLabel('2026-10','month'),'أكتوبر 2026');
const item=(id,date,direction,amount,status='pending')=>({id,kind:'obligation',version:1,data:{date,direction,amount,status}});
const items=[item('in','2026-10-24','in',1000000),item('out','2026-10-24','out',120000),item('paid','2026-10-24','in',50000,'paid'),item('cancelled','2026-10-24','in',9000000,'cancelled'),item('deferred','2026-10-24','in',9000000,'deferred'),item('outside','2026-11-01','in',3000000)];
const days=scheduleCalendarDays('2026-10',items),day=days.find(d=>d.date==='2026-10-24');
assert.equal(days.length,42);assert.equal(new Date(days[0].date+'T12:00Z').getUTCDay(),6,'week starts on Saturday');
assert.equal(days.filter(d=>d.inside).length,31);assert.equal(day.incoming,1050000);assert.equal(day.outgoing,120000);assert.equal(day.items.length,3);assert.equal(day.paid,1);
assert.equal(scheduleCalendarDays('2026-10',items,'pending').find(d=>d.date==='2026-10-24').incoming,1000000);
assert.equal(scheduleCalendarDays('2028-02',[]).filter(d=>d.inside).length,29);
assert.equal(days.find(d=>d.date==='2026-11-01').items.length,0,'adjacent-month cells must not mix outside totals into current month');
// Replace only the portal during SSR so the real styled panel and DayPicker can be inspected.
const portal=path.resolve('.sites-runtime/calendar-portal-test.tsx');
await fs.writeFile(portal,`import React from 'react';export const Popover=({children})=><>{children}</>;export const PopoverTrigger=({children})=><>{children}</>;export const PopoverContent=({children})=><div role="dialog">{children}</div>;`);
await build({stdin:{contents:"export {DateInput} from './components/date-input';export {ScheduleCalendar} from './components/schedule-calendar';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',jsx:'automatic',alias:{'@/components/ui/popover':portal,'@':process.cwd()},external:['react','react-dom','react-dom/server'],loader:{'.css':'empty'},banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},outfile:'.sites-runtime/calendar-system-render.mjs'});
const {DateInput,ScheduleCalendar}=await import('../.sites-runtime/calendar-system-render.mjs');
const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
let html=renderToStaticMarkup(createElement(DateInput,{value:'2026-10-24',required:true,'aria-label':'تاريخ التحصيل',max:'2026-10-24',onChange:()=>{}}));
for(const title of ['تاريخ التحصيل','أكتوبر','اختر السنة','تقويم ميلادي','mizan-day-picker'])assert(html.includes(title),title+' must be present');
assert(html.includes('role="combobox"'));assert(!html.includes('type="date"'));assert(html.includes('required=""'));assert(!html.includes('مسح الاختيار'),'mandatory dates must not expose clear');
html=renderToStaticMarkup(createElement(DateInput,{type:'month',value:'2026-10',max:'2026-10',onChange:()=>{}}));
assert(html.includes('mizan-month-grid'));assert(html.includes('أكتوبر 2026'));assert(html.includes('نوفمبر'));assert(html.includes('disabled=""'));assert(html.includes('مسح الاختيار'));
html=renderToStaticMarkup(createElement(ScheduleCalendar,{month:'2026-10',items,status:'all',selected:'2026-10-24',onSelect:()=>{}}));
assert(html.includes('10,500'));assert(html.includes('1,200'));assert(html.includes('aria-pressed="true"'));assert(!html.includes('9,000,000'));
for(const file of ['app/page.tsx','components/report-period.tsx']){
 const source=await fs.readFile(file,'utf8');assert(!/<input[^>]*type="(?:date|month)"/.test(source),file+' must use the shared styled picker');assert(source.includes('DateInput'));
}
console.log('Calendar system passed: localized day/month panels, min/max constraints, required semantics, timezone-stable ISO dates, 42-day financial grids and app-wide adoption.');
