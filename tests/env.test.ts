
import {describe,it,expect} from 'vitest';
import {parseEnv} from '../src/config/env.js';
import {config,secret,token} from './http-fixtures.js';
describe('HTTP integration configuration',()=>{
 it('starts with integrations unconfigured and ignores retired settings',()=>{const c=parseEnv({RABBITMQ_ENABLED:'invalid',RABBITMQ_URL:'invalid'});expect(c.port).toBe(4102);expect(c.rita).toEqual({});expect(c).not.toHaveProperty('rabbitmq');});
 it('uses valid independent credentials',()=>{expect(config.rita.webhookSecret).toBe(secret);expect(config.demoApiToken).toBe(token);});
 it.each(['',' ','0','-1','65536','1.5','invalid'])('rejects invalid port%s',PORT=>{expect(()=>parseEnv({PORT})).toThrow('PORT');});
 it.each([{NODE_ENV:'private'},{LOG_LEVEL:'private'},{RITA_INTEGRATION_API_KEY:'private'},{RITA_WEBHOOK_SIGNING_SECRET:'private'},{DEMO_API_TOKEN:'private'},{RITA_API_BASE_URL:''},{RITA_API_BASE_URL:'https://user:private@example.test/'},{RITA_API_BASE_URL:'https://example.test/?secret=private'},{RITA_API_BASE_URL:'https://example.test/#private'},{RITA_API_BASE_URL:'http://example.test/'},{RITA_API_BASE_URL:'file:///private'}])('sanitizes invalid declared configuration%j',patch=>{expect(()=>parseEnv(patch)).toThrow('Invalid environment');try{parseEnv(patch);}catch(e){expect(String(e)).not.toContain('private');}});
 it.each(['http://localhost:4000/api/','http://127.0.0.1:4000','http://[::1]:4000'])('accepts loopback%s only in development/test',url=>{expect(parseEnv({NODE_ENV:'test',RITA_API_BASE_URL:url}).rita.apiBaseUrl).toBe(url);expect(()=>parseEnv({NODE_ENV:'production',RITA_API_BASE_URL:url})).toThrow('RITA_API_BASE_URL');});
});
