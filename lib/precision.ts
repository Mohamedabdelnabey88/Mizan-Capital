export const MONEY_SCALE=100000n;
export type Micro=bigint;
export function parseMicro(value:string|number|bigint):Micro{const s=String(value).trim().replace(/,/g,'');if(!/^\d+(?:\.\d{1,5})?$/.test(s))throw Error('المبلغ يجب أن يحتوي على 5 منازل عشرية كحد أقصى.');const [a,b='']=s.split('.');return BigInt(a)*MONEY_SCALE+BigInt((b+'00000').slice(0,5));}
export function formatMicro(v:Micro,decimals=5){const sign=v<0n?'-':'';const n=v<0n?-v:v;const whole=n/MONEY_SCALE;const frac=(n%MONEY_SCALE).toString().padStart(5,'0').slice(0,decimals);return decimals?sign+whole.toString()+'.'+frac:sign+whole.toString();}
export function addMicro(...xs:Micro[]):Micro{return xs.reduce((a,b)=>a+b,0n);}
export function subMicro(a:Micro,b:Micro):Micro{return a-b;}
export function mulBps(v:Micro,bps:bigint):Micro{return (v*bps)/10000n;}
export function halfUpDiv(a:Micro,b:bigint):Micro{if(b<=0n)throw Error('المقام يجب أن يكون موجبًا.');const q=a/b,r=a%b;return r*2n>=b?q+1n:q;}
export function microFromHalala(halala:number):Micro{if(!Number.isSafeInteger(halala))throw Error('قيمة الهللات غير صحيحة.');return BigInt(halala)*1000n;}
export function halalaFromMicro(v:Micro):number{return Number(halfUpDiv(v,1000n));}
