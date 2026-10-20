import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const routes=[
  ['app/api/workspace/route.ts','async function proxy(request:Request)'],
  ['app/api/auth/login/route.ts','export async function POST(request:Request)'],
  ['app/api/auth/logout/route.ts','async function out(request:Request)'],
  ['app/api/session/route.ts','export async function GET(request:Request)'],
];
for(const [path,entry] of routes){
 const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
 const at=source.indexOf(entry);assert(at>=0,path+' route entry must exist');
 const guard=source.indexOf("process.env.VERCEL_ENV==='preview'",at);
 const upstream=source.indexOf('fetch(',at);
 assert(guard>=0&&upstream>=0&&guard<upstream,path+' must block preview before any upstream request');
 assert(source.slice(guard,upstream).includes('status:503'),path+' must fail closed with HTTP 503');
}
console.log('Preview isolation tests passed: preview API/auth routes cannot proxy to the production Worker.');
