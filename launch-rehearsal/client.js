const $=id=>document.getElementById(id);
const film=$('film');
let launched=false,checking=false;
// sessionStorage is per tab: every waiting tab sees the ceremony once. Mark
// before playing so reload, reconnect and duplicate events cannot replay it.
const fallbackSeen=new Set();
function seen(id){try{return sessionStorage.getItem(`valases-launch:${id}`)==='seen';}catch{return fallbackSeen.has(id);}}
function remember(id){fallbackSeen.add(id);try{sessionStorage.setItem(`valases-launch:${id}`,'seen');}catch{}}
function enterProduct(){window.location.reload();}
async function launch(state){
  if(!state.launchedAt||launched)return;
  launched=true;events.close();clearInterval(poll);
  if(seen(state.id)){enterProduct();return;}
  remember(state.id);$('waiting').hidden=true;$('cinema').hidden=false;
  setTimeout(()=>{$('enter').hidden=false;},8000);
  if(film.error){$('film-error').hidden=false;$('enter').hidden=false;return;}
  film.controls=false;film.currentTime=0;film.muted=false;
  try{await film.play();}catch{
    film.muted=true;$('sound').hidden=false;
    try{await film.play();}catch{$('resume').hidden=false;}
  }
}
const events=new EventSource('/__launch/events');
events.addEventListener('state',event=>{const state=JSON.parse(event.data);$('connection').textContent='Ready for the launch';void launch(state);});
events.onerror=()=>{$('connection').textContent='Reconnecting · this page will update automatically';};
async function check(){if(checking||launched)return;checking=true;try{const response=await fetch('/__launch/state',{cache:'no-store'});if(response.ok)await launch(await response.json());}catch{}finally{checking=false;}}
const poll=setInterval(check,2500);void check();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
$('enable-sound').onclick=async()=>{try{const context=new AudioContext();await context.resume();const oscillator=context.createOscillator(),gain=context.createGain();gain.gain.value=0;oscillator.connect(gain).connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.01);oscillator.onended=()=>context.close();$('enable-sound').hidden=true;$('audio-note').textContent='Keep this page open. Your browser may ask you to turn sound on at launch.';}catch{$('audio-note').textContent='Use Turn sound on when the film starts.';}};
$('sound').onclick=async()=>{film.muted=false;try{await film.play();$('sound').hidden=true;$('resume').hidden=true;}catch{$('resume').hidden=false;}};
$('resume').onclick=async()=>{try{await film.play();$('resume').hidden=true;}catch{}};
$('enter').onclick=enterProduct;
film.onended=enterProduct;
film.onerror=()=>{if(!launched)return;$('film-error').hidden=false;$('enter').hidden=false;};
// A background tab can be throttled or the media can stall. Keep a manual
// route to the already-launched product without replaying the ceremony.
film.onplaying=()=>{$('resume').hidden=true;};
