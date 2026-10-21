const BACKEND='https://mizan-capital.famaradona89.workers.dev';
const UPSTREAM_TIMEOUT_MS=12000;

async function proxy(request:Request){
  // Fail closed: Vercel preview must never read or mutate the production D1 workspace.
  if(process.env.VERCEL_ENV==='preview')return Response.json({error:'نسخة المعاينة غير متصلة بقاعدة اختبار مستقلة. لم يتم الاتصال بالبيانات المالية.'},{status:503,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='GET'&&request.method!=='HEAD'){
    // This endpoint is a browser-facing proxy: writes must carry the exact same Origin.
    let sameOrigin=false;
    try{const origin=request.headers.get('origin');sameOrigin=!!origin&&new URL(origin).origin===new URL(request.url).origin;}catch{sameOrigin=false;}
    if(!sameOrigin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'طلب غير مسموح'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  try{
    const target=new URL('/api/workspace',BACKEND);
    const headers=new Headers();
    const cookie=request.headers.get('cookie');
    if(cookie) headers.set('cookie',cookie);
    const contentType=request.headers.get('content-type');
    if(contentType) headers.set('content-type',contentType);
    headers.set('accept','application/json');
    headers.set('origin',BACKEND);
    headers.set('sec-fetch-site','same-origin');
    const init:RequestInit={method:request.method,headers,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)};
    if(request.method!=='GET'&&request.method!=='HEAD') init.body=await request.arrayBuffer();
    const upstream=await fetch(target,init);
    const outHeaders=new Headers();
    outHeaders.set('content-type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
    outHeaders.set('cache-control','no-store');
    const setCookie=upstream.headers.get('set-cookie');
    if(setCookie) outHeaders.set('set-cookie',setCookie);
    return new Response(upstream.body,{status:upstream.status,headers:outHeaders});
  }catch(error){
    // Keep an upstream outage/timeout inside the API contract instead of letting it
    // become an opaque framework error page.
    const timedOut=error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError');
    return Response.json(
      {error:timedOut?'الخادم المالي استغرق وقتًا أطول من المعتاد. حاول مرة أخرى.':'تعذر الاتصال بالخادم المالي. حاول مرة أخرى.'},
      {status:503,headers:{'Cache-Control':'no-store'}}
    );
  }
}

export const dynamic='force-dynamic';
export async function GET(request:Request){return proxy(request);}
export async function POST(request:Request){return proxy(request);}
