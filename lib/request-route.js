// Literal Vercel rewrites pass a fixed route through query parameters. Consume
// only that route value matching the selected endpoint; never discard
// arbitrary query fields or let a conflicting capture override a public path.
export function requestRoute(req){
 const invalid=()=>{const error=new Error('invalid_query');error.status=400;throw error;};
 const url=new URL(req.url,'https://local.invalid');
 if(req.query!==undefined){
  if(!req.query||typeof req.query!=='object'||Array.isArray(req.query))invalid();
  for(const [key,value] of Object.entries(req.query)){
   const values=Array.isArray(value)?value:[value];
   if(values.length!==1||typeof values[0]!=='string')invalid();
   const existing=url.searchParams.getAll(key);
   if(existing.length){if(existing.length!==1||existing[0]!==values[0])invalid();}
   else url.searchParams.append(key,values[0]);
  }
 }
 const source=url.pathname.replace(/^\/(?:api\/)?/,'');
 let route=source==='admin/'?'admin':source;
 const routeValues=url.searchParams.getAll('route');
 if(routeValues.length>1)invalid();
 if(source==='index'){
  if(routeValues.length!==1||!routeValues[0])invalid();
  route=routeValues[0];
 }else if(routeValues.length&&routeValues[0]!==route)invalid();
 if(routeValues.length)url.searchParams.delete('route');
 // No wildcard capture exists in vercel.json. A path parameter is never valid.
 if(url.searchParams.has('path'))invalid();
 url.pathname='/'+(route.startsWith('data/')?route:route==='admin'?'admin':'api/'+route);
 return {url,route};
}
