import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transformWithEsbuild } from "vite";

async function loadTypeScript(relativePath, options = {}) {
  let source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  if (source.includes('import toolFixtureData from "./toolAssessmentFixtures.json";')) {
    const fixture = await readFile(new URL("../src/dev/toolAssessmentFixtures.json", import.meta.url), "utf8");
    source = source.replace('import toolFixtureData from "./toolAssessmentFixtures.json";', `const toolFixtureData = ${fixture};`);
  }
  if (source.includes('import englishAssessment from "./englishAssessmentFixture.json";')) {
    const fixture = await readFile(new URL("../src/dev/englishAssessmentFixture.json", import.meta.url), "utf8");
    source = source.replace('import englishAssessment from "./englishAssessmentFixture.json";', `const englishAssessment = ${fixture};`);
    const ukFixture = await readFile(new URL("../src/dev/englishAssessmentUkFixture.json", import.meta.url), "utf8");
    source = source.replace('import englishAssessmentUk from "./englishAssessmentUkFixture.json";', `const englishAssessmentUk = ${ukFixture};`);
  }
  const result = await transformWithEsbuild(source, "preview-test.ts", { loader: "ts", format: "esm", target: "es2022", ...options });
  return import(`data:text/javascript;base64,${Buffer.from(result.code).toString("base64")}`);
}
const { previewResponse, PreviewRequestError } = await loadTypeScript("../src/dev/workspacePreviewData.ts");
const { createListeningTrial } = await loadTypeScript("../src/features/provider/englishListeningBank.ts");
const { createPracticalTrial } = await loadTypeScript("../src/features/provider/practicalCaseBank.ts");

test("all thirty practical cases can be selected, keys match, and restart avoids previous case", () => {
  const rows = previewResponse("get", "/provider/workspace/assessments");
  for (const row of rows.filter(item => item.task?.metadata?.case_bank)) {
    const cases = row.task.metadata.case_bank.cases;
    for (let index = 0; index < 30; index++) {
      const selected = createPracticalTrial(row.task, [], () => index);
      assert.equal(selected.metadata.case_id, cases[index].metadata.case_id);
      assert.deepEqual(selected.expected_output, cases[index].expected_output);
      assert.equal(selected.metadata.case_bank, undefined);
    }
    const first = createPracticalTrial(row.task, [], () => 0);
    const second = createPracticalTrial(row.task, [first.metadata.case_id], () => 0);
    assert.notEqual(second.metadata.case_id, first.metadata.case_id);
    first.metadata.case_id = "changed";
    assert.notEqual(cases[0].metadata.case_id, "changed");
  }
});

test("demo includes every practical tool with full task content and scoring", () => {
  const rows = previewResponse("get", "/provider/workspace/assessments");
  for (const kind of ["coding", "accounting", "tax_simulator", "tax_1120", "spreadsheet"]) {
    const row = rows.find(item => item.assessment_type === kind);
    assert.ok(row, `${kind} missing from demo`);
    assert.ok(row.task.description.length > 50, kind);
    if (kind === "coding") assert.equal(row.task.grading_config.manual_review_required, true);
    else assert.ok(row.task.grading_config.checkpoints.length > 2, kind);
    assert.equal(row.checkpoint_count, row.task.grading_config.checkpoints?.length || 0);
    assert.equal(row.task.metadata.case_bank.cases.length, 30);
    const libraryRow = previewResponse("get", `/exams/default-library/${row.template_key}`);
    assert.deepEqual(libraryRow.task, row.task);
  }
  assert.ok(rows.find(row => row.assessment_type === "coding").task.metadata.starter_code.includes("solve"));
  assert.ok(Object.keys(rows.find(row => row.assessment_type === "spreadsheet").task.metadata.initial_spreadsheet_data).length > 50);
  assert.equal(rows.find(row => row.assessment_type === "tax_simulator").task.metadata.tax_year, 2025);
  assert.ok(rows.find(row => row.assessment_type === "accounting").task.metadata.workpaper.documents.length);
});

test("candidate test restarts select fresh conversations with matching keys", () => {
  const english = previewResponse("get", "/provider/workspace/assessments").find(row => row.assessment_type === "english_language");
  const before = structuredClone(english.task);
  const first = createListeningTrial(english.task, [], () => 0);
  const firstIds = first.metadata.listening_selection.conversation_ids;
  const second = createListeningTrial(english.task, firstIds, length => length - 1);
  assert.ok(second.metadata.listening_selection.conversation_ids.every(id => !firstIds.includes(id)));
  for (const trial of [first, second]) {
    assert.equal(Object.keys(trial.expected_output.objective_answers).length, 18);
    const items = trial.metadata.sections[0].items;
    assert.equal(items.filter(item => item.type === "audio").length, 1);
    for (const question of items.filter(item => item.type === "choice")) {
      assert.ok(question.options.includes(trial.expected_output.objective_answers[question.id]));
    }
  }
  assert.deepEqual(english.task, before);
});

test("English trial uses complete catalog tasks and objective answer keys", async () => {
  const english = previewResponse("get", "/provider/workspace/assessments").find(row => row.assessment_type === "english_language");
  const sections = english.task.metadata.sections;
  assert.deepEqual(sections.map(section => section.id), ["listening", "reading", "writing", "speaking"]);
  assert.equal(sections.reduce((sum, section) => sum + section.minutes, 0), 60);
  for (const item of sections.flatMap(section => section.items).filter(item => item.options)) {
    assert.ok(item.options.includes(english.task.expected_output.objective_answers[item.id]), item.id);
  }
  const backend = await readFile(new URL("../../services/default_assessments.py", import.meta.url), "utf8");
  assert.ok(backend.includes(sections[3].items[3].prompt));
});

test("recruiters can test US and UK with isolated regional pools", () => {
  const choices = previewResponse("get", "/provider/workspace/assessments").filter(row => row.assessment_type === "english_language");
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map(row => row.task.metadata.english_locale).sort(), ["en-GB", "en-US"]);
  const pools = choices.map(row => row.task.metadata.listening_bank.conversations.map(audio => audio.id));
  assert.deepEqual(pools.map(pool => pool.length).sort(), [15, 15]);
  assert.ok(pools[0].every(id => !pools[1].includes(id)));
  for (const choice of choices) {
    assert.equal(choice.task.metadata.listening_quality.recording_count, 15);
    assert.equal(choice.task.metadata.listening_quality.calibration_status, "Not calibrated");
    const trial = createListeningTrial(choice.task);
    assert.equal(trial.metadata.listening_selection.conversation_ids.length, 1);
    assert.ok(trial.metadata.listening_bank.conversations.every(row => row.locales.includes(choice.task.metadata.english_locale)));
  }
});

test("all recruiter navigation datasets are available without a backend", () => {
  const workspace = previewResponse("get", "/hiring/workspace");
  for (const resource of ["jobs", "candidates", "applications", "interviews", "offers", "onboarding", "integrations", "members"]) {
    const rows = previewResponse("get", `/hiring/${resource}`);
    assert.ok(Array.isArray(rows) && rows.length > 0, resource);
  }
  assert.equal(workspace.metrics.applications, previewResponse("get", "/hiring/applications").length);
  assert.equal(Object.values(workspace.pipeline).reduce((sum, count) => sum + count, 0), workspace.metrics.applications);
  assert.equal(previewResponse("get", "/billing/organization").provider_ready, false);
  assert.deepEqual(previewResponse("get", "/hiring/integrations").map(row => row.provider), ["google_calendar", "outlook_calendar"]);
});
test("candidate details, assessment reviews and library previews resolve", () => {
  for (const row of previewResponse("get", "/hiring/applications")) {
    const detail = previewResponse("get", `/hiring/applications/${row.id}`);
    assert.equal(detail.candidate.id, row.candidate.id);
    assert.equal(detail.job.id, row.job_id);
  }
  for (const row of previewResponse("get", "/exams/issued/by-me")) {
    assert.equal(previewResponse("get", `/exams/issued/${row.issued_id}/review`).issued_id, row.issued_id);
  }
  for (const row of previewResponse("get", "/exams/default-library")) {
    assert.equal(previewResponse("get", `/exams/default-library/${row.id}`).id, row.id);
  }
});
test("screening filters and fixture copies are isolated", () => {
  const filtered = previewResponse("get", "/hiring/applications", { stage: "screening" });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every(row => row.stage === "screening"));
  filtered[0].candidate.full_name = "Changed locally";
  assert.notEqual(previewResponse("get", "/hiring/applications", { stage: "screening" })[0].candidate.full_name, "Changed locally");
});
test("all mutation methods fail locally, including email, auth and payments", () => {
  for (const method of ["post", "patch", "put", "delete", "POST"]) {
    for (const route of ["/hiring/jobs", "/hiring/email/test", "/billing/checkout", "/auth/login"]) {
      assert.throws(() => previewResponse(method, route), error => error instanceof PreviewRequestError && error.response.status === 403);
    }
  }
});
test("unknown reads and absolute URLs cannot fall through to real services", () => {
  for (const route of ["/admin/workspace/users", "/not-a-fixture", "https://example.com/hiring/workspace"]) {
    assert.throws(() => previewResponse("get", route), error => error instanceof PreviewRequestError && error.response.status === 404);
  }
});
test("preview entry requires development mode, loopback host and explicit opt-in", async () => {
  for (const [dev, hostname, search, expected] of [
    [true, "127.0.0.1", "?ui-preview=1", true],
    [true, "localhost", "?ui-preview=1", true],
    [true, "[::1]", "?ui-preview=1", true],
    [true, "127.0.0.1", "", false],
    [true, "127.0.0.1", "?ui-preview=0", false],
    [true, "app.example.com", "?ui-preview=1", false],
    [false, "127.0.0.1", "?ui-preview=1", false],
    [false, "app.example.com", "?ui-preview=1", false],
  ]) {
    const module = await loadTypeScript("../src/lib/uiPreview.ts", { define: {
      "import.meta.env.DEV": String(dev),
      window: JSON.stringify({ location: { hostname, search } }),
    } });
    assert.equal(module.isLocalUiPreview, expected, `${dev} ${hostname} ${search}`);
  }
});
