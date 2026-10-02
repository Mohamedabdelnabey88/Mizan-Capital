const BACKEND='https://mizan-capital.famaradona89.workers.dev';

async function proxy(request:Request){
  const incoming=new URL(request.url);
  const target=new URL('/api/workspace',BACKEND);
  const headers=new Headers();
  const cookie=request.headers.get('cookie');
  if(cookie) headers.set('cookie',cookie);
  const contentType=request.headers.get('content-type');
  if(contentType) headers.set('content-type',contentType);
  headers.set('accept','application/json');
  headers.set('origin',BACKEND);
  headers.set('sec-fetch-site','same-origin');
  const init:RequestInit={method:request.method,headers,redirect:'manual',cache:'no-store'};
  if(request.method!=='GET'&&request.method!=='HEAD') init.body=await request.arrayBuffer();
  const upstream=await fetch(target,init);
  const outHeaders=new Headers();
  outHeaders.set('content-type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
  outHeaders.set('cache-control','no-store');
  return new Response(upstream.body,{status:upstream.status,headers:outHeaders});
}

export const dynamic='force-dynamic';
export async function GET(request:Request){return proxy(request);}
export async function POST(request:Request){return proxy(request);}
