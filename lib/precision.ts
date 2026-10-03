export const MONEY_SCALE=10000BigInt(0);
export type Micro=bigint;
export function parseMicro(value:string|number|bigint):Micro{const s=String(value).trim().replace(/,/g,'');if(!/^\d+(?:\.\d{1,5})?$/.test(s))throw Error('المبلغ يجب أن يحتوي على 5 منازل عشرية كحد أقصى.');const [a,b='']=s.split('.');return BigInt(a)*MONEY_SCALE+BigInt((b+'00000').slice(0,5));}
export function formatMicro(v:Micro,decimals=5){const sign=v<BigInt(0)?'-':'';const n=v<BigInt(0)?-v:v;const whole=n/MONEY_SCALE;const frac=(n%MONEY_SCALE).toString().padStart(5,'0').slice(0,decimals);return decimals?sign+whole.toString()+'.'+frac:sign+whole.toString();}
export function addMicro(...xs:Micro[]):Micro{return xs.reduce((a,b)=>a+b,BigInt(0));}
export function subMicro(a:Micro,b:Micro):Micro{return a-b;}
export function mulBps(v:Micro,bps:bigint):Micro{return (v*bps)/1000BigInt(0);}
export function halfUpDiv(a:Micro,b:bigint):Micro{if(b<=BigInt(0))throw Error('المقام يجب أن يكون موجبًا.');const q=a/b,r=a%b;return r*BigInt(2)>=b?q+BigInt(1):q;}
export function microFromHalala(halala:number):Micro{if(!Number.isSafeInteger(halala))throw Error('قيمة الهللات غير صحيحة.');return BigInt(halala)*100BigInt(0);}
export function halalaFromMicro(v:Micro):number{return Number(halfUpDiv(v,100BigInt(0)));}
