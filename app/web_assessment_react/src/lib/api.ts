import axios from "axios";
import { useSessionStore } from "./sessionStore";

export const api = axios.create({
  baseURL: "/",
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
      }
    }
    return Promise.reject(error);
  },
);
