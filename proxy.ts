import {NextResponse} from 'next/server'; import type {NextRequest} from 'next/server';
export function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 if(path==='/login'||path.startsWith('/api/auth/')||path.startsWith('/_next/')||path==='/favicon.ico')return NextResponse.next();
 if(!request.cookies.get('mizan_session')){const url=request.nextUrl.clone();url.pathname='/login';url.search='';return NextResponse.redirect(url);}
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image).*)']};