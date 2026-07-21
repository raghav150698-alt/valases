import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "../../lib/api";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase, supabaseConfigured } from "../../lib/supabase";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type Form = z.infer<typeof schema>;

type FirebaseConfigResponse = {
  apiKey?: string;
  auth_mode?: string;
};

type FirebasePasswordLoginResponse = {
  error?: { message?: string };
  idToken?: string;
};

function humanizeFirebaseError(code: string | undefined) {
  const normalized = String(code || "").trim();
  if (!normalized) return "Unable to sign in.";
  if (normalized.includes("INVALID_LOGIN_CREDENTIALS")) return "Invalid email or password.";
  if (normalized.includes("INVALID_PASSWORD")) return "Invalid email or password.";
  if (normalized.includes("EMAIL_NOT_FOUND")) return "No account was found for this email.";
  if (normalized.includes("USER_DISABLED")) return "This account is disabled.";
  if (normalized.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) return "Too many login attempts. Please try again later.";
  return normalized.replace(/^auth\//i, "").replace(/_/g, " ").toLowerCase();
}

function humanizeAuthError(err: unknown) {
  const responseDetail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  const message = responseDetail || (err instanceof Error ? err.message : "Unable to sign in.");
  const normalized = String(message).toLowerCase();
  if (normalized.includes("invalid login credentials") || normalized.includes("invalid email or password")) {
    return "Invalid email or password. If this account was created with Google, use Continue with Google.";
  }
  if (
    normalized.includes("winerror 10013") ||
    normalized.includes("err_blocked_by_client") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror")
  ) {
    return "Unable to reach Supabase. Check your internet connection or allow the Supabase domain in your browser or network policy.";
  }
  return message;
}

export function AuthPanel() {
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const setSession = useSessionStore((s) => s.setSession);
  const [error, setError] = useState("");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const completeSupabaseSession = async (accessToken: string) => {
    const context = await api.get("/auth/me/context", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setSession(accessToken, context.data.role);
  };

  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!active || sessionError || !data.session?.access_token) return;
      try {
        await completeSupabaseSession(data.session.access_token);
      } catch (sessionCompletionError) {
        if (active) setError(humanizeAuthError(sessionCompletionError));
      }
    });
    return () => { active = false; };
  }, []);

  const onSubmit = async (values: Form) => {
    setError("");
    try {
      if (supabaseConfigured && supabase) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: values.email.trim(),
          password: values.password,
        });
        if (signInError || !data.session?.access_token) {
          throw new Error(signInError?.message || "Supabase did not return a session.");
        }
        await completeSupabaseSession(data.session.access_token);
        return;
      }

      const { data: authConfig } = await api.get<FirebaseConfigResponse>("/config/firebase");
      const authMode = String(authConfig?.auth_mode || "").trim().toLowerCase();

      if (authMode === "firebase") {
        const apiKey = String(authConfig?.apiKey || "").trim();
        if (!apiKey) throw new Error("Firebase login is enabled, but the web API key is missing.");

        const firebaseResponse = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: values.email.trim(),
              password: values.password,
              returnSecureToken: true,
            }),
          },
        );
        const firebaseData = await firebaseResponse.json() as FirebasePasswordLoginResponse;
        if (!firebaseResponse.ok || !firebaseData.idToken) {
          throw new Error(humanizeFirebaseError(firebaseData?.error?.message));
        }

        const context = await api.get("/auth/me/context", {
          headers: { Authorization: `Bearer ${firebaseData.idToken}` },
        });
        setSession(firebaseData.idToken, context.data.role);
        return;
      }

      const { data } = await api.post("/auth/login", values);
      setSession(data.access_token, data.role);
    } catch (err) {
      setError(humanizeAuthError(err));
    }
  };

  const signInWithGoogle = async () => {
    if (!supabaseConfigured || !supabase) return;
    setError("");
    setIsGoogleLoading(true);
    try {
      const redirectTo = `${window.location.origin}/assessment/`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(humanizeAuthError(oauthError));
      setIsGoogleLoading(false);
    }
  };

  return (
    <section className="auth-panel">
      <div className="auth-panel-copy">
        <span className="auth-eyebrow">Recruiter sign in</span>
        <h1>Welcome back</h1>
        <p>Access assessments, candidate invites, and review workflows from one secure workspace.</p>
        <div className="auth-trust-row">
          <div className="auth-trust-item">
            <strong>Assessment operations</strong>
            <span>Create and manage technical, spreadsheet, and task-based evaluations.</span>
          </div>
          <div className="auth-trust-item">
            <strong>Controlled candidate access</strong>
            <span>Candidates join through issued links instead of the recruiter login page.</span>
          </div>
        </div>
      </div>

      <div className="auth-panel-card">
        <div className="auth-card-head">
          <div>
            <strong>Sign in</strong>
            <small>Use your recruiter workspace credentials</small>
          </div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="auth-form-grid">
          <label className="field-stack">
            <span>Email</span>
            <input placeholder="recruiter@company.com" {...register("email")} />
          </label>
          <label className="field-stack">
            <span>Password</span>
            <input placeholder="Enter password" type="password" {...register("password")} />
          </label>
          <div className="auth-input-hint">{supabaseConfigured ? "Sign in securely with your Supabase workspace account." : "Supabase is not configured yet. Dummy auth is active temporarily."}</div>
          <div className="auth-actions">
            <button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? "Signing In..." : "Sign In"}
            </button>
          </div>
          {supabaseConfigured && <>
            <div className="auth-divider"><span>or</span></div>
            <button className="auth-google-btn" type="button" onClick={() => void signInWithGoogle()} disabled={isGoogleLoading || formState.isSubmitting}>
              <span className="google-mark" aria-hidden="true">G</span>
              {isGoogleLoading ? "Opening Google..." : "Continue with Google"}
            </button>
          </>}
          {error && <div className="inline-error">{error}</div>}
        </form>
        <div className="auth-legal-links">
          <a href="/legal/privacy-policy.html" target="_blank" rel="noreferrer">Privacy</a>
          <a href="/legal/data-retention-and-deletion.html" target="_blank" rel="noreferrer">Data retention</a>
        </div>
      </div>
    </section>
  );
}
