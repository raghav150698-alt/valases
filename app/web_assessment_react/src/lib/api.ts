import axios from "axios";
import { useSessionStore } from "./sessionStore";
import { supabase } from "./supabase";

export const api = axios.create({
  baseURL: String(import.meta.env.VITE_API_BASE_URL || "/").trim() || "/",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = useSessionStore.getState().token;
  // Issued-candidate requests provide their own short-lived bearer token.
  // Never replace it with a recruiter token retained for this domain.
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const recruiterToken = useSessionStore.getState().token;
      const requestAuthorization = String(error?.config?.headers?.Authorization || "");
      if (recruiterToken && requestAuthorization === `Bearer ${recruiterToken}`) {
        useSessionStore.getState().clear();
        // Keep the app store and Supabase browser session in sync. Leaving a
        // rejected Supabase session behind remounts AuthPanel and creates a
        // repeated sign-in/redirect loop after a 401 response.
        void supabase?.auth.signOut({ scope: "local" });
      }
    }
    return Promise.reject(error);
  },
);
