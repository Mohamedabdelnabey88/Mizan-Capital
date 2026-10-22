import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/project-portfolio.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/project-portfolio.mjs'});
const {projectDescendantIds,matchesProjectTree,relevantLease}=await import('../.sites-runtime/project-portfolio.mjs');
const projects=[
 {id:'root',data:{name:'المجمع التجاري',activity:'إدارة عقارات'}},
 {id:'level1',data:{parentId:'root',name:'البرج الشمالي'}},
 {id:'level2',data:{parentId:'level1',name:'محل الزهور',activity:'تأجير'}},
 {id:'level3',data:{parentId:'level2',name:'وحدة زهور 101'}},
 {id:'other',data:{name:'مشروع مختلف'}},
];
assert.deepEqual(projectDescendantIds(projects,'root'),['level1','level2','level3']);
assert.equal(matchesProjectTree(projects,projects[0],'زهور'),true,'Grandchild and great-grandchild must be discoverable from root');
assert.equal(matchesProjectTree(projects,projects[1],'101'),true,'Nested unit search must match descendants');
assert.equal(matchesProjectTree(projects,projects[4],'زهور'),false,'Unrelated projects must not leak search results');
assert.equal(matchesProjectTree(projects,projects[0],'   '),true,'Empty search must match');
const cycle=[{id:'a',data:{parentId:'b'}},{id:'b',data:{parentId:'a'}}];
assert.deepEqual(projectDescendantIds(cycle,'a'),['b'],'Imported cyclic hierarchy must terminate safely');
const lease=(startDate,endDate,status='active')=>({data:{startDate,endDate,status}});
const old=lease('2025-01-01','2025-12-31'),upcoming=lease('2026-11-01','2027-10-31'),current=lease('2026-06-01','2027-05-31');
assert.equal(relevantLease([old],'2026-10-22'),undefined,'Expired contracts must not label unit as rented');
assert.equal(relevantLease([old,upcoming],'2026-10-22'),upcoming,'Next future lease should be displayed');
assert.equal(relevantLease([old,upcoming,current],'2026-10-22'),current,'Live lease takes priority over upcoming lease');
assert.equal(relevantLease([lease('2026-06-01','2027-05-31','cancelled')],'2026-10-22'),undefined,'Cancelled leases must be excluded');
const ui=fs.readFileSync('app/page.tsx','utf8');
assert(ui.includes('matchesProjectTree(projects,p,projectSearch)'),'Portfolio filter must use multilevel search');
assert(ui.includes('projectDescendantIds(projects,p.id)'),'Portfolio financial rollup must use same hierarchy selector');
assert(ui.includes('const unitLease=relevantLease('),'Unit lease status must use date validation');
assert(ui.includes("unitLeaseUpcoming?'عقد قادم'"),'Upcoming rental must not display as currently rented');
assert(ui.includes("unitMode==='leased'?'عقد غير مسجل'"),'Leased management mode without a valid lease must be shown as incomplete');
console.log('Multi-level project branches and lease-status tests passed.');
