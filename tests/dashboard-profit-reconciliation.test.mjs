import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dashboardProfitReconciliation,profit} from '../lib/finance.ts';

const line=(project,account,debit=0,credit=0)=>({project,account,debit,credit});
const j=(id,date,kind,...lines)=>({id,date,kind,memo:id,lines});
test('overview reconciles posted profit, card receipts, settlements, credits and project scope without duplicates',()=>{
 const w={records:[],audit:[],journals:[
 j('sale','2026-10-01','income',line('op','mada',10000),line('op','revenue',0,10000)),
 j('settle','2026-10-02','cardSettlement',line('op','bank',10000),line('op','mada',0,10000)),
 j('credit','2026-10-03','invoice',line('op','receivable',5000),line('op','revenue',0,5000)),
 j('collect','2026-10-04','collect',line('op','bank',5000),line('op','receivable',0,5000)),
 j('exp','2026-10-05','expense',line('op','expense',2000),line('op','bank',0,2000)),
 j('owner','2026-10-06','deficitPayment',line('op','bank',8000),line('op','owner_advance',0,8000)),
 j('investment','2026-10-07','dividend',line('inv','bank',3000),line('inv','dividend',0,3000)),
 j('outside','2026-11-01','income',line('op','cash',9000),line('op','revenue',0,9000))
 ]};
 const a=dashboardProfitReconciliation(w,'2026-10-01','2026-10-31',['op']);
 assert.equal(a.total.revenue,15000);
 assert.equal(a.total.expense,2000);
 assert.equal(a.total.net,13000);
 assert.equal(a.total.cardReceived,10000);
 assert.equal(a.total.cardSettlement,10000);
 assert.equal(a.total.creditCollections,5000);
 assert.equal(a.total.bankCashNet,21000);
 assert.equal(a.excludedProjectsProfit,3000);
 assert.equal(a.total.net+a.excludedProjectsProfit,profit(w,'all','2026-10-01','2026-10-31').net);
 assert.equal(dashboardProfitReconciliation(w,'2026-10-01','2026-10-31',['op','inv']).total.net,16000);
});
