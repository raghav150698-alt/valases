import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerAllModules } from "handsontable/registry";
import { App } from "./app/App";
import "./styles.css";

const queryClient = new QueryClient();
registerAllModules();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
