
import {EventEmitter} from 'node:events';
import type {Server} from 'node:http';
import {pino} from 'pino';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {createShutdown} from '../src/shutdown.js';
import {deferred} from './http-fixtures.js';
afterEach(()=>vi.useRealTimers());
describe('HTTP shutdown',()=>{
 it('closes HTTP but drains client work beyond the deadline without pretending it stopped',async()=>{vi.useFakeTimers();const server=Object.assign(new EventEmitter(),{close:vi.fn<(cb:(error?:Error)=>void)=>void>(),closeAllConnections:vi.fn()});const pending=deferred<void>(),client={stop:vi.fn(()=>pending.promise)},exit=vi.fn();const shutdown=createShutdown(server as unknown as Server,client,pino({level:'silent'}),exit);let done=false;const work=shutdown('SIGTERM').then(()=>{done=true;});expect(shutdown('SIGINT')).toBe(shutdown('SIGTERM'));expect(client.stop).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(10000);expect(server.closeAllConnections).toHaveBeenCalledOnce();expect(exit).toHaveBeenCalledWith(1);expect(done).toBe(false);server.close.mock.calls[0]![0]();pending.resolve();await work;expect(done).toBe(true);expect(exit).toHaveBeenLastCalledWith(1);});
});
