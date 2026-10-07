/** View-only sample workspace. Never enabled in production or on a remote host. */
export const isLocalUiPreview = import.meta.env.DEV
  && typeof window !== "undefined"
  && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get("ui-preview") === "1";
