import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json')),{build}=wr('esbuild');
await fs.mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/project-workspace.ts','lib/installment-payments.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/project-selectors'});
const {projectWorkspace}=await import('../.sites-runtime/project-selectors/project-workspace.js');
const {installmentPaymentHistory,installmentPaymentSource}=await import('../.sites-runtime/project-selectors/installment-payments.js');
const record=(id,kind,data)=>({id,kind,version:1,data});
const fixture={records:[
 record('p','project',{name:'العقار الرئيسي',mode:'operating'}),record('unit-project','project',{name:'محل يمني',parentId:'p',mode:'operating'}),record('other','project',{name:'مشروع مستقل',mode:'operating'}),
 record('unit','propertyUnit',{name:'وحدة مستقلة',project:'p',operatingMode:'rent'}),
 record('rent','projectTenantLease',{project:'unit-project',title:'إيجار يمني',tenantName:'يمني',totalAmount:3000000,status:'active',startDate:'2026-01-01',endDate:'2027-12-31'}),
 record('lease','tenantLease',{project:'p',unitId:'unit',title:'عقد الوحدة',tenantName:'سعد',status:'active',startDate:'2026-01-01',endDate:'2027-12-31'}),
 record('due1','obligation',{project:'unit-project',projectTenantLeaseId:'rent',title:'قسط يمني المدفوع',direction:'in',status:'paid',date:'2026-09-01',paidOn:'2026-10-02',amount:1000000}),
 record('due2','obligation',{project:'unit-project',projectTenantLeaseId:'rent',title:'قسط يمني المتبقي',direction:'in',status:'pending',date:'2026-11-01',amount:2000000}),
 record('term','projectCommitment',{project:'p',title:'عقد الأرض بتاريخ مستقل',costType:'rent',startDate:'2026-08-15',endDate:'2036-08-14',status:'active'}),
 record('legacy-term','projectCommitment',{project:'p',title:'عقد قديم بلا مدة',costType:'rent',status:'active'}),
 record('term-due','obligation',{project:'p',projectCommitmentId:'term',title:'قسط العقد السنوي',direction:'out',status:'pending',date:'2027-01-01',amount:0}),
 record('expense','obligation',{project:'p',title:'دفعة مقاول',direction:'out',status:'pending',date:'2026-10-12',amount:500000}),
 record('cancelled','obligation',{project:'unit-project',projectTenantLeaseId:'rent',title:'قسط ملغى',direction:'in',status:'cancelled',date:'2026-11-12',amount:999999}),
 record('unrelated','obligation',{project:'other',title:'MUST_NOT_LEAK',direction:'in',status:'pending',date:'2026-10-05',amount:99999999})
],journals:[{id:'j1',date:'2026-10-02',kind:'income',source:'project-tenant-rent-payment:due1',memo:'تحصيل يمني',lines:[{project:'unit-project',account:'bank',debit:1000000,credit:0},{project:'unit-project',account:'revenue',debit:0,credit:1000000}]}],audit:[]};
let view=projectWorkspace(fixture,'p');assert.deepEqual(view.totals,{received:1000000,paid:0,receivable:2000000,payable:500000});assert.equal(view.branches.length,1);assert.equal(view.units.length,1);
const contract=view.contracts.find(r=>r.contract.id==='rent');assert.equal(contract.paid,1000000);assert.equal(contract.pending,2000000);assert.equal(contract.installments.length,3);
assert(!view.dues.some(r=>r.id==='unrelated'),'separate projects must never leak into the file');
view=projectWorkspace(fixture,'p',false);assert.deepEqual(view.totals,{received:0,paid:0,receivable:0,payable:500000});
view=projectWorkspace(fixture,'unit-project');assert.equal(view.contracts.length,1);assert.equal(view.pending.length,1);assert.equal(view.paid.length,1);
assert.equal(projectWorkspace(fixture,'missing').dues.length,0,'invalid deep links must not expose the full workspace');
assert.throws(()=>installmentPaymentSource(fixture,'project-tenant-rent-payment:due1','next'));
const reversed={...fixture,journals:[...fixture.journals,{id:'reverse',date:'2026-10-03',reversal:'j1',lines:[]}]};
assert.equal(installmentPaymentSource(reversed,'project-tenant-rent-payment:due1','next'),'project-tenant-rent-payment:due1:payment:next');
assert.equal(installmentPaymentHistory(reversed,fixture.records.find(r=>r.id==='due1'))[0].reversed,true);
// Server-render all seven sections with the actual table, tabs, financial selectors and callbacks.
const stateModule=path.resolve('.sites-runtime/project-render-state.mjs');
await fs.writeFile(stateModule,`export function useState(initial){const i=globalThis.__projectIndex++;return [Object.hasOwn(globalThis.__projectState,i)?globalThis.__projectState[i]:initial,()=>{}]}`);
await build({entryPoints:['components/project-workspace.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},external:['react','react-dom','react-dom/server'],loader:{'.css':'empty'},banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},plugins:[{name:'project-render-state',setup(b){b.onLoad({filter:/components\/project-workspace\.tsx$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('useMemo,useState,type ReactNode','useMemo,type ReactNode').replace("import {Tabs,TabsContent",`import {useState} from ${JSON.stringify(stateModule)};\nimport {Tabs,TabsContent`),loader:'tsx',resolveDir:path.dirname(args.path)}));}}],outfile:'.sites-runtime/project-workspace-render.mjs'});
const {ProjectWorkspace}=await import('../.sites-runtime/project-workspace-render.mjs');
const {createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
for(const section of ['overview','capital','contracts','pending','paid','units','history']){
 globalThis.__projectIndex=0;globalThis.__projectState={1:section};
 const html=renderToStaticMarkup(createElement(ProjectWorkspace,{workspace:fixture,projectId:'p',from:'2026-10-01',to:'2026-10-31',busy:false,onBack:()=>{},onProject:()=>{},onOpen:()=>{}}));
 assert(html.includes('العقار الرئيسي'));assert(!html.includes('MUST_NOT_LEAK'));assert(!html.includes('NaN'));
 if(section==='contracts'){assert(html.includes('دفعات العقد'));assert(html.includes('بداية العقد:')&&html.includes('نهاية العقد:'));assert(html.includes('١٥ أغسطس ٢٠٢٦')||html.includes('15 أغسطس 2026'));assert(html.includes('عقد قديم بلا مدة')&&html.includes('غير مسجلة'));}
 if(section==='pending')assert(html.includes('قسط يمني المتبقي')&&html.includes('تأكيد التحصيل'));
 if(section==='paid')assert(html.includes('قسط يمني المدفوع')&&html.includes('التراجع عن'));
 if(section==='units')assert(html.includes('فتح الملف'));
 if(section==='history')assert(html.includes('التراجع عن الدفعة'));
}
console.log('Project files passed: exact branch scope, contract balances, all pending/paid dates, seven sections and reversal history.');
