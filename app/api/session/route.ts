const BACKEND='https://mizan-capital.famaradona89.workers.dev';
export async function GET(request:Request){
 if(process.env.VERCEL_ENV==='preview')return Response.json({error:'نسخة المعاينة غير متصلة بقاعدة اختبار مستقلة.'},{status:503,headers:{'Cache-Control':'no-store'}});
 const upstream=await fetch(BACKEND+'/api/session',{headers:{cookie:request.headers.get('cookie')||''},cache:'no-store'});
 return new Response(upstream.body,{status:upstream.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
}