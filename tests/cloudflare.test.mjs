import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
const {build}=wr('esbuild'),{Miniflare,Response}=wr('miniflare');
fs.mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['cloudflare/worker.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.sites-runtime/cloudflare-worker.mjs'});
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'test-key',use:'sig',alg:'RS256'};
const now=Math.floor(Date.now()/1000),domain='https://mizan-test.cloudflareaccess.com';
const base={iss:domain,aud:['test-audience'],email:'owner@example.com',sub:'test-owner',iat:now,exp:now+3600};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(claims={},header={}){const msg=encode({alg:'RS256',kid:'test-key',...header})+'.'+encode({...base,...claims});const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(msg));return msg+'.'+Buffer.from(sig).toString('base64url');}
const options={modules:true,scriptPath:'.sites-runtime/cloudflare-worker.mjs',compatibilityDate:'2026-05-15',d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('public shell only')},outboundService:req=>{assert.equal(req.url,domain+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});}};
const mf=new Miniflare({...options,bindings:{ACCESS_TEAM_DOMAIN:domain,ACCESS_AUD:'test-audience',OWNER_EMAIL:'owner@example.com'}});
let checks=0;
try{
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const valid=await token();
 async function call({jwt=valid,method='GET',body,extra={},path='/api/workspace'}={}){
  return mf.dispatchFetch('https://mizan.example'+path,{method,headers:{...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),...(method==='POST'?{'Content-Type':'application/json','Origin':'https://mizan.example'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 }
 async function expectStatus(args,status){const res=await call(args);assert.equal(res.status,status,await res.text());checks++;}
 await expectStatus({jwt:null,extra:{'oai-authenticated-user-id':'cloudflare-owner'}},401);
 await expectStatus({jwt:'invalid'},401);
 await expectStatus({jwt:await token({}, {alg:'none'})},401);
 await expectStatus({jwt:await token({exp:now-1})},401);
 await expectStatus({jwt:await token({aud:['wrong-app']})},401);
 await expectStatus({jwt:await token({iss:'https://evil.cloudflareaccess.com'})},401);
 await expectStatus({jwt:await token({email:'other@example.com'})},403);
 await expectStatus({jwt:await token({email:undefined})},401);
 await expectStatus({jwt:await token({sub:undefined})},401);
 await expectStatus({jwt:await token({iat:now+3600})},401);
 const parts=valid.split('.');parts[1]=encode({...base,email:'other@example.com'});await expectStatus({jwt:parts.join('.')},401);
 await expectStatus({method:'POST',body:{},extra:{Origin:'https://evil.example'}},403);
 await expectStatus({method:'POST',body:{},extra:{'Sec-Fetch-Site':'cross-site'}},403);
 await expectStatus({method:'DELETE'},405);
 await expectStatus({path:'/api/unknown'},404);
 const res=await call();assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');checks++;
 const projectRequest={action:'project',requestId:crypto.randomUUID(),payload:{name:'اختبار Cloudflare',activity:'اختبار',mode:'operating',ownership:100,reserve:0,payout:30}};
 await expectStatus({method:'POST',body:projectRequest,extra:{'oai-authenticated-user-id':'attacker'}},200);
 const rows=(await db.prepare('SELECT owner FROM records').all()).results;assert.deepEqual(rows.map(r=>r.owner),['cloudflare-owner']);checks++;
 // The real API must handle the longest supported schedule on a fresh D1 database.
 let w=await (await call()).json();const project=w.records[0].id;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await expectStatus({method:'POST',body:{action:'loan',requestId:crypto.randomUUID(),payload:{project,name:'360 قسطًا',amount:360000,rate:0,months:360,start:date,firstDate:date}}},200);
 w=await (await call()).json();const loan=w.records.find(r=>r.kind==='loan');let due=w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='pending');assert.equal(due.length,360);checks++;
 await expectStatus({method:'POST',body:{action:'replaceSchedule',requestId:crypto.randomUUID(),payload:{id:loan.id,date,prepay:0,fee:0,rows:due.map(r=>r.data.date+',1000,0').join('\n')}}},200);
 w=await (await call()).json();assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='pending').length,360);assert.equal(w.records.filter(r=>r.data.loan===loan.id&&r.data.status==='replaced').length,360);checks++;
 // Failed bulk/optimistic commands must leave no partial schedule behind.
 const employees={action:'employee',payload:{project,name:'تجربة تزامن',job:'اختبار',salary:1000,months:24,firstDate:date}};
 await expectStatus({method:'POST',body:{...employees,requestId:crypto.randomUUID()}},200);
 w=await (await call()).json();const emp=w.records.find(r=>r.kind==='employee');
 const renewal={action:'renewPayroll',payload:{id:emp.id,salary:1000,months:24}};
 const race=await Promise.all([call({method:'POST',body:{...renewal,requestId:crypto.randomUUID()}}),call({method:'POST',body:{...renewal,requestId:crypto.randomUUID()}})]);
 assert(race.every(r=>[200,400].includes(r.status)));const successes=race.filter(r=>r.status===200).length;assert(successes>=1);
 w=await (await call()).json();const payroll=w.records.filter(r=>r.data.employee===emp.id);assert.equal(payroll.length,24*(1+successes));assert.equal(new Set(payroll.map(r=>r.data.date)).size,payroll.length);checks++;
 console.log(JSON.stringify({passed:true,checks,verified:['JWT signature and claims','owner-only access','spoofed identity rejected','cross-origin writes blocked','360-payment loan and replacement','atomic payroll renewal']}));
}finally{await mf.dispose();}
const missing=new Miniflare(options);
try{const res=await missing.dispatchFetch('https://mizan.example/api/workspace',{headers:{'oai-authenticated-user-id':'cloudflare-owner'}});assert.equal(res.status,503);console.log('Missing Access configuration: safely blocked');}finally{await missing.dispose();}
