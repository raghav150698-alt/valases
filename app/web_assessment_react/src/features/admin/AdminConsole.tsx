import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { BrandLogo } from "../../components/BrandLogo";
import { api } from "../../lib/api";
import { useSessionStore } from "../../lib/sessionStore";
import { supabase } from "../../lib/supabase";
import { readCompanyLogo } from "../../lib/imageFile";
import "./AdminConsole.css";

type AdminTab = "overview" | "companies" | "users" | "usage" | "billing" | "sso" | "governance" | "requests" | "audit" | "settings";

type AccountContext = {
  email: string;
  full_name: string;
  role: string;
};

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
  organization_id: number | null;
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

type Governance = {
  organization_id: number;
  organization_name: string;
  candidate_retention_days: number;
  assessment_retention_days: number;
  proctor_retention_days: number;
  audit_retention_days: number;
  legal_hold_enabled: boolean;
  legal_hold_reason: string;
  retention_preview: {
    hiring_candidates_eligible: number;
    assessment_issues_eligible: number;
    candidate_cutoff: string;
    assessment_cutoff: string;
    execution_blocked: boolean;
  };
};

type SsoOperation = {
  provider_id: number;
  organization_id: number;
  organization_name: string;
  region: string;
  provider: string;
  domains: string[];
  idp_metadata_url: string;
  initial_admin_email: string;
  enabled: boolean;
  enforce_for_members: boolean;
  connection_status: string;
  connection_id: string;
  operator_notes: string;
  last_error: string;
  registered_at: string | null;
  verified_at: string | null;
  verified_by_email: string | null;
  service_provider: {
    entity_id: string;
    metadata_url: string;
    acs_url: string;
    name_id_format: string;
    required_email_claim: string;
  };
};

type AuditEvent = {
  id: number;
  organization_id: number;
  organization_name: string;
  actor_user_id: number | null;
  action: string;
  target_type: string;
  target_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
};

type DataRequest = {
  id: number;
  organization_name: string;
  provider_id: number;
  request_reference: string;
  request_type: "access" | "export" | "delete";
  candidate_email: string;
  requestor_name: string;
  status: string;
  identity_verified_at: string | null;
  received_at: string;
  due_at: string;
  completed_at: string | null;
  notes: string;
  resolution: Record<string, unknown>;
};

const emptyGovernance = {
  candidate_retention_days: 730,
  assessment_retention_days: 365,
  proctor_retention_days: 30,
  audit_retention_days: 730,
  legal_hold_enabled: false,
  legal_hold_reason: "",
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

const emptySsoOperation = {
  connection_status: "not_configured",
  connection_id: "",
  operator_notes: "",
  last_error: "",
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
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [createdCompany, setCreatedCompany] = useState<{ business_name: string; email: string } | null>(null);
  const [newCompany, setNewCompany] = useState({ business_name: "", email: "", password: "", logo_data_url: "" });
  const [companyLogoError, setCompanyLogoError] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [billingForm, setBillingForm] = useState<Billing>(emptyBilling);
  const [ssoForm, setSsoForm] = useState(emptySsoOperation);
  const [governanceForm, setGovernanceForm] = useState(emptyGovernance);
  const [auditAction, setAuditAction] = useState("");
  const [auditProviderId, setAuditProviderId] = useState<number | null>(null);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [requestNotice, setRequestNotice] = useState("");
  const [newRequest, setNewRequest] = useState({ provider_id: "", request_type: "export", candidate_email: "", requestor_name: "", notes: "" });

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => (await api.get<Overview>("/admin/workspace/overview")).data,
  });
  const account = useQuery({
    queryKey: ["admin-account"],
    queryFn: async () => (await api.get<AccountContext>("/auth/me/context")).data,
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
  const governance = useQuery({
    queryKey: ["admin-governance", selectedProviderId],
    queryFn: async () => (await api.get<Governance>(`/admin/workspace/companies/${selectedProviderId}/governance`)).data,
    enabled: Boolean(selectedProviderId) && tab === "governance",
  });
  const ssoConnections = useQuery({
    queryKey: ["admin-sso-connections"],
    queryFn: async () => (await api.get<{ items: SsoOperation[] }>("/admin/workspace/sso-connections")).data.items,
    enabled: tab === "sso",
  });
  const auditEvents = useQuery({
    queryKey: ["admin-audit-events", auditProviderId, auditAction],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (auditProviderId) params.set("provider_id", String(auditProviderId));
      if (auditAction.trim()) params.set("action", auditAction.trim());
      return (await api.get<{ items: AuditEvent[] }>(`/admin/workspace/audit-events?${params.toString()}`)).data.items;
    },
    enabled: tab === "audit",
  });
  const dataRequests = useQuery({
    queryKey: ["admin-data-requests"],
    queryFn: async () => (await api.get<{ items: DataRequest[] }>("/admin/workspace/data-requests")).data.items,
    enabled: tab === "requests",
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
  const selectedSso = useMemo(
    () => ssoConnections.data?.find((item) => item.provider_id === selectedProviderId),
    [selectedProviderId, ssoConnections.data],
  );

  useEffect(() => {
    if (!selectedProviderId && companies.data?.length) setSelectedProviderId(companies.data[0].provider_id);
  }, [companies.data, selectedProviderId]);
  useEffect(() => {
    if (governance.data) {
      setGovernanceForm({
        candidate_retention_days: governance.data.candidate_retention_days,
        assessment_retention_days: governance.data.assessment_retention_days,
        proctor_retention_days: governance.data.proctor_retention_days,
        audit_retention_days: governance.data.audit_retention_days,
        legal_hold_enabled: governance.data.legal_hold_enabled,
        legal_hold_reason: governance.data.legal_hold_reason,
      });
    }
  }, [governance.data]);
  useEffect(() => {
    const company = companies.data?.find((item) => item.provider_id === selectedProviderId);
    if (company) setBillingForm({ ...company.billing, billing_email: company.billing.billing_email || company.owner_email, notes: company.billing.notes || "" });
  }, [companies.data, selectedProviderId]);
  useEffect(() => {
    setSsoForm(selectedSso ? {
      connection_status: selectedSso.connection_status,
      connection_id: selectedSso.connection_id,
      operator_notes: selectedSso.operator_notes,
      last_error: selectedSso.last_error,
    } : emptySsoOperation);
  }, [selectedSso]);

  const createCompany = useMutation({
    mutationFn: async () => (await api.post("/admin/workspace/companies", newCompany)).data as { business_name: string; email: string },
    onSuccess: async (data) => {
      setCreatedCompany(data);
      setNewCompany({ business_name: "", email: "", password: "", logo_data_url: "" });
      setCompanyLogoError("");
      setShowPassword(false);
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
  const saveGovernance = useMutation({
    mutationFn: async () => {
      if (!selectedProviderId) throw new Error("Select a company.");
      return (await api.put(`/admin/workspace/companies/${selectedProviderId}/governance`, governanceForm)).data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-governance", selectedProviderId] }),
        qc.invalidateQueries({ queryKey: ["admin-audit-events"] }),
      ]);
    },
  });
  const saveSsoOperation = useMutation({
    mutationFn: async () => {
      if (!selectedProviderId) throw new Error("Select a company.");
      return (await api.put<SsoOperation>(`/admin/workspace/companies/${selectedProviderId}/sso`, ssoForm)).data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-sso-connections"] }),
        qc.invalidateQueries({ queryKey: ["admin-audit-events"] }),
      ]);
    },
  });
  const createDataRequest = useMutation({
    mutationFn: async () => (await api.post("/admin/workspace/data-requests", { ...newRequest, provider_id: Number(newRequest.provider_id) })).data,
    onSuccess: async () => {
      setShowNewRequest(false);
      setNewRequest({ provider_id: "", request_type: "export", candidate_email: "", requestor_name: "", notes: "" });
      setRequestNotice("Data request recorded with a 30-day due date.");
      await qc.invalidateQueries({ queryKey: ["admin-data-requests"] });
    },
  });
  const updateDataRequest = useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: string; reason: string }) => (await api.patch(`/admin/workspace/data-requests/${id}`, { action, reason })).data,
    onSuccess: async () => {
      setRequestNotice("Request workflow updated and audited.");
      await qc.invalidateQueries({ queryKey: ["admin-data-requests"] });
    },
  });
  const executeDataRequest = useMutation({
    mutationFn: async ({ item, confirmation }: { item: DataRequest; confirmation: string }) => (
      await api.post<{ request: DataRequest; export: Record<string, unknown> | null }>(`/admin/workspace/data-requests/${item.id}/execute`, { confirmation })
    ).data,
    onSuccess: async (data) => {
      if (data.export) {
        const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${data.request.request_reference}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
      setRequestNotice(data.export ? "Verified export generated and the request completed." : "Approved deletion completed and audited.");
      await qc.invalidateQueries({ queryKey: ["admin-data-requests"] });
    },
  });

  const handleCreateCompany = (event: FormEvent) => {
    event.preventDefault();
    setCreatedCompany(null);
    createCompany.mutate();
  };

  const logout = async () => {
    try {
      if (supabase) await supabase.auth.signOut();
    } finally {
      clearSession();
    }
  };

  const pageTitles: Record<AdminTab, [string, string]> = {
    overview: ["Operations overview", "Account, delivery, review, and revenue health."],
    companies: ["Companies", "Manage customer organizations and account access."],
    users: ["Users", "Provision recruiter accounts and control access."],
    usage: ["Usage", "Track assessment delivery and completion by company."],
    billing: ["Billing", "Maintain plans, allowances, pricing, and billing periods."],
    sso: ["SSO operations", "Provision and monitor organization SAML connections by region."],
    governance: ["Data governance", "Configure retention schedules and organization-wide legal holds."],
    requests: ["Data requests", "Verify and complete candidate access, export, and deletion requests."],
    audit: ["Audit trail", "Search tenant actions without impersonating customer users."],
    settings: ["Settings", "Manage your administrator session and account access."],
  };
  const [title, description] = pageTitles[tab];
  const metrics = overview.data;

  return (
    <section className="admin-console">
      <aside className="admin-rail">
        <div className="admin-brand"><BrandLogo className="workspace-brand-logo" /><div><strong>Valases</strong><small>Administration</small></div></div>
        <nav aria-label="Administration">
          {(["overview", "companies", "users", "usage", "billing", "sso", "governance", "requests", "audit", "settings"] as AdminTab[]).map((item) => (
            <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "sso" ? "SSO" : item[0].toUpperCase() + item.slice(1)}</button>
          ))}
        </nav>
        <div className="admin-account">
          <div><strong>{account.data?.email || "Administrator"}</strong><small>Platform administrator</small></div>
          <button type="button" onClick={() => setTab("settings")}>Settings</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-page-head">
          <div><h1>{title}</h1><p>{description}</p></div>
          {tab === "companies" && <button type="button" className="admin-primary" onClick={() => { setCreatedCompany(null); setShowNewCompany(true); }}>Add company</button>}
          {tab === "requests" && <button type="button" className="admin-primary" onClick={() => setShowNewRequest(true)}>New request</button>}
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

        {tab === "sso" && (
          <section className="admin-sso-layout">
            <aside className="admin-company-list">
              <label>Company<select value={selectedProviderId || ""} onChange={(event) => setSelectedProviderId(Number(event.target.value))}>{(ssoConnections.data || []).map((item) => <option key={item.provider_id} value={item.provider_id}>{item.organization_name}</option>)}</select></label>
              {(ssoConnections.data || []).map((item) => <button type="button" key={item.provider_id} className={selectedProviderId === item.provider_id ? "active" : ""} onClick={() => setSelectedProviderId(item.provider_id)}><strong>{item.organization_name}</strong><small>{item.region} | {item.connection_status.replace(/_/g, " ")}</small></button>)}
            </aside>
            <form className="admin-section admin-sso-form" onSubmit={(event) => { event.preventDefault(); saveSsoOperation.mutate(); }}>
              <div className="admin-section-head"><div><h2>Connection provisioning</h2><p>Internal SAML registration and regional service-provider details.</p></div>{selectedSso && <span className={`admin-state state-${selectedSso.connection_status}`}>{selectedSso.connection_status.replace(/_/g, " ")}</span>}</div>
              {!selectedSso && !ssoConnections.isLoading && <div className="admin-empty-row">No provisioned company is available.</div>}
              {selectedSso && <>
                <div className="admin-sso-request">
                  <div><span>Organization</span><strong>{selectedSso.organization_name}</strong><small>{selectedSso.region} region</small></div>
                  <div><span>Identity provider</span><strong>{selectedSso.provider ? selectedSso.provider.replace(/_/g, " ") : "Not submitted"}</strong><small>{selectedSso.domains.join(", ") || "No domains submitted"}</small></div>
                  <div><span>IT administrator</span><strong>{selectedSso.initial_admin_email || "Not submitted"}</strong><small>{selectedSso.idp_metadata_url ? "Metadata received" : "Metadata required"}</small></div>
                </div>
                <dl className="admin-sso-values">
                  <div><dt>Entity ID</dt><dd>{selectedSso.service_provider.entity_id || "Regional Supabase project is not configured"}</dd></div>
                  <div><dt>ACS / Reply URL</dt><dd>{selectedSso.service_provider.acs_url || "Regional Supabase project is not configured"}</dd></div>
                  <div><dt>Metadata URL</dt><dd>{selectedSso.service_provider.metadata_url || "Regional Supabase project is not configured"}</dd></div>
                  <div><dt>Identity-provider metadata</dt><dd>{selectedSso.idp_metadata_url || "Awaiting customer submission"}</dd></div>
                  <div><dt>NameID / claim</dt><dd>{selectedSso.service_provider.name_id_format} | {selectedSso.service_provider.required_email_claim}</dd></div>
                </dl>
                <div className="admin-form-grid">
                  <label>Provisioning status<select value={ssoForm.connection_status} onChange={(event) => setSsoForm((value) => ({ ...value, connection_status: event.target.value }))}>
                    <option value="not_configured">Not configured</option>
                    <option value="registration_pending">Registration pending</option>
                    <option value="registered">Registered</option>
                    {selectedSso.connection_status === "verified" && <option value="verified">Verified by SAML login</option>}
                    <option value="error">Provisioning error</option>
                  </select></label>
                  <label>Supabase connection ID<input value={ssoForm.connection_id} onChange={(event) => setSsoForm((value) => ({ ...value, connection_id: event.target.value }))} placeholder="SSO connection identifier" /></label>
                  <label className="admin-span-2">Operator notes<textarea rows={3} value={ssoForm.operator_notes} onChange={(event) => setSsoForm((value) => ({ ...value, operator_notes: event.target.value }))} placeholder="Registration, customer handoff, and verification notes" /></label>
                  {ssoForm.connection_status === "error" && <label className="admin-span-2">Provisioning error<textarea required rows={3} value={ssoForm.last_error} onChange={(event) => setSsoForm((value) => ({ ...value, last_error: event.target.value }))} /></label>}
                </div>
                <div className="admin-form-actions"><button className="admin-primary" type="submit" disabled={saveSsoOperation.isPending}>{saveSsoOperation.isPending ? "Saving..." : "Save provisioning status"}</button>{saveSsoOperation.isSuccess && <span>SSO operations record updated.</span>}{saveSsoOperation.isError && <span className="admin-error-inline">{apiMessage(saveSsoOperation.error, "SSO provisioning could not be updated.")}</span>}</div>
              </>}
            </form>
          </section>
        )}

        {tab === "governance" && (
          <section className="admin-governance-layout">
            <aside className="admin-company-list">
              <label>Company<select value={selectedProviderId || ""} onChange={(event) => setSelectedProviderId(Number(event.target.value))}>{(companies.data || []).map((company) => <option key={company.provider_id} value={company.provider_id}>{company.company_name}</option>)}</select></label>
              {(companies.data || []).map((company) => <button type="button" key={company.provider_id} className={selectedProviderId === company.provider_id ? "active" : ""} onClick={() => setSelectedProviderId(company.provider_id)}><strong>{company.company_name}</strong><small>{company.organization_id ? `Organization ${company.organization_id}` : "Backfill required"}</small></button>)}
            </aside>
            <form className="admin-section admin-governance-form" onSubmit={(event) => { event.preventDefault(); saveGovernance.mutate(); }}>
              <div className="admin-section-head"><div><h2>Retention and legal hold</h2><p>Periods are applied to the selected organization. Eligibility is previewed here; deletion runs only through the controlled operator job.</p></div></div>
              {governance.isError && <div className="admin-error admin-form-alert">{apiMessage(governance.error, "Governance settings could not be loaded.")}</div>}
              <div className="admin-form-grid">
                <label>Candidate records (days)<input type="number" min="30" max="3650" value={governanceForm.candidate_retention_days} onChange={(event) => setGovernanceForm((value) => ({ ...value, candidate_retention_days: Number(event.target.value) }))} /></label>
                <label>Assessment records (days)<input type="number" min="30" max="3650" value={governanceForm.assessment_retention_days} onChange={(event) => setGovernanceForm((value) => ({ ...value, assessment_retention_days: Number(event.target.value) }))} /></label>
                <label>Proctor records (days)<input type="number" min="1" max="365" value={governanceForm.proctor_retention_days} onChange={(event) => setGovernanceForm((value) => ({ ...value, proctor_retention_days: Number(event.target.value) }))} /></label>
                <label>Audit records (days)<input type="number" min="365" max="3650" value={governanceForm.audit_retention_days} onChange={(event) => setGovernanceForm((value) => ({ ...value, audit_retention_days: Number(event.target.value) }))} /></label>
                <label className="admin-span-2 admin-hold-toggle"><input type="checkbox" checked={governanceForm.legal_hold_enabled} onChange={(event) => setGovernanceForm((value) => ({ ...value, legal_hold_enabled: event.target.checked }))} /><span><strong>Organization-wide legal hold</strong><small>Blocks retention execution until the hold is removed.</small></span></label>
                <label className="admin-span-2">Legal hold reason<textarea rows={3} disabled={!governanceForm.legal_hold_enabled} value={governanceForm.legal_hold_reason} onChange={(event) => setGovernanceForm((value) => ({ ...value, legal_hold_reason: event.target.value }))} placeholder="Matter, authority, and preservation reason" /></label>
              </div>
              {governance.data?.retention_preview && <div className="admin-retention-preview"><div><span>Candidate records eligible</span><strong>{governance.data.retention_preview.hiring_candidates_eligible}</strong><small>Before {formatDate(governance.data.retention_preview.candidate_cutoff)}</small></div><div><span>Assessment invitations eligible</span><strong>{governance.data.retention_preview.assessment_issues_eligible}</strong><small>Before {formatDate(governance.data.retention_preview.assessment_cutoff)}</small></div><div><span>Execution</span><strong>{governance.data.retention_preview.execution_blocked ? "Blocked" : "Available to operator"}</strong><small>{governance.data.retention_preview.execution_blocked ? "Legal hold is active" : "Requires controlled job confirmation"}</small></div></div>}
              <div className="admin-form-actions"><button className="admin-primary" type="submit" disabled={saveGovernance.isPending || !selectedProviderId || (governanceForm.legal_hold_enabled && governanceForm.legal_hold_reason.trim().length < 10)}>{saveGovernance.isPending ? "Saving..." : "Save governance settings"}</button>{saveGovernance.isSuccess && <span>Governance settings and audit event saved.</span>}{saveGovernance.isError && <span className="admin-error-inline">{apiMessage(saveGovernance.error, "Governance settings could not be saved.")}</span>}</div>
            </form>
          </section>
        )}

        {tab === "requests" && (
          <section className="admin-section">
            {requestNotice && <div className="admin-success-notice"><span>{requestNotice}</span><button type="button" onClick={() => setRequestNotice("")}>Dismiss</button></div>}
            {(updateDataRequest.isError || executeDataRequest.isError) && <div className="admin-error admin-form-alert">{apiMessage(updateDataRequest.error || executeDataRequest.error, "The data request action could not be completed.")}</div>}
            <div className="admin-toolbar"><span>{dataRequests.data?.length || 0} requests ordered by due date</span></div>
            <div className="admin-table data-request-table">
              <div className="admin-table-head"><span>Request</span><span>Candidate</span><span>Company</span><span>Due</span><span>Status</span><span>Actions</span></div>
              {(dataRequests.data || []).map((item) => {
                const act = (action: string, prompt: string) => {
                  const reason = window.prompt(prompt);
                  if (reason?.trim() && reason.trim().length >= 10) updateDataRequest.mutate({ id: item.id, action, reason: reason.trim() });
                };
                return <div className="admin-table-row" key={item.id}>
                  <div><strong>{item.request_reference}</strong><small>{item.request_type.toUpperCase()} | Received {formatDate(item.received_at)}</small></div>
                  <div><strong>{item.requestor_name || "Candidate"}</strong><small>{item.candidate_email}</small></div>
                  <span>{item.organization_name}</span>
                  <span>{formatDate(item.due_at)}</span>
                  <span className={`admin-state state-${item.status}`}>{item.status.replace(/_/g, " ")}</span>
                  <div className="admin-request-actions">
                    {item.status === "received" && <button type="button" onClick={() => act("verify_identity", "Record how identity was verified (minimum 10 characters):")}>Verify</button>}
                    {item.status === "identity_verified" && <button type="button" onClick={() => act("start_review", "Record the review scope (minimum 10 characters):")}>Review</button>}
                    {["identity_verified", "in_review"].includes(item.status) && <button type="button" onClick={() => act("approve", "Record the approval basis (minimum 10 characters):")}>Approve</button>}
                    {!["completed", "rejected", "approved"].includes(item.status) && <button type="button" onClick={() => act("hold", "Record the hold reason (minimum 10 characters):")}>Hold</button>}
                    {item.status === "on_hold" && <button type="button" onClick={() => act("resume", "Record why processing can resume (minimum 10 characters):")}>Resume</button>}
                    {item.status === "approved" && <button type="button" className={item.request_type === "delete" ? "danger" : ""} onClick={() => { const confirmation = window.prompt(`Type ${item.request_reference} to execute this ${item.request_type} request:`); if (confirmation) executeDataRequest.mutate({ item, confirmation }); }}>Execute</button>}
                  </div>
                </div>;
              })}
              {!dataRequests.isLoading && !dataRequests.data?.length && <div className="admin-empty-row">No data-subject requests have been recorded.</div>}
            </div>
          </section>
        )}

        {tab === "audit" && (
          <section className="admin-section">
            <div className="admin-toolbar admin-audit-toolbar">
              <label>Company<select value={auditProviderId || ""} onChange={(event) => setAuditProviderId(event.target.value ? Number(event.target.value) : null)}><option value="">All companies</option>{(companies.data || []).map((company) => <option key={company.provider_id} value={company.provider_id}>{company.company_name}</option>)}</select></label>
              <input aria-label="Filter audit actions" value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="Filter action, for example stage or governance" />
              <span>{auditEvents.data?.length || 0} events</span>
            </div>
            <div className="admin-table audit-table">
              <div className="admin-table-head"><span>Time</span><span>Company</span><span>Action</span><span>Target</span><span>Actor</span></div>
              {(auditEvents.data || []).map((event) => <div className="admin-table-row" key={event.id}><span>{new Date(event.created_at).toLocaleString()}</span><strong>{event.organization_name}</strong><div><strong>{event.action.replace(/_/g, " ")}</strong><small>{Object.keys(event.details).length ? JSON.stringify(event.details) : "No additional metadata"}</small></div><span>{event.target_type}{event.target_id ? ` #${event.target_id}` : ""}</span><span>{event.actor_user_id ? `User ${event.actor_user_id}` : "System"}</span></div>)}
              {!auditEvents.isLoading && !auditEvents.data?.length && <div className="admin-empty-row">No audit events match this filter.</div>}
            </div>
          </section>
        )}

        {tab === "settings" && (
          <section className="admin-section admin-settings-section">
            <div className="admin-section-head">
              <div><h2>Administrator account</h2><p>Your current authenticated Valases session.</p></div>
            </div>
            <div className="admin-settings-account">
              <div>
                <span>Signed in as</span>
                <strong>{account.data?.full_name || "Valases Administrator"}</strong>
                <small>{account.data?.email || "admin@valases.com"}</small>
              </div>
              <button type="button" className="admin-signout" onClick={() => void logout()}>Sign out</button>
            </div>
          </section>
        )}
      </main>

      {showNewCompany && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setShowNewCompany(false)}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="new-company-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><h2 id="new-company-title">Add company</h2><p>Create the business workspace and its initial login.</p></div>
              <button type="button" aria-label="Close" onClick={() => setShowNewCompany(false)}>x</button>
            </header>
            {createdCompany ? (
              <div className="admin-created-access">
                <strong>Company created</strong>
                <p>The company workspace is active and ready for sign in.</p>
                <dl><dt>Business</dt><dd>{createdCompany.business_name}</dd><dt>Email</dt><dd>{createdCompany.email}</dd></dl>
                <button type="button" className="admin-primary" onClick={() => setShowNewCompany(false)}>Done</button>
              </div>
            ) : (
              <form onSubmit={handleCreateCompany} className="admin-user-form">
                <label>Company profile name<input required minLength={2} maxLength={200} autoFocus value={newCompany.business_name} onChange={(event) => setNewCompany((value) => ({ ...value, business_name: event.target.value }))} /></label>
                <label className="admin-company-logo-field">
                  Company logo
                  <span className="admin-company-logo-control">
                    <span className="admin-company-logo-preview">{newCompany.logo_data_url ? <img src={newCompany.logo_data_url} alt="Company logo preview" /> : <span aria-hidden="true">+</span>}</span>
                    <span><input required type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const logo_data_url = await readCompanyLogo(file);
                        setNewCompany((value) => ({ ...value, logo_data_url }));
                        setCompanyLogoError("");
                      } catch (reason) {
                        setNewCompany((value) => ({ ...value, logo_data_url: "" }));
                        setCompanyLogoError(reason instanceof Error ? reason.message : "The logo could not be used.");
                      }
                    }} /><small>PNG, JPEG, or WebP. Maximum 256 KB.</small></span>
                  </span>
                </label>
                <label>Email<input required type="email" autoComplete="email" value={newCompany.email} onChange={(event) => setNewCompany((value) => ({ ...value, email: event.target.value }))} /></label>
                <label>Password<input required type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} value={newCompany.password} onChange={(event) => setNewCompany((value) => ({ ...value, password: event.target.value }))} /><small>Use at least 12 characters.</small></label>
                <label className="admin-password-toggle"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /><span>Show password</span></label>
                {companyLogoError && <div className="admin-error">{companyLogoError}</div>}
                {createCompany.isError && <div className="admin-error">{apiMessage(createCompany.error, "The company could not be created.")}</div>}
                <div className="admin-form-actions"><button type="button" onClick={() => setShowNewCompany(false)}>Cancel</button><button className="admin-primary" type="submit" disabled={createCompany.isPending || !newCompany.logo_data_url}>{createCompany.isPending ? "Creating..." : "Create company"}</button></div>
              </form>
            )}
          </section>
        </div>
      )}

      {showNewRequest && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setShowNewRequest(false)}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="new-request-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2 id="new-request-title">Record data request</h2><p>Create a tracked candidate privacy request with a 30-day due date.</p></div><button type="button" aria-label="Close" onClick={() => setShowNewRequest(false)}>x</button></header>
            <form className="admin-user-form" onSubmit={(event) => { event.preventDefault(); createDataRequest.mutate(); }}>
              <label>Company<select required value={newRequest.provider_id} onChange={(event) => setNewRequest((value) => ({ ...value, provider_id: event.target.value }))}><option value="">Select company</option>{(companies.data || []).filter((company) => company.organization_id).map((company) => <option key={company.provider_id} value={company.provider_id}>{company.company_name}</option>)}</select></label>
              <label>Request type<select value={newRequest.request_type} onChange={(event) => setNewRequest((value) => ({ ...value, request_type: event.target.value }))}><option value="access">Access</option><option value="export">Portable export</option><option value="delete">Deletion</option></select></label>
              <label>Candidate email<input required type="email" value={newRequest.candidate_email} onChange={(event) => setNewRequest((value) => ({ ...value, candidate_email: event.target.value }))} /></label>
              <label>Requestor name<input value={newRequest.requestor_name} onChange={(event) => setNewRequest((value) => ({ ...value, requestor_name: event.target.value }))} /></label>
              <label>Intake notes<textarea rows={3} value={newRequest.notes} onChange={(event) => setNewRequest((value) => ({ ...value, notes: event.target.value }))} placeholder="Request channel and initial verification information" /></label>
              {createDataRequest.isError && <div className="admin-error">{apiMessage(createDataRequest.error, "The request could not be recorded.")}</div>}
              <div className="admin-form-actions"><button type="button" onClick={() => setShowNewRequest(false)}>Cancel</button><button className="admin-primary" type="submit" disabled={createDataRequest.isPending}>{createDataRequest.isPending ? "Recording..." : "Record request"}</button></div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
