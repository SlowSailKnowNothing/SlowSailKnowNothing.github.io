import {requestRoute} from '../lib/request-route.js';
import {readFile} from 'node:fs/promises';
import {config,session,sameOrigin,login,callback,cookie,SESSION_COOKIE,STATE_COOKIE} from '../lib/auth.js';
import {githubStore,storeConfig,MAX_BYTES} from '../lib/github-store.js';
import {readingCards} from '../lib/reading-api.js';
export function createHandler({env=process.env,fetcher=fetch}={}){
 let publicCache=null,cacheGeneration=0;
 async function publicRecord(){
  if(publicCache&&publicCache.expires>Date.now())return publicCache.value;
  const generation=cacheGeneration;const value=await githubStore(storeConfig(env),fetcher).read();if(generation===cacheGeneration)publicCache={value,expires:Date.now()+15000};return value;
 }
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  const redirect=(url)=>{res.statusCode=302;res.setHeader('Location',url);res.end();};
  let cfg;
  try{
   const {url,route}=requestRoute(req);
   const allowedMethods={'reading/cards':['GET'],'data/today.json':['GET'],'data/reading.json':['GET'],'public/content':['GET'],'auth/login':['GET'],'auth/callback':['GET'],'auth/session':['GET'],'auth/logout':['POST'],'admin':['GET'],'admin/content':['GET','PUT'],'admin/history':['GET'],'admin/rollback':['POST']}[route];
   if(!allowedMethods)return send(404,{error:'route_not_found'});
   if(!allowedMethods.includes(req.method)){res.setHeader('Allow',allowedMethods.join(', '));return send(405,{error:'method_not_allowed'});}
   if(route==='reading/cards'&&req.method==='GET'){const response=await readingCards(url);res.statusCode=response.status;for(const [key,value] of response.headers)res.setHeader(key,value);return res.end(await response.text());}
   if(['/data/today.json','/data/reading.json'].includes(url.pathname)&&req.method==='GET'){const record=await publicRecord();res.setHeader('Cache-Control','public, max-age=0, s-maxage=15');return send(200,record.data[url.pathname.includes('today')?'today':'reading']);}
   if(route==='public/content'&&req.method==='GET'){const record=await publicRecord();res.setHeader('Cache-Control','public, max-age=0, s-maxage=15');return send(200,record);}
   cfg=config(env);
   if(route==='auth/login'&&req.method==='GET'){const value=login(cfg);res.setHeader('Set-Cookie',value.cookie);return redirect(value.url);}
   if(route==='auth/callback'&&req.method==='GET'){
    res.setHeader('Set-Cookie',cookie(STATE_COOKIE,'',0));const value=await callback(req,cfg,url.searchParams,fetcher);res.setHeader('Set-Cookie',[cookie(STATE_COOKIE,'',0),value]);return redirect(cfg.origin+'/admin');
   }
   if(route==='admin'&&req.method==='GET'){
    if(!session(req,cfg))return redirect(cfg.origin+'/api/auth/login');
    const html=await readFile(new URL('../public/admin/index.html',import.meta.url),'utf8');res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");return res.end(html);
   }
   if(!session(req,cfg))return send(401,{error:'sign_in_required'});
   if(route==='auth/session'&&req.method==='GET')return send(200,{authenticated:true});
   if(!['GET','HEAD'].includes(req.method)&&!sameOrigin(req,cfg))return send(403,{error:'same_origin_required'});
   if(route==='auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',cookie(SESSION_COOKIE,'',0));return send(200,{signedOut:true});}
   const store=githubStore(storeConfig(env),fetcher);
   if(route==='admin/content'&&req.method==='GET')return send(200,await store.read());
   if(route==='admin/history'&&req.method==='GET')return send(200,{versions:await store.history()});
   if((route==='admin/content'&&req.method==='PUT')||(route==='admin/rollback'&&req.method==='POST')){
    if((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return send(415,{error:'json_required'});
    if(Number(req.headers['content-length']||0)>MAX_BYTES)return send(413,{error:'request_too_large'});
    let body=req.body;if(typeof body==='string'){if(Buffer.byteLength(body)>MAX_BYTES)return send(413,{error:'request_too_large'});try{body=JSON.parse(body);}catch{return send(400,{error:'invalid_json'});}}
    if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>MAX_BYTES)return send(400,{error:'invalid_request'});
    const allowed=route==='admin/content'?['data','expectedVersion','publicReviewConfirmed']:['commit','expectedVersion','publicReviewConfirmed'];if(Object.keys(body).some(k=>!allowed.includes(k))||body.publicReviewConfirmed!==true)return send(400,{error:'public_review_required'});
    const value=route==='admin/content'?await store.write(body.data,body.expectedVersion):await store.rollback(body.commit,body.expectedVersion);cacheGeneration++;publicCache=null;return send(200,value);
   }
   return send(404,{error:'route_not_found'});
  }catch(error){const safe=new Set(['invalid_query','sign_in_required','oauth_invalid_state','oauth_failed','oauth_scope_mismatch','owner_only','storage_not_configured','version_conflict','content_not_found','storage_unavailable','invalid_stored_content','invalid_version','invalid_content','content_too_large','write_outcome_uncertain','invalid_history','invalid_commit','rollback_version_not_listed']);return send(error.status||(error.message==='owner_only'?403:error.message?.startsWith('oauth_')?400:503),{error:safe.has(error.message)?error.message:'service_unavailable'});}
 };
}
export default createHandler();
