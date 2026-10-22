import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['lib/finance.ts'],bundle:true,format:'esm',platform:'node',alias:{'@':process.cwd()},outfile:'.sites-runtime/dashboard-capital-finance.mjs'});
const f=await import('../.sites-runtime/dashboard-capital-finance.mjs');
const asOf='2026-06-10';
const w={records:[],audit:[],journals:[
 {id:'opening',kind:'capital',date:'2026-06-01',memo:'owner contribution',lines:[{project:'p1',account:'cash',debit:100000,credit:0},{project:'p1',account:'capital',debit:0,credit:100000}]},
 {id:'card',kind:'dailyReport',date:'2026-06-03',memo:'pending card funds',lines:[{project:'p1',account:'mada',debit:22345,credit:0},{project:'p1',account:'revenue',debit:0,credit:22345}]},
 {id:'bank',kind:'transfer',date:'2026-06-05',memo:'cash to bank',lines:[{project:'p1',account:'bank',debit:30000,credit:0},{project:'p1',account:'cash',debit:0,credit:30000}]},
 {id:'future',kind:'cardSettlement',date:'2026-06-12',memo:'future card settlement',lines:[{project:'p1',account:'bank',debit:22345,credit:0},{project:'p1',account:'mada',debit:0,credit:22345}]}
]};
assert.equal(f.cashAndBank(w,'p1',asOf),100000,'cash+bank excludes unsettled card amounts');
assert.equal(f.cardReceivables(w,'p1',asOf),22345,'pending card settlement is an asset, not available cash');
assert.equal(f.liquidity(w,'p1',asOf),122345,'broad liquidity includes receivable cards exactly once');
assert.equal(f.cashAndBank(w,'p1','2026-06-15'),122345,'card settlement becomes bank cash only on actual settlement date');
assert.equal(f.cardReceivables(w,'p1','2026-06-15'),0,'settled card receivable is extinguished');
assert.equal(f.liquidity(w,'p1','2026-06-15'),122345,'transfer to cash must not double count broad liquidity');
assert.equal(f.normalBalance('capital',f.balance(w,'p1',asOf).capital),100000,'capital balance is owner equity rather than liquidity');
assert.equal(f.actualCashFlow(w,'p1','2026-06-01',asOf).closing,100000,'cash flow must reconcile with true cash and bank, not unsettled cards');
assert.equal(f.externalLiabilityBreakdown(w,['p1'],asOf)[0].total,0,'owner equity is not an external liability');

const ui=fs.readFileSync('app/page.tsx','utf8');
assert(ui.includes("externalLiabilityBreakdown(w,externalProjectIds,to)"),'dashboard external liabilities must use report end date');
assert(ui.includes("<Money value={cashAndBank(w,scope,to)}/>"),'dashboard cash+bank must agree with capital-page cash+bank');
assert(ui.includes("<Money value={cardReceivables(w,scope,to)}/>"),'dashboard card balance must agree with capital page');
assert(ui.includes("<Money value={cashAndBank(w,p.id,to)}/>"),'project table must use same cash+bank definition and same cutoff');
assert(ui.includes("heads={['المشروع','صافي ربح الفترة','النقد والبنك بنهاية الفترة','حصة المالك']}"),'project table must identify as-of cash balance');
assert(ui.includes("moneyCell(cashAndBank(w,scope,to),5)"),'export and on-screen cash must use the same calculation');
console.log('Capital/dashboard exact monetary and date consistency checks passed.');
