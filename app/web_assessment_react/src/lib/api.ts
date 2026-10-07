import axios from "axios";
import { useSessionStore } from "./sessionStore";
import { supabase } from "./supabase";
import { isLocalUiPreview } from "./uiPreview";

const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const defaultApiBaseUrl = import.meta.env.DEV ? "/" : "/api/";
// A legacy same-origin "/" setting would send production API calls into the
// static SPA. Preserve absolute external API URLs, but normalize same-origin
// production traffic to the dedicated serverless boundary.
const resolvedApiBaseUrl = import.meta.env.PROD && configuredApiBaseUrl === "/"
  ? "/api/"
  : configuredApiBaseUrl || defaultApiBaseUrl;

export const api = axios.create({
  baseURL: resolvedApiBaseUrl,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (isLocalUiPreview) {
    config.headers.delete("Authorization");
    return config;
  }
  const token = useSessionStore.getState().token;
  // Issued-candidate requests provide their own short-lived bearer token.
  // Never replace it with a recruiter token retained for this domain.
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error && error.response && error.response.status === 401) {
      const recruiterToken = useSessionStore.getState().token;
      const requestAuthorization = String(
        error.config && error.config.headers ? error.config.headers.Authorization || "" : "",
      );
      if (recruiterToken && requestAuthorization === `Bearer ${recruiterToken}`) {
        useSessionStore.getState().clear();
        // Keep the app store and Supabase browser session in sync. Leaving a
        // rejected Supabase session behind remounts AuthPanel and creates a
        // repeated sign-in/redirect loop after a 401 response.
        if (supabase) void supabase.auth.signOut({ scope: "local" });
      }
    }
    return Promise.reject(error);
  },
);
