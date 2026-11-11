import http from 'node:http';
import {readFile, writeFile, mkdir, stat, rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2'};

export async function createLaunchRehearsal(options={}) {
  const storage=options.storage||path.join(root,'.pilot-runs/launch-rehearsal');
  await mkdir(storage,{recursive:true});
  const statePath=path.join(storage,'state.json'),keyPath=path.join(storage,'owner-key.txt');
  let key;
  try{key=(await readFile(keyPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;key=randomBytes(32).toString('hex');await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}
  let state;
  try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={id:randomUUID(),launchedAt:null};}
  if(!state.id || !Object.hasOwn(state,'launchedAt'))throw Error('Invalid launch state; refusing to reset it.');
  async function save(next){const tmp=statePath+'.tmp';await writeFile(tmp,JSON.stringify(next,null,2));await rename(tmp,statePath);}
  await save(state);
  const streams=new Set();
  let launchInFlight=false;
  function publicState(){return {...state,waitingTabs:streams.size,localOnly:true};}
  function broadcast(){const data=`event: state\ndata: ${JSON.stringify(publicState())}\n\n`;for(const res of streams)res.write(data);}
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  function authorized(req){const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));const expected=Buffer.from(key);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
  async function asset(req,res,file){
    let info;try{info=await stat(file);}catch{res.writeHead(404);res.end('Not found');return;}
    if(!info.isFile()){res.writeHead(404);res.end('Not found');return;}
    const type=mime[path.extname(file)]||'application/octet-stream';
    // The launch film is seekable, including on browsers that use range requests.
    const range=req.headers.range;
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start=match&&match[1]?Number(match[1]):0;let end=match&&match[2]?Number(match[2]):info.size-1;if(match&&!match[1]&&match[2]){start=Math.max(0,info.size-Number(match[2]));end=info.size-1;}end=Math.min(end,info.size-1);if(!match||start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1,'Cache-Control':'no-store'});if(req.method==='HEAD')res.end();else createReadStream(file,{start,end}).pipe(res);return;}
    res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'Accept-Ranges':'bytes','Cache-Control':'no-store'});
    if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
  }
  const brand=path.join(root,'marketing/valases-tests-launch-20261111/public/logo.png');
  const film=options.film||path.join(root,'marketing/valases-tests-launch-20261111/output/valases-tests-launch-1080p.mp4');
  const defaults={website:path.join(root,'.vercel-release/20261110-website-natural-r5/website'),tests:path.join(root,'.vercel-release/20261111-candidate-audit-r3/test')};
  function makeServer(surface){return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Frame-Options','DENY');
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/__launch/state'&&req.method==='GET')return json(res,200,publicState());
      if(url.pathname==='/__launch/events'&&req.method==='GET'){
        if(streams.size>=500)return json(res,503,{error:'Local rehearsal connection limit reached'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});streams.add(res);broadcast();
        const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);streams.delete(res);broadcast();});return;
      }
      if(url.pathname==='/__launch/fire'){
        if(req.method!=='POST')return json(res,405,{error:'POST required'});
        if(!authorized(req))return json(res,401,{error:'Owner key required'});
        const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return json(res,403,{error:'Origin not allowed'});
        if(state.launchedAt)return json(res,200,{...publicState(),alreadyLaunched:true});
        if(launchInFlight)return json(res,409,{error:'Launch is already being committed'});
        launchInFlight=true;
        try{
          const media=await stat(film);if(media.size<100000)throw Error('Launch film is unavailable');
          for(const product of Object.values(options.products||defaults))await stat(path.join(product,'index.html'));
          const next={...state,launchedAt:new Date().toISOString()};await save(next);state=next;broadcast();return json(res,200,publicState());
        }finally{launchInFlight=false;}
      }
      if(url.pathname==='/__launch/control')return asset(req,res,path.join(here,'control.html'));
      if(url.pathname==='/__launch/client.js')return asset(req,res,path.join(here,'client.js'));
      if(url.pathname==='/__launch/style.css')return asset(req,res,path.join(here,'style.css'));
      if(url.pathname==='/__launch/logo.png')return asset(req,res,brand);
      if(url.pathname==='/__launch/film.mp4')return asset(req,res,film);
      if(url.pathname.startsWith('/__launch/'))return json(res,404,{error:'Not found'});
      // Gate documents AND product assets. URL tricks cannot expose the product early.
      if(!state.launchedAt){if(req.method!=='GET'&&req.method!=='HEAD')return json(res,503,{error:'Launching soon'});return asset(req,res,path.join(here,'waiting.html'));}
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Static local rehearsal; no API proxy'});
      const product=(options.products||defaults)[surface];
      const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if(relative.split(/[\\/]/).some(part=>part==='..'||part.startsWith('.'))||relative.includes('\\'))return json(res,403,{error:'Not allowed'});
      let file=path.resolve(product,relative||'index.html');
      if(file!==product&&!file.startsWith(product+path.sep))return json(res,403,{error:'Not allowed'});
      try{const info=await stat(file);if(info.isDirectory())file=path.join(file,'index.html');}catch{
        if(path.extname(relative)){res.writeHead(404);res.end('Not found');return;}
        file=path.join(product,surface==='tests'&&relative.startsWith('candidate/')?'candidate/index.html':'index.html');
      }
      return asset(req,res,file);
    }catch(error){console.error('Launch request failed:',error.message);if(!res.headersSent)json(res,500,{error:'Launch could not complete. Check the local server.'});else res.end();}
  });}
  const servers={website:makeServer('website'),tests:makeServer('tests')};
  return {servers,key,state:()=>publicState(),storage,async close(){for(const res of streams)res.end();await Promise.all(Object.values(servers).map(server=>new Promise(resolve=>server.close(resolve))));}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createLaunchRehearsal();
  for(const [surface,server] of Object.entries(app.servers)){const port=surface==='website'?4390:4391;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});console.log(`${surface}: http://127.0.0.1:${port}`);}
  console.log('Owner control: http://127.0.0.1:4390/__launch/control');
  console.log('Owner key saved in .pilot-runs/launch-rehearsal/owner-key.txt (not printed).');
  console.log(app.state().launchedAt?'Already launched. Video will not replay.':'Waiting for the owner to launch.');
}
