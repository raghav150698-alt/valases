import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type Role = "provider" | "student" | "admin" | null;

type SessionState = {
  token: string | null;
  role: Role;
  setSession: (token: string, role: Role) => void;
  clear: () => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      setSession: (token, role) => set({ token, role }),
      clear: () => set({ token: null, role: null }),
    }),
    {
      name: "valases-session",
      storage: createJSONStorage(() => window.sessionStorage),
      partialize: (state) => ({ token: state.token, role: state.role }),
    },
  ),
);
