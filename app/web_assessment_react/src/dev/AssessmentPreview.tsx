import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../lib/api";
import { isLocalUiPreview } from "../lib/uiPreview";
import { HiringWorkspace } from "../features/hiring/HiringWorkspace";
import { previewResponse } from "./workspacePreviewData";
import "./WorkspacePreview.css";

if (!isLocalUiPreview) throw new Error("UI preview is available only on a local development server.");

// Isolate both data and transport from the signed-in workspace. Unknown reads
// and every mutation reject locally. There is no real-network fallback.
const previewQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false }, mutations: { retry: false } } });

api.defaults.adapter = async (config) => {
  try {
    const data = previewResponse(config.method || "get", config.url || "", config.params);
    return { data, status: 200, statusText: "OK", headers: {}, config };
  } catch (error) {
    window.dispatchEvent(new CustomEvent("valases:preview-notice", { detail: error instanceof Error ? error.message : "Preview action unavailable." }));
    throw error;
  }
};

export default function WorkspacePreview() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const showNotice = (event: Event) => setNotice(String((event as CustomEvent).detail));
    window.addEventListener("valases:preview-notice", showNotice);
    return () => window.removeEventListener("valases:preview-notice", showNotice);
  }, []);
  const exitPreview = () => window.location.assign(import.meta.env.BASE_URL);
  return <QueryClientProvider client={previewQueryClient}>
    <div className="workspace-ui-preview">
      {notice && <div className="workspace-preview-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}
      <HiringWorkspace onSignOut={exitPreview} />
    </div>
  </QueryClientProvider>;
}
