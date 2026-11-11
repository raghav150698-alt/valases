import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLaunchRehearsal} from './server.mjs';

test('local launch gates both products, broadcasts once, survives restart and never replays for new visits',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'valases-launch-'));
 const products={website:path.join(temp,'website'),tests:path.join(temp,'tests')};
 for(const [surface,folder] of Object.entries(products)){await mkdir(folder);await writeFile(path.join(folder,'index.html'),`<h1>PRODUCT ${surface}</h1>`);await writeFile(path.join(folder,'private.js'),'PRODUCT JS');}
 const film=path.join(temp,'film.mp4');await writeFile(film,Buffer.alloc(120000,1));
 const options={storage:path.join(temp,'state'),products,film};let app;
 const listen=async()=>{app=await createLaunchRehearsal(options);await Promise.all(Object.values(app.servers).map(s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve))));return Object.fromEntries(Object.entries(app.servers).map(([k,s])=>[k,`http://127.0.0.1:${s.address().port}`]));};
 try{
  let urls=await listen();
  for(const url of Object.values(urls)){
   assert.match(await (await fetch(url)).text(),/Launching soon/);
   assert.doesNotMatch(await (await fetch(url+'/private.js')).text(),/PRODUCT JS/);
   assert.equal((await fetch(url+'/__launch/fire')).status,405);
   assert.equal((await fetch(url+'/__launch/fire',{method:'POST'})).status,401);
  }
  const ac=new AbortController();const stream=await fetch(urls.tests+'/__launch/events',{signal:ac.signal});const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"launchedAt":null/);
  const bad=await fetch(urls.website+'/__launch/fire',{method:'POST',headers:{Authorization:'Bearer '+app.key,Origin:'https://attacker.invalid'}});assert.equal(bad.status,403);
  const launch=await fetch(urls.website+'/__launch/fire',{method:'POST',headers:{Authorization:'Bearer '+app.key}});assert.equal(launch.status,200);const fired=await launch.json();assert.ok(fired.launchedAt);
  assert.match(new TextDecoder().decode((await reader.read()).value),/"launchedAt":"/);ac.abort();await reader.cancel().catch(()=>{});
  const again=await (await fetch(urls.tests+'/__launch/fire',{method:'POST',headers:{Authorization:'Bearer '+app.key}})).json();assert.equal(again.id,fired.id);assert.equal(again.launchedAt,fired.launchedAt);assert.equal(again.alreadyLaunched,true);
  for(const [surface,url]of Object.entries(urls)){const body=await(await fetch(url)).text();assert.match(body,new RegExp(`PRODUCT ${surface}`));assert.doesNotMatch(body,/client.js|film.mp4/);assert.equal(await(await fetch(url+'/private.js')).text(),'PRODUCT JS');}
  const media=await fetch(urls.website+'/__launch/film.mp4',{headers:{Range:'bytes=0-99'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,100);
  assert.equal((await fetch(urls.website+'/__launch/film.mp4',{headers:{Range:'bytes=999999-'}})).status,416);
  await app.close();urls=await listen();assert.equal(app.state().id,fired.id);assert.equal(app.state().launchedAt,fired.launchedAt);assert.match(await(await fetch(urls.tests)).text(),/PRODUCT tests/);
  const disk=JSON.parse(await readFile(path.join(options.storage,'state.json'),'utf8'));assert.equal(disk.launchedAt,fired.launchedAt);
 }finally{if(app)await app.close();await rm(temp,{recursive:true,force:true});}
});

test('unavailable launch film keeps the gate closed',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'valases-launch-missing-'));const app=await createLaunchRehearsal({storage:temp,film:path.join(temp,'missing.mp4')});const server=app.servers.website;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url=`http://127.0.0.1:${server.address().port}`;const result=await fetch(url+'/__launch/fire',{method:'POST',headers:{Authorization:'Bearer '+app.key}});assert.equal(result.status,500);assert.equal(app.state().launchedAt,null);}finally{await app.close();await rm(temp,{recursive:true,force:true});}
});
