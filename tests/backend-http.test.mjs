// Local HTTP integration only. GitHub is a controlled mock, not a production OAuth test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHandler} from '../api/index.js';
import {STATE_COOKIE,SESSION_COOKIE} from '../lib/auth.js';
const env={APP_ORIGIN:'https://personal.example',GITHUB_OWNER_ID:'20365958',GITHUB_CLIENT_ID:'local-test-client',GITHUB_CLIENT_SECRET:'local-test-secret',SESSION_SECRET:'synthetic-test-session-secret-'.repeat(3),GITHUB_CONTENT_REPO:'example/public-site',GITHUB_CONTENT_BRANCH:'main',GITHUB_CONTENT_TOKEN:'synthetic-test-content-token'};
async function setup(t){
 let owner=20365958,upstreamCalls=0;
 const fetcher=async(url,options)=>{
  upstreamCalls++;
  if(url==='https://github.com/login/oauth/access_token'){
   assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.redirect_uri,env.APP_ORIGIN+'/api/auth/callback');assert.equal(body.code,'synthetic-code');
   return {ok:true,json:async()=>({access_token:'synthetic-transient-oauth-token',token_type:'bearer',scope:'read:user'})};
  }
  if(url==='https://api.github.com/user'){assert.equal(options.headers.Authorization,'Bearer synthetic-transient-oauth-token');return {ok:true,json:async()=>({id:owner})};}
  throw new Error('Unexpected upstream request');
 };
 const handler=createHandler({env,fetcher});
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=Buffer.concat(chunks).toString('utf8');await handler(req,res);}catch{res.statusCode=500;res.end('Test adapter error');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port;
 const call=(path,options={})=>fetch(origin+path,{redirect:'manual',...options});
 // Test harness forwards Secure cookie headers explicitly. It does not weaken the
 // application, fake a signed session, or claim browser cookie-policy coverage.
 async function start(){const response=await call('/api/index?route=auth/login');assert.equal(response.status,302);const redirect=new URL(response.headers.get('location'));assert.equal(redirect.origin,'https://github.com');assert.equal(redirect.pathname,'/login/oauth/authorize');assert.equal(redirect.searchParams.get('scope'),'read:user');assert.equal(redirect.searchParams.get('redirect_uri'),env.APP_ORIGIN+'/api/auth/callback');const setCookie=response.headers.getSetCookie()[0];assert.match(setCookie,new RegExp('^'+STATE_COOKIE+'='));assert.match(setCookie,/Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/);return {state:redirect.searchParams.get('state'),cookie:setCookie.split(';')[0]};}
 const finish=({state,cookie})=>call('/api/index?route=auth/callback&code=synthetic-code&state='+encodeURIComponent(state),{headers:{Cookie:cookie}});
 return {call,start,finish,setOwner:id=>{owner=id;},calls:()=>upstreamCalls};
}
test('local HTTP + mocked GitHub: login callback issues secure owner session and gates real routes',async t=>{
 const h=await setup(t);const start=await h.start();const callback=await h.finish(start);assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),env.APP_ORIGIN+'/admin');assert.equal(callback.headers.get('cache-control'),'no-store');
 const cookies=callback.headers.getSetCookie();assert.ok(cookies.some(c=>c.startsWith(STATE_COOKIE+'=;')&&c.includes('Max-Age=0')));const session=cookies.find(c=>c.startsWith(SESSION_COOKIE+'='));assert.ok(session);assert.match(session,/Secure; HttpOnly; SameSite=Lax; Max-Age=3600/);assert.ok(!cookies.join(' ').includes('synthetic-transient-oauth-token'));const headers={Cookie:session.split(';')[0]};
 const status=await h.call('/api/index?route=auth/session',{headers});assert.equal(status.status,200);assert.deepEqual(await status.json(),{authenticated:true});
 const admin=await h.call('/admin',{headers});assert.equal(admin.status,200);assert.match(admin.headers.get('content-type'),/text\/html/);assert.match(await admin.text(),/<html/);assert.equal(admin.headers.get('cache-control'),'no-store');
 const forged=await h.call('/admin',{headers:{'oai-authenticated-user-id':env.GITHUB_OWNER_ID}});assert.equal(forged.status,302);assert.equal(forged.headers.get('location'),env.APP_ORIGIN+'/api/auth/login');
 const blocked=await h.call('/api/index?route=admin/content',{method:'PUT',headers:{...headers,Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({publicReviewConfirmed:true})});assert.equal(blocked.status,403);assert.deepEqual(await blocked.json(),{error:'same_origin_required'});assert.equal(h.calls(),2);
});
test('local HTTP + mocked GitHub: bad or absent state rejects before token exchange',async t=>{
 const h=await setup(t);const start=await h.start();for(const input of [{...start,state:'wrong-state'},{...start,cookie:''}]){const response=await h.finish(input);assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'oauth_invalid_state'});assert.ok(!response.headers.getSetCookie().some(c=>c.startsWith(SESSION_COOKIE+'=')));}assert.equal(h.calls(),0);
});
test('local HTTP + mocked GitHub: another GitHub account receives no session',async t=>{
 const h=await setup(t);h.setOwner(999999);const response=await h.finish(await h.start());assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'owner_only'});assert.ok(!response.headers.getSetCookie().some(c=>c.startsWith(SESSION_COOKIE+'=')));assert.equal(h.calls(),2);const page=await h.call('/api/index?route=admin');assert.equal(page.status,302);
});
