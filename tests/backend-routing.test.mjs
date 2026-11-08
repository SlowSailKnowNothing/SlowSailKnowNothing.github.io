import test from 'node:test';import assert from 'node:assert/strict';
import {createHandler} from '../api/index.js';
import {requestRoute} from '../lib/request-route.js';
import {paginateReading} from '../lib/reading-api.js';
async function invoke(url,query){const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};await createHandler({env:{},fetcher:async()=>{throw new Error('No upstream allowed');}})({url,query,method:'GET',headers:{}},res);return res;}
test('Vercel source URL and rewritten destination consume only matching route captures',async()=>{
 const cases=[['/api/reading/cards?limit=1&route=reading/cards'],['/api/index?route=reading/cards&limit=1'],['/api/reading/cards?limit=1',{limit:'1',route:'reading/cards'}],['/api/index?limit=1',{limit:'1',route:'reading/cards'}],['/api/index?route=reading/cards&limit=1',{route:'reading/cards',limit:'1'}],['/api/reading/cards?limit=1',{limit:['1'],route:['reading/cards']}],['/api/reading/cards?limit=1']];
 for(const [url,query]of cases){const response=await invoke(url,query);assert.equal(response.statusCode,200,url);const data=JSON.parse(response.body);assert.equal(data.items.length,1);assert.ok(data.snapshotTotal>=1);}
});
test('routing metadata never loosens business unknown/duplicate query validation',async()=>{
 for(const [url,query]of [['/api/reading/cards?limit=1&unknown=x'],['/api/reading/cards?limit=1&limit=2'],['/api/reading/cards?route=admin/content'],['/api/reading/cards?path=admin/content'],['/api/reading/cards?path=reading/cards'],['/api/reading/cards?path=reading/cards&path=reading/cards'],['/api/index?route=reading/cards&route=admin/content'],['/api/reading/cards?limit=1',{limit:'2'}],['/api/reading/cards',{path:['reading','cards']}],['/api/reading/cards',{unknown:'x'}],['/api/reading/cards',{limit:1}]]){const response=await invoke(url,query);assert.equal(response.statusCode,400,url);assert.deepEqual(JSON.parse(response.body),{error:'invalid_query'});}
 assert.throws(()=>paginateReading({},new URL('https://site.test/?route=reading/cards')),/invalid_query/);
 assert.throws(()=>paginateReading({},new URL('https://site.test/?path=reading/cards')),/invalid_query/);
});
test('data/admin/callback routing preserves legitimate business state and fixed path',()=>{
 assert.equal(requestRoute({url:'/data/today.json?route=data/today.json'}).url.pathname,'/data/today.json');
 assert.equal(requestRoute({url:'/api/index?route=admin'}).route,'admin');
 const x=requestRoute({url:'/api/auth/callback?code=test-code&state=test-state',query:{route:'auth/callback',code:'test-code',state:'test-state'}});assert.equal(x.url.search,'?code=test-code&state=test-state');
});

test('Vercel config uses explicit API literals without wildcard capture',async()=>{const {readFile}=await import('node:fs/promises');const cfg=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));const api=cfg.rewrites.filter(x=>x.source.startsWith('/api/'));assert.equal(api.length,9);for(const r of api){assert.ok(!r.source.includes(':'));assert.ok(!r.source.includes('*'));assert.equal(r.destination,'/api/index?route='+r.source.slice(5));}});
