import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
export const SESSION_COOKIE='__Host-personal_session';
export const STATE_COOKIE='__Host-personal_oauth';
export function config(env=process.env){
  const origin=new URL(env.APP_ORIGIN||'invalid');
  if(origin.protocol!=='https:'||origin.origin!==env.APP_ORIGIN)throw new Error('configuration_invalid');
  if(!/^\d+$/.test(env.GITHUB_OWNER_ID||'')||!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||Buffer.byteLength(env.SESSION_SECRET||'')<32)throw new Error('configuration_invalid');
  return {origin:origin.origin,ownerId:env.GITHUB_OWNER_ID,clientId:env.GITHUB_CLIENT_ID,clientSecret:env.GITHUB_CLIENT_SECRET,secret:env.SESSION_SECRET};
}
const signature=(value,secret)=>createHmac('sha256',secret).update(value).digest('base64url');
export function sign(value,secret){const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return payload+'.'+signature(payload,secret);}
export function verify(token,secret,now=Date.now()){
  try{if(typeof token!=='string'||token.length>2048)return null;const [payload,sig,...rest]=token.split('.');if(rest.length||!sig)return null;const expected=Buffer.from(signature(payload,secret));const supplied=Buffer.from(sig);if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return null;const value=JSON.parse(Buffer.from(payload,'base64url'));return Number.isSafeInteger(value.exp)&&value.exp>now?value:null;}catch{return null;}
}
export function cookies(req){const map={};for(const pair of (req.headers.cookie||'').split(';')){const at=pair.indexOf('=');if(at>0){const name=pair.slice(0,at).trim();if(Object.hasOwn(map,name))return {};map[name]=pair.slice(at+1).trim();}}return map;}
export function cookie(name,value,maxAge){return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;}
export function session(req,cfg,now=Date.now()){const value=verify(cookies(req)[SESSION_COOKIE],cfg.secret,now);return value?.kind==='session'&&value.id===cfg.ownerId?value:null;}
export function sameOrigin(req,cfg){return req.headers.origin===cfg.origin;}
export function login(cfg,now=Date.now()){
 const state=randomBytes(32).toString('base64url');const url=new URL('https://github.com/login/oauth/authorize');url.search=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.origin+'/api/auth/callback',scope:'read:user',state}).toString();
 return {url:url.href,cookie:cookie(STATE_COOKIE,sign({kind:'state',nonce:state,exp:now+600000},cfg.secret),600)};
}
export async function callback(req,cfg,query,fetcher=fetch,now=Date.now()){
 const state=verify(cookies(req)[STATE_COOKIE],cfg.secret,now);const incoming=query.getAll('state');const codes=query.getAll('code');
 if(state?.kind!=='state'||incoming.length!==1||incoming[0]!==state.nonce||codes.length!==1||!codes[0]||codes[0].length>512)throw new Error('oauth_invalid_state');
 const result=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:cfg.clientId,client_secret:cfg.clientSecret,code:codes[0],redirect_uri:cfg.origin+'/api/auth/callback'}),signal:AbortSignal.timeout(10000)});
 if(!result.ok)throw new Error('oauth_failed');const token=await result.json();if(typeof token.access_token!=='string'||!token.access_token||token.token_type?.toLowerCase()!=='bearer')throw new Error('oauth_failed');
 if(typeof token.scope!=='string'||token.scope.split(/[ ,]+/).filter(Boolean).some(scope=>scope!=='read:user'))throw new Error('oauth_scope_mismatch');
 const userResponse=await fetcher('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token.access_token}`,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)throw new Error('oauth_failed');const user=await userResponse.json();if(String(user.id)!==cfg.ownerId)throw new Error('owner_only');
 return cookie(SESSION_COOKIE,sign({kind:'session',id:cfg.ownerId,exp:now+3600000},cfg.secret),3600);
}
