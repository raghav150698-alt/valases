import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

type Publication = { published: boolean; expires_at: string | null; minimum_experience_years: number | null };
export function JobsPublicationForWorkspace({ jobId, open }: {jobId: number; open: boolean}) {
  const workspace = useQuery({queryKey:["hiring","workspace"], queryFn:async()=> (await api.get<{organization:{id:number};permissions:string[]}>("/hiring/workspace")).data});
  if (!workspace.data?.permissions.includes("jobs.manage")) return null;
  return <JobsPublication jobId={jobId} open={open} organizationId={workspace.data.organization.id} />;
}
export function JobsPublication({ jobId, organizationId, open }: { jobId: number; organizationId: number; open: boolean }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [years, setYears] = useState("");
  const [expiry, setExpiry] = useState("");
  const key = ["jobs-publication", organizationId, jobId];
  const path = `/job-marketplace/publications/${jobId}?organization_id=${organizationId}`;
  const query = useQuery({ queryKey: key, queryFn: async () => (await api.get<Publication>(path)).data, enabled: organizationId > 0, retry: false });
  async function save(published: boolean) {
    setBusy(true); setError("");
    try {
      await api.put(path, { published, minimum_experience_years: years === "" ? null : Number(years), expires_at: expiry ? new Date(expiry).toISOString() : null });
      await cache.invalidateQueries({ queryKey: key }); setEditing(false);
    } catch { setError("Publication could not be saved. Check your permissions and vacancy status."); }
    finally { setBusy(false); }
  }
  return <div className="jobs-publication">
    <button type="button" className="hiring-row-command" disabled={busy || query.isPending || !!query.error || (!open && !query.data?.published)} onClick={() => { setYears(String(query.data?.minimum_experience_years ?? "")); setExpiry(query.data?.expires_at ? new Date(new Date(query.data.expires_at).getTime() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16) : ""); setEditing(!editing); }}>
      {query.data?.published ? "Listed on Valases Jobs · Manage" : "List on Valases Jobs"}
    </button>
    {query.error && <small>Job marketplace connection unavailable.</small>}
    {editing && <div><p>Share this vacancy publicly on Valases Jobs. Candidate records remain private.</p><label>Minimum experience (years)<input type="number" min="0" max="80" step="0.5" value={years} onChange={e=>setYears(e.target.value)} /></label><label>Listing expires (optional)<input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} /></label><button type="button" className="hiring-row-command" disabled={busy || !open} onClick={()=>void save(true)}>{busy ? "Saving…" : "Publish listing"}</button>{query.data?.published && <button type="button" className="hiring-row-command" disabled={busy} onClick={()=>void save(false)}>Remove listing</button>}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
