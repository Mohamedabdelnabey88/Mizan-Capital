/** Verify Access at the origin: never trust a caller-supplied identity header. */
export type AccessEnvironment = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  MEMBER_EMAILS?: string;
};
type AccessKey = JsonWebKey & {kid?: string};
const keyCache = new Map<string,{keys:AccessKey[];expires:number}>();
export class AccessError extends Error {
  constructor(public status:number,message:string){super(message);}
}
function decode(value:string){
  if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid encoding');
  const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function parsePart(value:string){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(value)));}
export async function verifyAccess(request:Request,env:AccessEnvironment):Promise<{workspace:string;email:string}>{
  const domain=env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const audience=env.ACCESS_AUD?.trim();
  const owner=env.OWNER_EMAIL?.trim().toLowerCase();
  const members=[...new Set((env.MEMBER_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];
  if(members.length>2||members.some(email=>!/^\S+@\S+\.\S+$/.test(email)))throw new AccessError(503,'إعداد حسابات الفريق غير صحيح.');
  if(!domain||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)||!audience||!owner||!/^\S+@\S+\.\S+$/.test(owner)){
    throw new AccessError(503,'إعداد الدخول لم يكتمل. يرجى إعداد Cloudflare Access والبريد المسموح به.');
  }
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||token.length>16000)throw new AccessError(401,'سجل الدخول للوصول إلى بياناتك.');
  try{
    const parts=token.split('.');if(parts.length!==3)throw Error('Invalid token');
    const header=parsePart(parts[0]),claims=parsePart(parts[1]);
    if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('Invalid algorithm');
    const now=Math.floor(Date.now()/1000);
    if(claims.iss!==domain||!Array.isArray(claims.aud)||!claims.aud.includes(audience)||
       !Number.isSafeInteger(claims.exp)||claims.exp<=now||
       !Number.isSafeInteger(claims.iat)||claims.iat>now+30||claims.iat>=claims.exp||
       (claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+30))||
       typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string')throw Error('Invalid claims');
    let cached=keyCache.get(domain);
    if(!cached||cached.expires<=Date.now()){
      let response:Response;
      try{response=await fetch(domain+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000),redirect:'manual'});}
      catch{throw new AccessError(503,'تعذر التحقق من تسجيل الدخول. حاول مجددًا.');}
      if(!response.ok)throw new AccessError(503,'تعذر التحقق من تسجيل الدخول. حاول مجددًا.');
      const body=await response.json() as {keys?:AccessKey[]};
      if(!Array.isArray(body.keys)||body.keys.length>20)throw new AccessError(503,'تعذر التحقق من تسجيل الدخول. حاول مجددًا.');
      cached={keys:body.keys,expires:Date.now()+60000};keyCache.set(domain,cached);
    }
    const jwk=cached.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
    if(!jwk)throw Error('Unknown key');
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Invalid signature');
    const email=claims.email.trim().toLowerCase();
    if(email!==owner&&!members.includes(email))throw new AccessError(403,'هذا الحساب غير مسموح له بالدخول إلى ميزان.');
    // Keep the existing workspace stable; actor identity is separate from data ownership.
    return {workspace:'cloudflare-owner',email};
  }catch(error){
    if(error instanceof AccessError)throw error;
    throw new AccessError(401,'انتهت الجلسة أو تعذر التحقق منها. سجل الدخول مجددًا.');
  }
}
