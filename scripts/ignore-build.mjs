import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const shouldSkipBuild=files=>files.length>0&&files.every(file=>file==='content/public-site.json');
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const before=process.env.VERCEL_GIT_PREVIOUS_SHA,after=process.env.VERCEL_GIT_COMMIT_SHA;
 if(!/^[a-f0-9]{40}$/.test(before||'')||!/^[a-f0-9]{40}$/.test(after||''))process.exit(1);
 try{const files=execFileSync('git',['diff','--name-only',before,after],{encoding:'utf8',maxBuffer:1000000}).trim().split('\n').filter(Boolean);process.exit(shouldSkipBuild(files)?0:1);}catch{process.exit(1);}
}
