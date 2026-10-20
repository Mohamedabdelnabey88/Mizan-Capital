import {NextResponse} from 'next/server';

const BACKEND='https://mizan-capital.famaradona89.workers.dev';

// Browser navigation to this endpoint must always land on the real login page.
export async function GET(){
  return NextResponse.redirect(new URL('/login', 'https://mizan-capital.vercel.app'), 302);
}
export async function POST(request:Request){
 if(process.env.VERCEL_ENV==='preview')return Response.json({error:'نسخة المعاينة غير متصلة بقاعدة اختبار مستقلة. لم يتم الاتصال ببيانات الدخول.'},{status:503,headers:{'Cache-Control':'no-store'}});
 const upstream=await fetch(BACKEND+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:await request.text(),redirect:'manual',cache:'no-store'});
 const headers=new Headers({'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
 const cookie=upstream.headers.get('set-cookie'); if(cookie) headers.set('set-cookie',cookie);
 return new Response(upstream.body,{status:upstream.status,headers});
}