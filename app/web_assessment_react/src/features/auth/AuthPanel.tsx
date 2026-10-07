import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { BrandLogo } from "../../components/BrandLogo";
import { api } from "../../lib/api";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase, supabaseConfigured } from "../../lib/supabase";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  full_name: z.string().optional(),
  legal_name: z.string().optional(),
  brand_name: z.string().optional(),
  country: z.string().optional(),
  website: z.string().optional(),
});

type Form = z.infer<typeof schema>;

type FirebaseConfigResponse = {
  apiKey?: string;
  auth_mode?: string;
  allowSelfServiceSignup?: boolean;
  allowEmployerSelfServiceSignup?: boolean;
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

function isSupabaseNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("err_blocked_by_client") ||
    normalized.includes("winerror 10013")
  );
}

export function AuthPanel() {
  const legalBase = `${import.meta.env.BASE_URL}legal`;
  const { register, handleSubmit, getValues, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const setSession = useSessionStore((s) => s.setSession);
  const [error, setError] = useState("");
  const [signupNotice, setSignupNotice] = useState("");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [authMode, setAuthMode] = useState("");
  const [signupAllowed, setSignupAllowed] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  const completeSupabaseSession = async (accessToken: string) => {
    const context = await api.get("/auth/me/context", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setSession(accessToken, context.data.role);
  };

  useEffect(() => {
    let active = true;
    void api.get<FirebaseConfigResponse>("/config/firebase")
      .then(({ data }) => {
        if (!active) return;
        setAuthMode(String(data.auth_mode || "").trim().toLowerCase());
        setSignupAllowed(Boolean(data.allowSelfServiceSignup || data.allowEmployerSelfServiceSignup));
      })
      .catch(() => {
        if (active) setError("Unable to load the authentication configuration.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    let active = true;
    void (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!active || sessionError || !data.session?.access_token) return;
        await completeSupabaseSession(data.session.access_token);
      } catch (sessionCompletionError) {
        if (active) setError(humanizeAuthError(sessionCompletionError));
      }
    })();
    return () => { active = false; };
  }, []);

  const onSubmit = async (values: Form) => {
    setError("");
    setSignupNotice("");
    try {
      const { data: authConfig } = await api.get<FirebaseConfigResponse>("/config/firebase");
      const configuredAuthMode = String(authConfig?.auth_mode || "").trim().toLowerCase();

      if (isCreatingAccount) {
        const fullName = String(values.full_name || "").trim();
        if (fullName.length < 2) {
          setError("Enter the employer or recruiter name.");
          return;
        }
        const businessProfile = { legal_name: (values.legal_name || "").trim(), brand_name: (values.brand_name || "").trim(), country: (values.country || "").trim(), website: (values.website || "").trim() };
        if (businessProfile.legal_name.length < 2 || businessProfile.brand_name.length < 2 || businessProfile.country.length < 2) throw new Error("Enter your legal business name, brand name and country.");
        if (businessProfile.website && !/^https?:\/\//i.test(businessProfile.website)) throw new Error("Enter a website URL beginning with https:// or http://.");
        if (configuredAuthMode === "supabase" && supabase) {
          if (!authConfig.allowEmployerSelfServiceSignup) throw new Error("Employer self setup is not enabled.");
          const emailDomain = values.email.trim().toLowerCase().split("@")[1];
          if (["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "mail.com"].includes(emailDomain)) throw new Error("Use your company-domain email to create a free workspace. Contact support if your business uses a personal email.");
          if (values.password.length < 12) throw new Error("Use a password with at least 12 characters.");
          const { data, error: signupError } = await supabase.auth.signUp({
            email: values.email.trim(), password: values.password,
            options: { data: { full_name: fullName, business_profile: businessProfile }, emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
          });
          if (signupError) throw signupError;
          if (data.session?.access_token) await completeSupabaseSession(data.session.access_token);
          else {
            setSignupNotice("Check your work email to confirm your account, then sign in. Mailbox confirmation is required before free workspace access.");
            setIsCreatingAccount(false);
          }
          return;
        }
        await api.post("/auth/signup", {
          email: values.email.trim(),
          full_name: fullName,
          password: values.password,
          role: "provider",
          business_profile: businessProfile,
        });
        const { data } = await api.post("/auth/login", {
          email: values.email.trim(),
          password: values.password,
        });
        setSession(data.access_token, data.role);
        return;
      }

      if (supabaseConfigured && supabase) {
        try {
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: values.email.trim(),
            password: values.password,
          });
          if (signInError || !data.session?.access_token) {
            throw new Error(signInError?.message || "Supabase did not return a session.");
          }
          await completeSupabaseSession(data.session.access_token);
          return;
        } catch (supabaseError) {
          if (!isSupabaseNetworkError(supabaseError)) throw supabaseError;

          // Keep password login available when a browser or network policy blocks
          // direct calls to the Supabase project domain.
          const { data } = await api.post("/auth/login", values);
          setSession(data.access_token, data.role);
          return;
        }
      }

      if (configuredAuthMode === "firebase") {
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

  const signInWithCompanySso = async () => {
    if (!supabaseConfigured || !supabase) return;
    const email = String(getValues("email") || "").trim().toLowerCase();
    const domain = email.split("@")[1] || "";
    if (!domain || !domain.includes(".")) {
      setError("Enter your work email first, then continue with company SSO.");
      return;
    }
    setError("");
    setIsSsoLoading(true);
    try {
      const redirectTo = `${window.location.origin}/assessment/`;
      const { error: ssoError } = await supabase.auth.signInWithSSO({
        domain,
        options: { redirectTo },
      });
      if (ssoError) throw ssoError;
    } catch (ssoError) {
      setError(humanizeAuthError(ssoError));
      setIsSsoLoading(false);
    }
  };

  return (
    <section className="auth-panel">
      <div className="auth-panel-copy">
        <BrandLogo className="auth-brand-logo" />
        <h1>Sign in</h1>
        <p>Manage assessments, candidate invitations, and completed submissions.</p>
        <div className="auth-trust-row">
          <div className="auth-trust-item">
            <strong>Assessment delivery</strong>
            <span>Create, issue, and monitor role-specific evaluations.</span>
          </div>
          <div className="auth-trust-item">
            <strong>Candidate review</strong>
            <span>Review scores, checkpoints, and integrity evidence in one place.</span>
          </div>
        </div>
      </div>

      <div className="auth-panel-card">
        <div className="auth-card-head">
          <div>
            <strong>{isCreatingAccount ? "Create employer account" : "Sign in"}</strong>
            <small>{isCreatingAccount ? "Set up your free workspace with a work email" : "Use your work account"}</small>
          </div>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="auth-form-grid">
          {isCreatingAccount && <label className="field-stack">
            <span>Administrator full name</span>
            <input required maxLength={200} autoComplete="name" placeholder="Your full name" {...register("full_name")} />
          </label>}
          {isCreatingAccount && <>
            <label className="field-stack"><span>Legal / registered business name</span><input required minLength={2} maxLength={240} placeholder="Green House Pvt Ltd" {...register("legal_name")} /><small>The name on your business registration, if registered.</small></label>
            <label className="field-stack"><span>Brand / trading name</span><input required minLength={2} maxLength={200} autoComplete="organization" placeholder="Uncut Trees" {...register("brand_name")} /><small>Shown to your hiring team and candidates. It can match your legal name.</small></label>
            <label className="field-stack"><span>Business country</span><input required minLength={2} maxLength={80} autoComplete="country-name" placeholder="India" {...register("country")} /></label>
            <label className="field-stack"><span>Business website · optional</span><input type="url" maxLength={500} placeholder="https://uncuttrees.com" {...register("website")} /></label>
            <p className="auth-input-hint">Confirm your company email to start free. Business registration checks, including GSTIN, are separate and optional.</p>
          </>}
          <label className="field-stack">
            <span>{isCreatingAccount ? "Administrator work email" : "Email"}</span>
            <input type="email" autoComplete="email" placeholder="admin@uncuttrees.com" {...register("email")} />
          </label>
          <label className="field-stack">
            <span>Password</span>
            <input placeholder="Enter password" type="password" {...register("password")} />
          </label>
          <div className="auth-input-hint">
            {supabaseConfigured
              ? "Sign in securely with your organization account."
              : "Sign in with your Valases employer account."}
          </div>
          <div className="auth-actions">
            <button className="auth-primary-btn" type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting
                ? (isCreatingAccount ? "Creating account..." : "Signing in...")
                : (isCreatingAccount ? "Create employer account" : "Sign in")}
            </button>
          </div>
          {signupAllowed && ["legacy", "supabase"].includes(authMode) && <button
            className="auth-google-btn"
            type="button"
            onClick={() => {
              setError("");
              setSignupNotice("");
              setIsCreatingAccount((current) => !current);
            }}
            disabled={formState.isSubmitting}
          >
            {isCreatingAccount ? "Already have an account? Sign in" : "Create your free employer account"}
          </button>}
          {signupNotice && <p role="status">{signupNotice}</p>}
          {supabaseConfigured && <>
            <div className="auth-divider"><span>or</span></div>
            <button className="auth-google-btn" type="button" onClick={() => void signInWithGoogle()} disabled={isGoogleLoading || formState.isSubmitting}>
              <span className="google-mark" aria-hidden="true">G</span>
              {isGoogleLoading ? "Opening Google..." : "Continue with Google"}
            </button>
            <button className="auth-google-btn" type="button" onClick={() => void signInWithCompanySso()} disabled={isSsoLoading || formState.isSubmitting}>
              <span className="auth-sso-mark" aria-hidden="true">SSO</span>
              {isSsoLoading ? "Opening company sign-in..." : "Continue with company SSO"}
            </button>
          </>}
          {error && <div className="inline-error">{error}</div>}
        </form>
        <div className="auth-legal-links">
          <a href={`${legalBase}/privacy-policy.html`} target="_blank" rel="noreferrer">Privacy</a>
          <a href={`${legalBase}/data-retention-and-deletion.html`} target="_blank" rel="noreferrer">Data retention</a>
        </div>
      </div>
    </section>
  );
}
