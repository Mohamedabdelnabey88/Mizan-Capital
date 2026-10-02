import {env} from 'cloudflare:workers';
export function database():D1Database {if(!env.DB) throw new Error('قاعدة البيانات غير متاحة الآن. حاول مجددًا.');return env.DB;}
