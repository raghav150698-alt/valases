export function createApiClient({ state }) {
  let pendingRequests = 0;

  function emitNetworkBusy() {
    try {
      window.dispatchEvent(new CustomEvent("certora:network-busy", {
        detail: { pending: pendingRequests },
      }));
    } catch {}
  }

  async function getHeaders(authRequired = true) {
    const headers = { "Content-Type": "application/json" };
    if (!authRequired) return headers;
    if (state.localAccessToken) {
      headers.Authorization = `Bearer ${state.localAccessToken}`;
      if (state.localDummyRole) headers["X-Dummy-Role"] = state.localDummyRole;
      if (state.localDummyEmail) headers["X-Dummy-Email"] = state.localDummyEmail;
      if (state.localDummyName) headers["X-Dummy-Name"] = state.localDummyName;
      return headers;
    }
    if (!state.auth?.currentUser) throw new Error("Please login first.");
    headers.Authorization = `Bearer ${await state.auth.currentUser.getIdToken()}`;
    return headers;
  }

  async function api(method, path, body, authRequired = true) {
    pendingRequests += 1;
    emitNetworkBusy();
    try {
      const request = async (forceRefreshToken = false) => {
        if (authRequired) {
          if (state.localAccessToken) {
            const headers = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${state.localAccessToken}`,
            };
            if (state.localDummyRole) headers["X-Dummy-Role"] = state.localDummyRole;
            if (state.localDummyEmail) headers["X-Dummy-Email"] = state.localDummyEmail;
            if (state.localDummyName) headers["X-Dummy-Name"] = state.localDummyName;
            return fetch(path, {
              method,
              cache: "no-store",
              headers,
              body: body ? JSON.stringify(body) : undefined,
            });
          }
          const user = state.auth?.currentUser;
          if (!user) throw new Error(JSON.stringify({ status: 401, data: { detail: "Please login first." } }, null, 2));
          return fetch(path, {
            method,
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${await user.getIdToken(forceRefreshToken)}`,
            },
            body: body ? JSON.stringify(body) : undefined,
          });
        }
        return fetch(path, {
          method,
          cache: "no-store",
          headers: await getHeaders(false),
          body: body ? JSON.stringify(body) : undefined,
        });
      };
      let res = await request(false);
      if (authRequired && res.status === 401 && state.auth?.currentUser) {
        // Retry once with forced token refresh to handle transient auth races.
        res = await request(true);
      }
      const raw = await res.text();
      let data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = { text: raw };
        }
      } else {
        data = {};
      }
      if (!res.ok) throw new Error(JSON.stringify({ status: res.status, data }, null, 2));
      return data;
    } finally {
      pendingRequests = Math.max(0, pendingRequests - 1);
      emitNetworkBusy();
    }
  }

  return {
    getHeaders,
    api,
  };
}
