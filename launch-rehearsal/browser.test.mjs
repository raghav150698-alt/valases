import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLaunchRehearsal} from './server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(tmpdir(),'valases-launch-browser-'));
const output=path.join(root,'.pilot-runs/launch-rehearsal/verification');await mkdir(output,{recursive:true});
const products={website:path.join(temp,'website'),tests:path.join(temp,'tests')};
for(const [name,folder]of Object.entries(products)){await mkdir(folder);await writeFile(path.join(folder,'index.html'),`<!doctype html><h1>PRODUCT ${name}</h1>`);}
const app=await createLaunchRehearsal({storage:path.join(temp,'state'),products});
let browser;
try{
 for(const server of Object.values(app.servers))await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const urls=Object.fromEntries(Object.entries(app.servers).map(([name,server])=>[name,`http://127.0.0.1:${server.address().port}`]));
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const a=await context.newPage(),b=await context.newPage(),control=await context.newPage();
 const errors=[];for(const page of [a,b,control])page.on('pageerror',e=>errors.push(e.message));
 // Force the second tab through the browser autoplay-denial path.
 await b.addInitScript(()=>{const play=HTMLMediaElement.prototype.play;let denied=false;HTMLMediaElement.prototype.play=function(...args){if(!denied&&!this.muted){denied=true;return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'));}return play.apply(this,args);};});
 await Promise.all([a.goto(urls.website),b.goto(urls.tests),control.goto(urls.website+'/__launch/control')]);
 await a.waitForFunction(()=>document.getElementById('connection').textContent==='Ready for the launch');
 assert.equal(await a.locator('#cinema').isVisible(),false);
 assert.equal(await a.locator('#film').evaluate(v=>v.currentTime),0);
 await a.screenshot({path:path.join(output,'waiting-desktop.png')});
 await control.locator('#key').fill(app.key);await control.locator('#launch').waitFor({state:'visible'});await control.waitForFunction(()=>!document.getElementById('launch').disabled);
 await control.screenshot({path:path.join(output,'owner-control.png')});
 await control.locator('#launch').click();
 for(const page of[a,b]){await page.waitForFunction(()=>!document.getElementById('cinema').hidden);await page.waitForFunction(()=>{const v=document.getElementById('film');return v.currentTime>.2&&!v.paused;});}
 assert.equal(await b.locator('#film').evaluate(v=>v.muted),true);assert.equal(await b.locator('#sound').isVisible(),true);
 await b.locator('#sound').click();assert.equal(await b.locator('#film').evaluate(v=>v.muted),false);
 await a.screenshot({path:path.join(output,'launch-film.png')});
 assert.equal(await control.locator('#launch').isDisabled(),true);
 const first=app.state();await control.evaluate(async key=>{await fetch('/__launch/fire',{method:'POST',headers:{Authorization:'Bearer '+key}});},app.key);assert.equal(app.state().launchedAt,first.launchedAt);
 // Reload during the film must immediately open the product, never replay.
 await a.reload();await a.locator('h1').filter({hasText:'PRODUCT website'}).waitFor();assert.equal(await a.locator('video').count(),0);
 // Complete the film naturally in the other tab and verify automatic entry.
 await b.locator('#film').evaluate(v=>{v.currentTime=v.duration-.15;});await b.locator('h1').filter({hasText:'PRODUCT tests'}).waitFor();
 await b.reload();assert.equal(await b.locator('video').count(),0);
 const later=await context.newPage();await later.goto(urls.tests);assert.equal(await later.locator('video').count(),0);assert.match(await later.textContent('h1'),/PRODUCT tests/);
 assert.deepEqual(errors,[]);
 console.log('PASS: two waiting tabs play once; muted autoplay fallback and sound recovery work; completion opens product; reload, duplicate trigger and later visits do not replay.');
}finally{if(browser)await browser.close();await app.close();await rm(temp,{recursive:true,force:true});}
