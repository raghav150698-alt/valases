const state = {
  recruiterToken: "",
  candidateToken: "",
  templates: [],
  currentAssessment: null,
};

async function api(method, path, body, token = "") {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : {};
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function msg(id, t) {
  document.getElementById(id).textContent = t || "";
}

async function loadTemplatesAndIssues() {
  if (!state.recruiterToken) return;
  const [templates, issues] = await Promise.all([
    api("GET", "/api/recruiter/templates", null, state.recruiterToken),
    api("GET", "/api/recruiter/issues", null, state.recruiterToken),
  ]);
  state.templates = templates;
  const sel = document.getElementById("issueTemplate");
  sel.innerHTML = templates.map((t) => `<option value="${t.id}">${t.title} (${t.type})</option>`).join("");
  const tbody = document.querySelector("#issuesTable tbody");
  tbody.innerHTML = issues.map((x) => `
    <tr>
      <td>${x.candidate_name}</td>
      <td>${x.candidate_email}</td>
      <td>${x.assessment_title}</td>
      <td>${x.status}</td>
      <td>${x.score_pct == null ? "-" : x.score_pct + "%"}</td>
      <td>${x.passed == null ? "-" : (x.passed ? "PASS" : "FAIL")}</td>
    </tr>
  `).join("");
}

document.getElementById("rSignup").onclick = async () => {
  try {
    const out = await api("POST", "/api/recruiters/signup", {
      name: document.getElementById("rName").value,
      email: document.getElementById("rEmail").value,
      password: document.getElementById("rPass").value,
    });
    state.recruiterToken = out.token;
    msg("rMsg", "Signup success.");
    await loadTemplatesAndIssues();
  } catch (e) { msg("rMsg", e.message); }
};

document.getElementById("rLogin").onclick = async () => {
  try {
    const out = await api("POST", "/api/recruiters/login", {
      email: document.getElementById("rEmail").value,
      password: document.getElementById("rPass").value,
    });
    state.recruiterToken = out.token;
    msg("rMsg", "Login success.");
    await loadTemplatesAndIssues();
  } catch (e) { msg("rMsg", e.message); }
};

document.getElementById("rRefresh").onclick = () => loadTemplatesAndIssues().catch((e) => msg("rMsg", e.message));

document.getElementById("tCreate").onclick = async () => {
  try {
    const questions = JSON.parse(document.getElementById("tQuestions").value || "[]");
    await api("POST", "/api/recruiter/templates", {
      title: document.getElementById("tTitle").value,
      description: document.getElementById("tDesc").value,
      duration_minutes: Number(document.getElementById("tDuration").value || 30),
      pass_score_pct: Number(document.getElementById("tPass").value || 70),
      questions,
    }, state.recruiterToken);
    msg("tMsg", "Assessment created.");
    await loadTemplatesAndIssues();
  } catch (e) { msg("tMsg", e.message); }
};

document.getElementById("issueBtn").onclick = async () => {
  try {
    const templateId = Number(document.getElementById("issueTemplate").value);
    await api("POST", "/api/recruiter/issues", {
      template_id: templateId,
      candidate_name: document.getElementById("cName").value,
      candidate_email: document.getElementById("cEmail").value,
    }, state.recruiterToken);
    msg("issueMsg", "Assessment issued. Credentials sent.");
    await loadTemplatesAndIssues();
  } catch (e) { msg("issueMsg", e.message); }
};

document.getElementById("candLogin").onclick = async () => {
  try {
    const out = await api("POST", "/api/candidate/login", {
      username: document.getElementById("candUser").value,
      password: document.getElementById("candPass").value,
    });
    state.candidateToken = out.token;
    const assessment = await api("GET", "/api/candidate/assessment", null, state.candidateToken);
    state.currentAssessment = assessment;
    renderAssessment(assessment);
    msg("candMsg", "Candidate login success.");
  } catch (e) { msg("candMsg", e.message); }
};

function renderAssessment(data) {
  if (data.status === "completed") {
    document.getElementById("aMeta").textContent = `Already completed: ${data.score_pct}% (${data.passed ? "PASS" : "FAIL"})`;
    document.getElementById("questions").innerHTML = "";
    return;
  }
  document.getElementById("aTitle").textContent = data.assessment_title;
  document.getElementById("aMeta").textContent = `Duration: ${data.duration_minutes} min | Pass score: ${data.pass_score_pct}%`;
  const box = document.getElementById("questions");
  box.innerHTML = data.questions.map((q, idx) => `
    <div class="q">
      <h4>Q${idx + 1}. ${q.text}</h4>
      <div class="opts">
        ${q.options.map((o, oi) => `<label><input type="radio" name="q_${q.qid}" value="${oi}" /> ${o}</label>`).join("")}
      </div>
    </div>
  `).join("");
}

document.getElementById("submitAttempt").onclick = async () => {
  try {
    if (!state.currentAssessment || !state.currentAssessment.questions) throw new Error("No active assessment");
    const answers = {};
    state.currentAssessment.questions.forEach((q) => {
      const picked = document.querySelector(`input[name="q_${q.qid}"]:checked`);
      if (picked) answers[q.qid] = Number(picked.value);
    });
    const out = await api("POST", "/api/candidate/submit", { answers }, state.candidateToken);
    msg("attemptMsg", `Submitted. Score: ${out.score_pct}% | ${out.passed ? "PASS" : "FAIL"}`);
  } catch (e) { msg("attemptMsg", e.message); }
};

(async () => {
  try {
    const cat = await api("GET", "/api/catalog-assessments");
    const sel = document.getElementById("issueTemplate");
    sel.innerHTML = cat.map((t) => `<option value="${t.id}">${t.title} (catalog)</option>`).join("");
  } catch {}
})();
