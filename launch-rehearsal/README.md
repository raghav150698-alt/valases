# Local launch rehearsal

This is a loopback-only rehearsal. It does not change the live website, Tests, Hire, database, candidate sessions or payment configuration.

Start from the repository root:

```powershell
node launch-rehearsal/server.mjs
```

- Website waiting page: http://127.0.0.1:4390
- Tests waiting page: http://127.0.0.1:4391
- Private owner control: http://127.0.0.1:4390/__launch/control

Open several waiting tabs BEFORE pressing Launch. To open the owner control with its key filled, run:

```powershell
powershell -ExecutionPolicy Bypass -File launch-rehearsal/open-control.ps1
```

The local owner key is stored in the ignored `.pilot-runs/launch-rehearsal/owner-key.txt`. It is not printed in logs. The control helper uses a URL fragment, then removes the fragment from browser history. Only the authenticated POST can launch. There is no public reset or launch API without the key.

The trigger atomically commits a persistent launch ID and timestamp before broadcasting over server-sent events to both local surfaces. Polling backs up SSE reconnects. Each waiting tab marks the event as seen before playing. The film ends by reloading the original page/route into the product. Refreshing during the ceremony enters the product directly. Subsequent visitors never receive the waiting screen or launch player. Restarting the server preserves launch state; pressing Launch twice has no effect.

Autoplay with sound is controlled by browsers. The film first attempts audible playback, then falls back to muted autoplay with a Turn sound on button. If video autoplay itself is blocked, a Play launch film button appears. Background/suspended/offline tabs receive the update when the browser resumes or reconnects; simultaneous audible playback cannot be guaranteed by a website.

The local product pages use the existing prepared website and Tests release snapshots. No local backend is proxied. This rehearsal tests launch behavior; it does not represent a new production product deployment. All product documents and assets are gated before launch, except the launch screen's own branding and film.

To rehearse again, stop the server first, then **archive/rename** `.pilot-runs/launch-rehearsal/state.json` deliberately. The browser remembers the old launch ID; the new state gets a new ID. There is no automatic reset.

Validation:

```powershell
cd launch-rehearsal
npm install
npm test
npm run test:browser
```

Browser tests use isolated temporary launch state and fixture products. They cannot fire the user's actual local launch. Screenshots are under `.pilot-runs/launch-rehearsal/verification/`.

## Production release

`production/` contains the production implementation, separate from the loopback rehearsal. Supabase stores a single RLS-protected launch event. Only the confirmed internal owner can invoke the one-shot launch RPC. The database enforces an immutable launch timestamp. Authorization is based on the Auth user ID, never editable user metadata. Anonymous visitors can read the event but cannot insert, update, delete or launch. Database authorization tests execute the owner action within a rolled-back transaction, so testing does not launch the actual product.

The Vercel Build Output API packages product HTML privately inside the gate function. Static branding, media and product assets are served normally. Before launch every product page returns the waiting screen. After launch the website and Tests return their prepared product HTML immediately; subsequent visits do not include a launch player. Hire remains launching soon. Waiting tabs poll the shared event every 2.5 seconds and use the same once-per-tab ceremony client tested locally.

The private owner page is `https://test.valases.com/launch-control`. It requires the internal `raghavendra@valases.com` account through Supabase Auth; the server-side database policy is the actual authorization boundary. No service-role key or database password is sent to the browser. Client configuration contains only the publishable key and project URL.

Release preparation uses ignored local deployment credentials:

```powershell
.\.codex-run-venv\Scripts\python.exe launch-rehearsal/production/apply_schema.py
.\.codex-run-venv\Scripts\python.exe launch-rehearsal/production/prepare.py
```

Prepared artifacts go to `.vercel-release/20261111-launch-gate/{website,test,hire}/.vercel/output`. Deploy each verified linked project with `vercel deploy --prebuilt --prod --skip-domain`, validate it, then promote that deployment. Existing active tabs from before the gate deployment must be refreshed once to enroll in the waiting screen. Background/offline tabs detect launch on resume/reconnect. Do not reset the production event or use the local owner-key server publicly.
