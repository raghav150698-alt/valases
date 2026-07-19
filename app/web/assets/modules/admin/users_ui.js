export function createAdminUsersUi({
  state,
  el,
  api,
  toast,
  renderList,
  renderSimpleStats,
  escapeHtmlAttr,
}) {
  function renderApprovalsTab() {
    const isStudents = state.approvalsTab === "students";
    el.studentsApprovalPane?.classList.toggle("hidden", !isStudents);
    el.providersApprovalPane?.classList.toggle("hidden", isStudents);
    document.querySelectorAll(".approval-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.approvalTab === state.approvalsTab));
  }

  async function adminUserAction(userId, action) {
    const uid = Number(userId || 0);
    if (!uid) return;
    let reason = "";
    if (action === "ban") reason = prompt("Reason for ban") || "Banned by admin";
    if (action === "freeze") reason = prompt("Reason for freeze") || "Frozen by admin";
    if (action === "delete") {
      const ok = confirm("Mark this account as deleted?");
      if (!ok) return;
      reason = "Deleted by admin";
    }
    await api("POST", `/admin/users/${uid}/state`, { action, reason });
    toast(`User ${action} action applied`);
    await refreshAdminUsers();
  }

  function userStateLabel(item) {
    const accountState = String(item?.account_state || "active").toLowerCase();
    if (accountState === "banned") return "Banned";
    if (accountState === "frozen") return "Frozen";
    if (accountState === "deleted") return "Deleted";
    return "Active";
  }

  function renderAdminUsersList(target, items, emptyText) {
    renderList(
      target,
      items,
      (u) => `
        <div><strong>${escapeHtmlAttr(u.full_name || "User")}</strong> (${escapeHtmlAttr(u.email || "-")})</div>
        <div class="meta">User ID: ${u.user_id} | State: ${escapeHtmlAttr(userStateLabel(u))} | Phone: ${escapeHtmlAttr(u.phone_number || "-")}</div>
        <div class="meta">KYC: ${escapeHtmlAttr(u.verification?.id_type || "-")} | ${escapeHtmlAttr(u.verification?.id_number || "-")}</div>
        <div class="actions">
          <button class="btn small" data-admin-user-active="${u.user_id}">Activate</button>
          <button class="btn small" data-admin-user-freeze="${u.user_id}">Freeze</button>
          <button class="btn small danger" data-admin-user-ban="${u.user_id}">Ban</button>
          <button class="btn small danger" data-admin-user-delete="${u.user_id}">Delete</button>
        </div>
      `,
      emptyText,
    );
  }

  async function refreshAdminUsers() {
    const query = encodeURIComponent(String(el.adminUsersSearch?.value || "").trim());
    const studentsResp = await api("GET", `/admin/users?role=students&q=${query}`);
    const providersResp = await api("GET", `/admin/users?role=providers&q=${query}`);
    const students = studentsResp.items || [];
    const providers = providersResp.items || [];

    renderSimpleStats(el.approvalSummary, {
      Students: studentsResp.total || 0,
      Providers: providersResp.total || 0,
    });

    renderAdminUsersList(el.pendingStudents, students, "No students found.");
    renderAdminUsersList(el.pendingProviders, providers, "No providers found.");

    document.querySelectorAll("[data-admin-user-active]").forEach((btn) => btn.addEventListener("click", () => adminUserAction(btn.dataset.adminUserActive, "active")));
    document.querySelectorAll("[data-admin-user-freeze]").forEach((btn) => btn.addEventListener("click", () => adminUserAction(btn.dataset.adminUserFreeze, "freeze")));
    document.querySelectorAll("[data-admin-user-ban]").forEach((btn) => btn.addEventListener("click", () => adminUserAction(btn.dataset.adminUserBan, "ban")));
    document.querySelectorAll("[data-admin-user-delete]").forEach((btn) => btn.addEventListener("click", () => adminUserAction(btn.dataset.adminUserDelete, "delete")));
    renderApprovalsTab();
  }

  return {
    renderApprovalsTab,
    refreshAdminUsers,
  };
}
