import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wr=createRequire(require.resolve('wrangler/package.json'));
await wr('esbuild').build({entryPoints:['lib/api-response.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/api-response.mjs'});
const {readApiResponse,ApiResponseError}=await import('../.sites-runtime/api-response.mjs');
for(const status of [200,403,502,503]){
 await assert.rejects(()=>readApiResponse(new Response('<!DOCTYPE html><h1>gateway secret</h1>',{status}),true),e=>e instanceof ApiResponseError&&e.uncertain&&e.status===status&&!e.message.includes('gateway secret')&&!e.message.includes('Unexpected token'));
}
for(const text of ['', '{"ok":', 'null','[]','"success"'])await assert.rejects(()=>readApiResponse(new Response(text)),ApiResponseError);
assert.deepEqual(await readApiResponse(Response.json({ok:true})),{ok:true});
assert.deepEqual(await readApiResponse(Response.json({error:'القسط غير مسدد'},{status:400})),{error:'القسط غير مسدد'});
const broken=new Response(new ReadableStream({start(c){c.error(new Error('stream failed'));}}));await assert.rejects(()=>readApiResponse(broken,true),e=>e instanceof ApiResponseError&&e.uncertain);
console.log('API responses: HTML gateway/status-200 fallback, truncated/empty responses, interrupted stream and valid JSON handled safely.');
await wr('esbuild').build({entryPoints:['app/api/workspace/route.ts'],bundle:true,platform:'node',format:'esm',alias:{'@':process.cwd()},outfile:'.sites-runtime/workspace-proxy-test.mjs'});
const {POST}=await import('../.sites-runtime/workspace-proxy-test.mjs');
const originalFetch=globalThis.fetch,originalEnv=process.env.VERCEL_ENV;
try{
 delete process.env.VERCEL_ENV;
 for(const status of [200,502]){
  globalThis.fetch=async()=>new Response('<!DOCTYPE html>upstream error',{status});
  const response=await POST(new Request('https://example.test/api/workspace',{method:'POST',body:'{}'}));
  assert.equal(response.status,502);const result=await response.json();assert.equal(result.code,'INVALID_API_RESPONSE');assert.equal(result.uncertain,true);assert(!result.error.includes('<!DOCTYPE'));
 }
 globalThis.fetch=async()=>Response.json({error:'لا يمكن التراجع: القسط غير مسجل كمسدد.'},{status:400});
 const response=await POST(new Request('https://example.test/api/workspace',{method:'POST',body:'{}'}));assert.equal(response.status,400);assert((await response.json()).error.includes('غير مسجل'));
 process.env.VERCEL_ENV='preview';globalThis.fetch=async()=>{throw Error('must not access production');};assert.equal((await POST(new Request('https://example.test/api/workspace',{method:'POST',body:'{}'}))).status,503);
}finally{globalThis.fetch=originalFetch;if(originalEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=originalEnv;}
console.log('Workspace proxy: HTML normalized to JSON with uncertain outcome, business errors preserved, preview isolation retained.');
