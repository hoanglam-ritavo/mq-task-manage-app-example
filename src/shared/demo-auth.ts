
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors/app-error.js';
export const demoAuth=(token:string|undefined):RequestHandler=>(req,_res,next)=>{
 if(!token) return next(new AppError(503,'DEMO_NOT_CONFIGURED','Demo API is not configured.'));
 const auth=req.get('authorization');
 const count=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i]?.toLowerCase()==='authorization').length;
 if(count!==1||!auth?.startsWith('Bearer ')||!timingSafeEqual(createHash('sha256').update(auth.slice(7)).digest(),createHash('sha256').update(token).digest()))return next(new AppError(401,'DEMO_UNAUTHORIZED','Invalid demo credentials.'));
 next();
};
