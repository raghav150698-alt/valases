import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { BrandLogo } from "../../components/BrandLogo";
import { api } from "../../lib/api";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase } from "../../lib/supabase";
import "./AdminConsole.css";

type AdminTab = "overview" | "companies" | "users" | "usage" | "billing";

type Overview = {
  companies: number;
  provider_users: number;
  active_users: number;
  issued_total: number;
  issued_30d: number;
  completed_total: number;
  pending_review: number;
  unique_candidates: number;
  completion_rate: number;
  monthly_recurring_revenue: number;
  currency: string;
};

type Billing = {
  provider_id: number;
  plan_code: string;
  status: string;
  currency: string;
  monthly_price: number;
  included_assessments: number;
  overage_price: number;
  billing_email: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  notes: string | null;
};

type Company = {
  provider_id: number;
  company_name: string;
  owner_user_id: number;
  owner_name: string;
  owner_email: string;
  account_state: string;
  is_active: boolean;
  approval_status: string;
  issued_count: number;
  completed_count: number;
  created_at: string;
  billing: Billing;
};

type WorkspaceUser = {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  company_name: string;
  provider_id: number | null;
  is_active: boolean;
  account_state: string;
  issued_count: number;
  created_at: string;
};

type Usage = {
  provider_id: number;
  company_name: string;
  owner_email: string;
  issued: number;
  completed: number;
  submissions: number;
  unique_candidates: number;
  completion_rate: number;
};

const emptyBilling: Billing = {
  provider_id: 0,
  plan_code: "trial",
  status: "trialing",
  currency: "USD",
  monthly_price: 0,
  included_assessments: 25,
  overage_price: 0,
  billing_email: "",
  current_period_start: null,
  current_period_end: null,
  notes: "",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function apiMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

function billingDate(value: string | null) {
  if (!value) return null;
  return value.length === 10 ? `${value}T00:00:00Z` : value;
}

export function AdminConsole() {
  const qc = useQueryClient();
  const clearSession = useSessionStore((state) => state.clear);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [search, setSearch] = useState("");
  const [usageDays, setUsageDays] = useState(30);
  const [showNewUser, setShowNewUser] = useState(false);
  const [createdAccess, setCreatedAccess] = useState<{ email: string; temporary_password: string } | null>(null);
  const [newUser, setNewUser] = useState({ full_name: "", email: "", company_name: "", temporary_password: "" });
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [billingForm, setBillingForm] = useState<Billing>(emptyBilling);

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => (await api.get<Overview>("/admin/workspace/overview")).data,
  });
  const companies = useQuery({
    queryKey: ["admin-companies"],
    queryFn: async () => (await api.get<{ items: Company[] }>("/admin/workspace/companies")).data.items,
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get<{ items: WorkspaceUser[] }>("/admin/workspace/users")).data.items,
  });
  const usage = useQuery({
    queryKey: ["admin-usage", usageDays],
    queryFn: async () => (await api.get<{ items: Usage[] }>(`/admin/workspace/usage?days=${usageDays}`)).data.items,
  });

  const companyRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return companies.data || [];
    return (companies.data || []).filter((company) => `${company.company_name} ${company.owner_name} ${company.owner_email}`.toLowerCase().includes(needle));
  }, [companies.data, search]);
  const userRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users.data || [];
    return (users.data || []).filter((user) => `${user.full_name} ${user.email} ${user.company_name}`.toLowerCase().includes(needle));
  }, [search, users.data]);

  useEffect(() => {
    if (!selectedProviderId && companies.data?.length) setSelectedProviderId(companies.data[0].provider_id);
  }, [companies.data, selectedProviderId]);
  useEffect(() => {
    const company = companies.data?.find((item) => item.provider_id === selectedProviderId);
    if (company) setBillingForm({ ...company.billing, billing_email: company.billing.billing_email || company.owner_email, notes: company.billing.notes || "" });
  }, [companies.data, selectedProviderId]);

  const createUser = useMutation({
    mutationFn: async () => (await api.post("/admin/workspace/users", {
      ...newUser,
      temporary_password: newUser.temporary_password || null,
    })).data as { email: string; temporary_password: string },
    onSuccess: async (data) => {
      setCreatedAccess(data);
      setNewUser({ full_name: "", email: "", company_name: "", temporary_password: "" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-overview"] }),
        qc.invalidateQueries({ queryKey: ["admin-companies"] }),
        qc.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
    },
  });

  const updateUserState = useMutation({
    mutationFn: async ({ userId, action }: { userId: number; action: "active" | "freeze" }) => (
      await api.post(`/admin/users/${userId}/state`, { action, reason: action === "freeze" ? "Suspended by Valases administrator" : null })
    ).data,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-overview"] }),
        qc.invalidateQueries({ queryKey: ["admin-companies"] }),
        qc.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
    },
  });

  const saveBilling = useMutation({
    mutationFn: async () => {
      if (!selectedProviderId) throw new Error("Select a company.");
      const payload = {
        ...billingForm,
        billing_email: billingForm.billing_email || null,
        notes: billingForm.notes || null,
        current_period_start: billingDate(billingForm.current_period_start),
        current_period_end: billingDate(billingForm.current_period_end),
      };
      return (await api.put(`/admin/workspace/companies/${selectedProviderId}/billing`, payload)).data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-overview"] }),
        qc.invalidateQueries({ queryKey: ["admin-companies"] }),
      ]);
    },
  });

  const handleCreateUser = (event: FormEvent) => {
    event.preventDefault();
    setCreatedAccess(null);
    createUser.mutate();
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    clearSession();
  };

  const pageTitles: Record<AdminTab, [string, string]> = {
    overview: ["Operations overview", "Account, delivery, review, and revenue health."],
    companies: ["Companies", "Manage customer organizations and account access."],
    users: ["Users", "Provision recruiter accounts and control access."],
    usage: ["Usage", "Track assessment delivery and completion by company."],
    billing: ["Billing", "Maintain plans, allowances, pricing, and billing periods."],
  };
  const [title, description] = pageTitles[tab];
  const metrics = overview.data;

  return (
    <section className="admin-console">
      <aside className="admin-rail">
        <div className="admin-brand"><BrandLogo className="workspace-brand-logo" /><div><strong>Valases</strong><small>Administration</small></div></div>
        <nav aria-label="Administration">
          {(["overview", "companies", "users", "usage", "billing"] as AdminTab[]).map((item) => (
            <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>
          ))}
        </nav>
        <div className="admin-account">
          <div><strong>admin@valases.com</strong><small>Platform administrator</small></div>
          <button type="button" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-page-head">
          <div><h1>{title}</h1><p>{description}</p></div>
          {tab === "users" && <button type="button" className="admin-primary" onClick={() => { setCreatedAccess(null); setShowNewUser(true); }}>Add user</button>}
        </header>

        {overview.isError && <div className="admin-error">{apiMessage(overview.error, "Administration data could not be loaded.")}</div>}

        {tab === "overview" && (
          <div className="admin-overview">
            <section className="admin-metric-band" aria-label="Platform metrics">
              <div><span>Companies</span><strong>{metrics?.companies ?? "--"}</strong><small>{metrics?.active_users ?? 0} active owners</small></div>
              <div><span>Assessments issued</span><strong>{metrics?.issued_total ?? "--"}</strong><small>{metrics?.issued_30d ?? 0} in 30 days</small></div>
              <div><span>Completion rate</span><strong>{metrics ? `${metrics.completion_rate.toFixed(1)}%` : "--"}</strong><small>{metrics?.completed_total ?? 0} completed</small></div>
              <div><span>Pending review</span><strong>{metrics?.pending_review ?? "--"}</strong><small>Recruiter action required</small></div>
              <div><span>Monthly revenue</span><strong>{metrics ? formatMoney(metrics.monthly_recurring_revenue, metrics.currency) : "--"}</strong><small>Active and trialing plans</small></div>
            </section>
            <section className="admin-section">
              <div className="admin-section-head"><div><h2>Company activity</h2><p>Highest-volume organizations across the platform.</p></div><button type="button" onClick={() => setTab("companies")}>View companies</button></div>
              <div className="admin-table company-summary-table">
                <div className="admin-table-head"><span>Company</span><span>Account</span><span>Issued</span><span>Completed</span><span>Plan</span></div>
                {(companies.data || []).slice().sort((a, b) => b.issued_count - a.issued_count).slice(0, 8).map((company) => (
                  <div className="admin-table-row" key={company.provider_id}><div><strong>{company.company_name}</strong><small>{company.owner_email}</small></div><span className={`admin-state state-${company.account_state}`}>{company.account_state}</span><strong>{company.issued_count}</strong><strong>{company.completed_count}</strong><span>{company.billing.plan_code}</span></div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "companies" && (
          <section className="admin-section">
            <div className="admin-toolbar"><input aria-label="Search companies" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, owner, or email" /><span>{companyRows.length} companies</span></div>
            <div className="admin-table companies-table">
              <div className="admin-table-head"><span>Company</span><span>Owner</span><span>Status</span><span>Usage</span><span>Plan</span><span>Action</span></div>
              {companyRows.map((company) => <div className="admin-table-row" key={company.provider_id}><div><strong>{company.company_name}</strong><small>Added {formatDate(company.created_at)}</small></div><div><strong>{company.owner_name}</strong><small>{company.owner_email}</small></div><span className={`admin-state state-${company.account_state}`}>{company.account_state}</span><span>{company.completed_count} / {company.issued_count} completed</span><div><strong>{company.billing.plan_code}</strong><small>{formatMoney(company.billing.monthly_price, company.billing.currency)} monthly</small></div><button type="button" onClick={() => { setSelectedProviderId(company.provider_id); setTab("billing"); }}>Manage billing</button></div>)}
            </div>
          </section>
        )}

        {tab === "users" && (
          <section className="admin-section">
            <div className="admin-toolbar"><input aria-label="Search users" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or company" /><span>{userRows.length} users</span></div>
            <div className="admin-table users-table">
              <div className="admin-table-head"><span>User</span><span>Company</span><span>Role</span><span>Issued</span><span>Status</span><span>Action</span></div>
              {userRows.map((user) => <div className="admin-table-row" key={user.user_id}><div><strong>{user.full_name}</strong><small>{user.email}</small></div><span>{user.company_name}</span><span>{user.role}</span><strong>{user.issued_count}</strong><span className={`admin-state state-${user.account_state}`}>{user.account_state}</span>{user.role === "admin" ? <small>Protected</small> : <button type="button" disabled={updateUserState.isPending} onClick={() => updateUserState.mutate({ userId: user.user_id, action: user.is_active ? "freeze" : "active" })}>{user.is_active ? "Freeze access" : "Reactivate"}</button>}</div>)}
            </div>
          </section>
        )}

        {tab === "usage" && (
          <section className="admin-section">
            <div className="admin-toolbar"><label>Reporting period<select value={usageDays} onChange={(event) => setUsageDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>12 months</option></select></label><span>{usage.data?.length || 0} companies</span></div>
            <div className="admin-table usage-table">
              <div className="admin-table-head"><span>Company</span><span>Issued</span><span>Completed</span><span>Submissions</span><span>Candidates</span><span>Completion</span></div>
              {(usage.data || []).map((item) => <div className="admin-table-row" key={item.provider_id}><div><strong>{item.company_name}</strong><small>{item.owner_email}</small></div><strong>{item.issued}</strong><strong>{item.completed}</strong><strong>{item.submissions}</strong><strong>{item.unique_candidates}</strong><span>{item.completion_rate.toFixed(1)}%</span></div>)}
            </div>
          </section>
        )}

        {tab === "billing" && (
          <section className="admin-billing-layout">
            <aside className="admin-company-list"><label>Company<select value={selectedProviderId || ""} onChange={(event) => setSelectedProviderId(Number(event.target.value))}>{(companies.data || []).map((company) => <option key={company.provider_id} value={company.provider_id}>{company.company_name}</option>)}</select></label>{(companies.data || []).map((company) => <button type="button" key={company.provider_id} className={selectedProviderId === company.provider_id ? "active" : ""} onClick={() => setSelectedProviderId(company.provider_id)}><strong>{company.company_name}</strong><small>{company.billing.plan_code} | {company.billing.status}</small></button>)}</aside>
            <form className="admin-section admin-billing-form" onSubmit={(event) => { event.preventDefault(); saveBilling.mutate(); }}>
              <div className="admin-section-head"><div><h2>Billing account</h2><p>Changes apply to the selected company immediately.</p></div></div>
              <div className="admin-form-grid">
                <label>Plan code<input value={billingForm.plan_code} onChange={(event) => setBillingForm((value) => ({ ...value, plan_code: event.target.value }))} /></label>
                <label>Status<select value={billingForm.status} onChange={(event) => setBillingForm((value) => ({ ...value, status: event.target.value }))}><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option></select></label>
                <label>Monthly price<input type="number" min="0" step="0.01" value={billingForm.monthly_price} onChange={(event) => setBillingForm((value) => ({ ...value, monthly_price: Number(event.target.value) }))} /></label>
                <label>Currency<input value={billingForm.currency} maxLength={8} onChange={(event) => setBillingForm((value) => ({ ...value, currency: event.target.value.toUpperCase() }))} /></label>
                <label>Included assessments<input type="number" min="0" value={billingForm.included_assessments} onChange={(event) => setBillingForm((value) => ({ ...value, included_assessments: Number(event.target.value) }))} /></label>
                <label>Overage per assessment<input type="number" min="0" step="0.01" value={billingForm.overage_price} onChange={(event) => setBillingForm((value) => ({ ...value, overage_price: Number(event.target.value) }))} /></label>
                <label className="admin-span-2">Billing email<input type="email" value={billingForm.billing_email || ""} onChange={(event) => setBillingForm((value) => ({ ...value, billing_email: event.target.value }))} /></label>
                <label>Period start<input type="date" value={billingForm.current_period_start?.slice(0, 10) || ""} onChange={(event) => setBillingForm((value) => ({ ...value, current_period_start: event.target.value || null }))} /></label>
                <label>Period end<input type="date" value={billingForm.current_period_end?.slice(0, 10) || ""} onChange={(event) => setBillingForm((value) => ({ ...value, current_period_end: event.target.value || null }))} /></label>
                <label className="admin-span-2">Internal notes<textarea rows={4} value={billingForm.notes || ""} onChange={(event) => setBillingForm((value) => ({ ...value, notes: event.target.value }))} /></label>
              </div>
              <div className="admin-form-actions"><button className="admin-primary" type="submit" disabled={saveBilling.isPending || !selectedProviderId}>{saveBilling.isPending ? "Saving..." : "Save billing"}</button>{saveBilling.isSuccess && <span>Billing account updated.</span>}{saveBilling.isError && <span className="admin-error-inline">{apiMessage(saveBilling.error, "Billing could not be updated.")}</span>}</div>
            </form>
          </section>
        )}
      </main>

      {showNewUser && <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setShowNewUser(false)}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="new-user-title" onMouseDown={(event) => event.stopPropagation()}><header><div><h2 id="new-user-title">Add recruiter account</h2><p>Create the company owner and their Supabase sign-in.</p></div><button type="button" aria-label="Close" onClick={() => setShowNewUser(false)}>x</button></header>{createdAccess ? <div className="admin-created-access"><strong>Account created</strong><p>Share these credentials through a secure channel. The password is shown only here.</p><dl><dt>Email</dt><dd>{createdAccess.email}</dd><dt>Temporary password</dt><dd>{createdAccess.temporary_password}</dd></dl><button type="button" className="admin-primary" onClick={() => setShowNewUser(false)}>Done</button></div> : <form onSubmit={handleCreateUser} className="admin-user-form"><label>Full name<input required minLength={2} value={newUser.full_name} onChange={(event) => setNewUser((value) => ({ ...value, full_name: event.target.value }))} /></label><label>Work email<input required type="email" value={newUser.email} onChange={(event) => setNewUser((value) => ({ ...value, email: event.target.value }))} /></label><label>Company name<input required minLength={2} value={newUser.company_name} onChange={(event) => setNewUser((value) => ({ ...value, company_name: event.target.value }))} /></label><label>Temporary password <small>Optional</small><input type="text" minLength={10} value={newUser.temporary_password} onChange={(event) => setNewUser((value) => ({ ...value, temporary_password: event.target.value }))} placeholder="Generate automatically" /></label>{createUser.isError && <div className="admin-error">{apiMessage(createUser.error, "The user could not be created.")}</div>}<div className="admin-form-actions"><button type="button" onClick={() => setShowNewUser(false)}>Cancel</button><button className="admin-primary" type="submit" disabled={createUser.isPending}>{createUser.isPending ? "Creating..." : "Create account"}</button></div></form>}</section></div>}
    </section>
  );
}
