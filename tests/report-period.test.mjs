import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json')),{build}=wr('esbuild');
await fs.mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/report-period.ts'],bundle:true,format:'esm',platform:'node',outfile:'.sites-runtime/report-period.mjs'});
const {monthPeriod,shiftReportPeriod,validReportDate,inReportPeriod}=await import('../.sites-runtime/report-period.mjs');
assert.equal(validReportDate('2026-02-29'),false);
assert.equal(validReportDate('2028-02-29'),true);
assert.equal(validReportDate('2026-13-01'),false);
assert.equal(validReportDate(''),false);
assert.deepEqual(monthPeriod('2028-02'),{start:'2028-02-01',end:'2028-02-29'});
assert.deepEqual(shiftReportPeriod(monthPeriod('2026-01'),-1),monthPeriod('2025-12'));
assert.deepEqual(shiftReportPeriod(monthPeriod('2028-01'),1),monthPeriod('2028-02'));
assert.deepEqual(shiftReportPeriod({start:'2028-01-01',end:'2028-12-31'},1),{start:'2029-01-01',end:'2029-12-31'});
assert.deepEqual(shiftReportPeriod({start:'2026-10-29',end:'2026-11-03'},1),{start:'2026-11-04',end:'2026-11-09'});
const period={start:'2026-10-01',end:'2026-10-31'};
assert.equal(inReportPeriod('2026-10-01',period),true);
assert.equal(inReportPeriod('2026-10-31',period),true);
assert.equal(inReportPeriod('2026-11-01',period),false);
assert.equal(inReportPeriod(undefined,period),false);
// Render the actual page for every navigation destination with a seeded workspace.
// Only the root state initializer is replaced; financial calculations and all child components remain real.
const harness=path.resolve('.sites-runtime/review-state.mjs');
await fs.writeFile(harness,`export function useState(initial){const i=globalThis.__reviewIndex++;return [Object.hasOwn(globalThis.__reviewState,i)?globalThis.__reviewState[i]:typeof initial==='function'?initial():initial,()=>{}]}`);
await build({stdin:{contents:`export {default as Home} from './app/page';export {demoWorkspace} from './lib/demo';`,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'root-state-fixture',setup(b){b.onLoad({filter:/app\/page\.tsx$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('import {useState,useEffect,',`import {useState} from ${JSON.stringify(harness)};\nimport {useEffect,`),loader:'tsx',resolveDir:path.dirname(args.path)}));}}],bundle:true,format:'esm',platform:'node',alias:{'@':process.cwd()},external:['react','react-dom','react-dom/server'],loader:{'.css':'empty'},banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"},outfile:'.sites-runtime/review-page.mjs',jsx:'automatic'});
const {Home,demoWorkspace}=await import('../.sites-runtime/review-page.mjs');
const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
const fixture=demoWorkspace();
const tabs=['dashboard','projects','daily','commitments','calendar','contracts','team','ledger','capital','loans','personalLoans','cashflow','reports','decisions','risks','settings'];
for(const tab of tabs){
 globalThis.__reviewIndex=0;globalThis.__reviewState={0:fixture,1:false,4:tab,8:period.start,9:period.end};
 const html=renderToStaticMarkup(createElement(Home));
 assert(html.includes('workspace-v2'),tab+' must render its complete workspace');
 assert(!html.includes('NaN'),tab+' must not show invalid financial values');
 if(!['decisions','settings'].includes(tab))assert(html.includes('تطبيق الفترة'),tab+' must expose a working period control');
 if(['loans','personalLoans','contracts','team'].includes(tab))assert(html.includes('حركة الفترة المحددة'),tab+' must render dated financial activity');
}
console.log('Report periods: leap years, boundaries, month navigation, custom ranges and all 16 page renders passed.');
const rootSource=await fs.readFile('app/page.tsx','utf8');
const stateNames=[...rootSource.matchAll(/\[([A-Za-z]+),set[A-Za-z]+\]=useState/g)].map(match=>match[1]);
function renderPage(tab,changes={}){
 globalThis.__reviewIndex=0;globalThis.__reviewState={0:fixture,1:false,4:tab,8:period.start,9:period.end};
 for(const [name,value] of Object.entries(changes)){const index=stateNames.indexOf(name);assert(index>=0,name);globalThis.__reviewState[index]=value;}
 return renderToStaticMarkup(createElement(Home));
}
const pid=fixture.records.find(r=>r.kind==='project'&&r.data.mode==='operating').id;
fixture.records.push(...[
 ['qa-oct','QA_OCT_PENDING','2026-10-12','pending',''],
 ['qa-nov','QA_NOV_PENDING','2026-11-12','pending',''],
 ['qa-settled','QA_OCT_EXECUTED_NOV','2026-10-08','paid','2026-11-08']
].map(([id,title,date,status,paidOn])=>({id,kind:'obligation',version:1,data:{title,date,status,paidOn,project:pid,direction:'out',amount:10000,category:'expense'}})));
let html=renderPage('calendar',{month:'2026-11',calendarView:'list'});
assert(html.includes('QA_OCT_PENDING'),'calendar list must use selected October dates even when the old calendar month was November');
assert(!html.includes('QA_NOV_PENDING'),'calendar list must exclude other months');
assert(!html.includes('QA_OCT_EXECUTED_NOV'),'October execution details must exclude November payments');
html=renderPage('calendar',{month:'2026-11',calendarView:'month'});
assert(html.includes('QA_NOV_PENDING'),'month grid and its detail list must use the same month');
assert(!html.includes('QA_OCT_PENDING'),'month grid must not leak report-period items from a different month');
html=renderPage('commitments',{month:'2026-11',commitmentView:'out'});
assert(html.includes('QA_OCT_PENDING'),'commitments must honor report dates rather than the old independent month');
assert(!html.includes('QA_NOV_PENDING'),'commitments must exclude out-of-period dues');
html=renderPage('calendar',{from:'2026-11-01',to:'2026-11-30',calendarView:'list'});
assert(html.includes('QA_OCT_EXECUTED_NOV'),'November execution must include an October installment actually paid in November');
html=renderPage('settings');assert(html.includes('أقسام الإعدادات'));
html=renderPage('daily');assert(html.includes('أقسام الدخل اليومي'));
console.log('Cross-page regressions passed: shared periods, calendar grid/list alignment, due vs actual payment dates, and task sections.');
