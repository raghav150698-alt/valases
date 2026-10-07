import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerAllModules } from "handsontable/registry";
import { App } from "./app/App";
import "./styles.css";
import { lazy, Suspense } from "react";
import { isLocalUiPreview } from "./lib/uiPreview";

const WorkspacePreview = import.meta.env.DEV
  ? lazy(() => import("./dev/AssessmentPreview"))
  : () => null;

const queryClient = new QueryClient();
registerAllModules();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    {isLocalUiPreview ? <Suspense fallback={<p>Opening UI preview…</p>}><WorkspacePreview /></Suspense> : <App />}
  </QueryClientProvider>,
);
