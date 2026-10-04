import {NextResponse} from 'next/server';

const BACKEND='https://mizan-capital.famaradona89.workers.dev';

// Browser navigation to this endpoint must always land on the real login page.
export async function GET(){
  return NextResponse.redirect(new URL('/login', 'https://mizan-capital.vercel.app'), 302);
}
export async function POST(request:Request){
 const upstream=await fetch(BACKEND+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:await request.text(),redirect:'manual',cache:'no-store'});
 const headers=new Headers({'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
 const cookie=upstream.headers.get('set-cookie'); if(cookie) headers.set('set-cookie',cookie);
 return new Response(upstream.body,{status:upstream.status,headers});
}