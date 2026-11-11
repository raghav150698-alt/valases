"""Prepare isolated Vercel Build Output API releases; never fires launch."""
import json,shutil,re
from pathlib import Path
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(__file__).resolve().parent
v=dotenv_values(ROOT/'secrets/valases-new-project.env')
public={'supabaseUrl':v['NEW_SUPABASE_URL'].rstrip('/'),'publishableKey':v['NEW_SUPABASE_PUBLISHABLE_KEY']}
assert public['supabaseUrl'].startswith('https://') and not public['publishableKey'].startswith('sb_secret_')
owner=json.loads((ROOT/'.vercel-release/launch-owner-public.json').read_text(encoding='utf-8'))['id']
for surface in ['website','test','hire']:
 out=ROOT/'.vercel-release/20261111-launch-gate'/surface
 static=out/'.vercel/output/static';function=out/'.vercel/output/functions/gate.func'
 static.mkdir(parents=True,exist_ok=True);function.mkdir(parents=True,exist_ok=True)
 product=ROOT/({'website':'valases_website','test':'.vercel-release/20261111-candidate-audit-r3/test','hire':'.vercel-release/20261022-pilot/hire'}[surface])
 if surface!='hire':
  for file in product.rglob('*'):
   relative=file.relative_to(product)
   if not file.is_file() or any(part.startswith('.') or part in ['node_modules','api','docs','scripts'] for part in relative.parts):continue
   if file.suffix=='.html':target=function/'content'/relative
   elif file.suffix in ['.js','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.wasm','.mp3','.mp4','.tflite','.task','.mjs','.woff','.woff2','.ttf','.bin','.json','.pdf','.txt','.xml']:target=static/relative
   else:continue
   if file.name in ['vercel.json','package.json','package-lock.json','serve.js','README.md']:continue
   target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
 assets=static/'__launch';assets.mkdir(exist_ok=True)
 for file in ['client.js','style.css']:
  content=(SOURCE.parent/file).read_text(encoding='utf-8')
  if file=='client.js':
   start=content.index("const events=new EventSource")
   end=content.index('async function check()',start)
   content=content[:start]+"const events={close(){}};\n"+content[end:]
   content=content.replace("if(response.ok)await launch(await response.json());","if(response.ok){$('connection').textContent='Ready for the launch';await launch(await response.json());}")
  (assets/file).write_text(content,encoding='utf-8')
 shutil.copyfile(SOURCE/'control.js',assets/'control.js')
 config={**public,'ownerId':owner,'surface':surface}
 (assets/'config.json').write_text(json.dumps(config),encoding='utf-8')
 (function/'config.json').write_text(json.dumps(config),encoding='utf-8')
 shutil.copyfile(SOURCE/'gate.cjs',function/'index.js')
 shutil.copyfile(SOURCE.parent/'waiting.html',function/'waiting.html')
 shutil.copyfile(SOURCE/'control.html',function/'control.html')
 hire=(SOURCE.parent/'waiting.html').read_text(encoding='utf-8').replace('<script defer src="/__launch/client.js"></script>','').replace('Launching soon.</h1>','Hire is launching soon.</h1>')
 hire=re.sub(r'<div class="live-status">.*?</section>', '',hire,flags=re.S)+'</main></body></html>'
 (function/'hire.html').write_text(hire,encoding='utf-8')
 shutil.copyfile(ROOT/'marketing/valases-tests-launch-20261111/public/logo.png',assets/'logo.png')
 shutil.copyfile(ROOT/'marketing/valases-tests-launch-20261111/output/valases-tests-launch-1080p.mp4',assets/'film.mp4')
 (function/'.vc-config.json').write_text(json.dumps({'runtime':'nodejs22.x','handler':'index.js','launcherType':'Nodejs','maxDuration':30}),encoding='utf-8')
 routes=[{'src':'/__launch/state','dest':'/gate?mode=state'}, {'src':'/launch-control/?','dest':'/gate?mode=control'}, {'src':'/__launch/.*','headers':{'Cache-Control':'no-store'},'continue':True},{'handle':'filesystem'},{'src':'/(.*)','dest':'/gate?path=$1'}]
 (out/'.vercel/output/config.json').write_text(json.dumps({'version':3,'routes':routes}),encoding='utf-8')
 shutil.copyfile(ROOT/f'.vercel-release/20261022-pilot/{surface}/.vercel/project.json',out/'.vercel/project.json')
 print('Prepared',surface,'private HTML gate + static assets')
