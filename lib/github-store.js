import {validatePublicSite} from './content-schema.js';
export const CONTENT_PATH='content/public-site.json';
export const MAX_BYTES=1000000;
export class StoreError extends Error{constructor(code,status=503){super(code);this.status=status;}}
export function storeConfig(env=process.env){
 if(!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(env.GITHUB_CONTENT_REPO||'')||!env.GITHUB_CONTENT_BRANCH||env.GITHUB_CONTENT_BRANCH.length>200||!env.GITHUB_CONTENT_TOKEN)throw new StoreError('storage_not_configured');
 return {repo:env.GITHUB_CONTENT_REPO,branch:env.GITHUB_CONTENT_BRANCH,token:env.GITHUB_CONTENT_TOKEN};
}
export function githubStore(cfg,fetcher=fetch){
 const base=`https://api.github.com/repos/${cfg.repo}`;
 async function request(path,options={}){
  const r=await fetcher(base+path,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${cfg.token}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new StoreError(r.status===409||r.status===422?'version_conflict':r.status===404?'content_not_found':'storage_unavailable',r.status===409||r.status===422?409:r.status===404?404:503);
  return r.json();
 }
 async function read(ref=cfg.branch){
  const record=await request(`/contents/${CONTENT_PATH}?ref=${encodeURIComponent(ref)}`);
  if(record.type!=='file'||record.encoding!=='base64'||record.size>MAX_BYTES||typeof record.content!=='string'||!validSha(record.sha))throw new StoreError('invalid_stored_content');
  const bytes=Buffer.from(record.content,'base64');if(bytes.length>MAX_BYTES)throw new StoreError('invalid_stored_content');
  let data;try{data=validatePublicSite(JSON.parse(bytes.toString('utf8')));}catch{throw new StoreError('invalid_stored_content');}
  return {version:record.sha,data};
 }
 async function write(data,expectedVersion,message='Update public site content'){
  if(!validSha(expectedVersion))throw new StoreError('invalid_version',400);
  let normalized;try{normalized=validatePublicSite(data);}catch{throw new StoreError('invalid_content',400);}
  const bytes=Buffer.from(JSON.stringify(normalized,null,2)+'\n');if(bytes.length>MAX_BYTES)throw new StoreError('content_too_large',413);
  const current=await read();if(current.version!==expectedVersion)throw new StoreError('version_conflict',409);
  let result;try{result=await request(`/contents/${CONTENT_PATH}`,{method:'PUT',body:JSON.stringify({message,branch:cfg.branch,sha:expectedVersion,content:bytes.toString('base64')})});}catch(error){if(error instanceof StoreError&&[409,404].includes(error.status))throw error;throw new StoreError('write_outcome_uncertain');}
  if(!validSha(result.content?.sha)||!validSha(result.commit?.sha))throw new StoreError('write_outcome_uncertain');
  return {version:result.content.sha,commit:result.commit.sha,data:normalized};
 }
 async function history(){const records=await request(`/commits?path=${encodeURIComponent(CONTENT_PATH)}&sha=${encodeURIComponent(cfg.branch)}&per_page=30`);if(!Array.isArray(records))throw new StoreError('invalid_history');return records.map(c=>({commit:c.sha,date:c.commit?.committer?.date||null})).filter(c=>validSha(c.commit));}
 async function rollback(commit,expectedVersion){if(!validSha(commit))throw new StoreError('invalid_commit',400);const versions=await history();if(!versions.some(v=>v.commit===commit))throw new StoreError('rollback_version_not_listed',400);const old=await read(commit);return write(old.data,expectedVersion,'Restore public site content version');}
 return {read,write,history,rollback};
}
export const validSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
