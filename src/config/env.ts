
import dotenv from 'dotenv';
import { z } from 'zod';
const schema = z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 PORT:z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535)).default(4102),
 LOG_LEVEL:z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
 RITA_API_BASE_URL:z.string().optional(),
 RITA_INTEGRATION_API_KEY:z.string().regex(/^rik_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{64}$/).optional(),
 RITA_WEBHOOK_SIGNING_SECRET:z.string().refine(v=>/^whsec_[A-Za-z0-9+/]{43}=$/.test(v)&&Buffer.from(v.slice(6),'base64').toString('base64')===v.slice(6)).optional(),
 DEMO_API_TOKEN:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
}).superRefine((v,ctx)=>{
 if(v.RITA_API_BASE_URL!==undefined){try{
   const u=new URL(v.RITA_API_BASE_URL);const loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
   if(u.username||u.password||u.search||u.hash||(u.protocol!=='https:'&&!(u.protocol==='http:'&&v.NODE_ENV!=='production'&&loopback)))throw Error();
 }catch{ctx.addIssue({code:'custom',path:['RITA_API_BASE_URL'],message:'Invalid API base URL'});}}
});
export interface AppConfig {
 nodeEnv:'development'|'test'|'production';port:number;logLevel:z.infer<typeof schema>['LOG_LEVEL'];
 rita:{apiBaseUrl?:string;apiKey?:string;webhookSecret?:string};demoApiToken?:string;
}
export function parseEnv(input:Record<string,string|undefined>):AppConfig{
 const r=schema.safeParse(input);if(!r.success)throw Error('Invalid environment configuration: '+[...new Set(r.error.issues.map(i=>i.path.join('.')))].join(', ')+'.');
 return {nodeEnv:r.data.NODE_ENV,port:r.data.PORT,logLevel:r.data.LOG_LEVEL,rita:{apiBaseUrl:r.data.RITA_API_BASE_URL,apiKey:r.data.RITA_INTEGRATION_API_KEY,webhookSecret:r.data.RITA_WEBHOOK_SIGNING_SECRET},demoApiToken:r.data.DEMO_API_TOKEN};
}
export function loadConfig():AppConfig{dotenv.config({quiet:true});return parseEnv(process.env);}
