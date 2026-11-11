const fs=require('node:fs/promises');
const path=require('node:path');
const config=require('./config.json');
const base=__dirname;
let permanentlyLaunched=null;
async function state(){
 if(permanentlyLaunched)return permanentlyLaunched;
 const response=await fetch(`${config.supabaseUrl}/rest/v1/valases_launch_event?select=event_key,launched_at&event_key=eq.tests-launch-20261111`,{headers:{apikey:config.publishableKey},signal:AbortSignal.timeout(8000),cache:'no-store'});
 if(!response.ok)throw Error('Launch state unavailable');
 const [row]=await response.json();if(!row)throw Error('Launch state missing');
 const value={id:row.event_key,launchedAt:row.launched_at};if(value.launchedAt)permanentlyLaunched=value;return value;
}
async function html(res,file,status=200){res.statusCode=status;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(path.join(base,file)));}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('CDN-Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
 const url=new URL(req.url,'https://valases.com');const mode=url.searchParams.get('mode')||req.query?.mode||(url.pathname==='/__launch/state'?'state':/^\/launch-control\/?$/.test(url.pathname)?'control':null);
 if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.end('Method not allowed');return;}
 try{
  if(mode==='control')return html(res,'control.html');
  if(mode==='state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await state()));return;}
  const current=await state();
  if(config.surface==='hire')return html(res,'hire.html');
  if(!current.launchedAt)return html(res,'waiting.html');
  let relative=decodeURIComponent(url.searchParams.get('path')||req.query?.path||url.pathname).replace(/^\/+/, '');
  if(relative.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.'))||relative.includes('\\')){res.statusCode=404;res.end('Not found');return;}
  let file;
  if(config.surface==='test')file=relative.startsWith('candidate')?'content/candidate/index.html':'content/index.html';
  else{file='content/'+(relative||'index.html');if(!path.extname(file))file+='.html';}
  try{return await html(res,file);}catch(error){if(error.code!=='ENOENT')throw error;res.statusCode=404;res.end('Not found');}
 }catch(error){
  if(mode==='state'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Launch status temporarily unavailable'}));}
  else await html(res,'waiting.html',503);
 }
};
