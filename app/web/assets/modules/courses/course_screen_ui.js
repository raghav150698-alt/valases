export function formatInrDisplay(value) {
  const amt = Number(value || 0);
  const safe = Number.isFinite(amt) && amt > 0 ? amt : 999;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(safe);
}

export function starsHtml(avg, count) {
  const c = Number(count || 0);
  const a = Number(avg || 0);
  if (!Number.isFinite(a) || !Number.isFinite(c) || c <= 0) return "";
  const rounded = Math.round(a * 2) / 2;
  const full = Math.floor(rounded);
  const half = rounded - full >= 0.5 ? 1 : 0;
  const empty = Math.max(0, 5 - full - half);
  const fullS = "&#9733;".repeat(full);
  const halfS = half ? "&#10697;" : "";
  const emptyS = "&#9734;".repeat(empty);
  return `${fullS}${halfS}${emptyS} ${rounded.toFixed(1)}`;
}

function flattenLessons(modules) {
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((m) => (Array.isArray(m.lessons) ? m.lessons : []));
}

function estimatedMinutesFromLessons(lessons) {
  let seconds = 0;
  for (const l of lessons) {
    const topics = Array.isArray(l?.topics) ? l.topics : [];
    const maxSec = topics.reduce((mx, t) => Math.max(mx, Number(t?.time_seconds || 0)), 0);
    seconds += Math.max(0, maxSec);
  }
  return Math.max(0, Math.round(seconds / 60));
}

function descriptionWithoutLevel(text) {
  const src = String(text || "");
  return src
    .replace(/\n?Level:\s*[^\n]+/gi, "")
    .replace(/\n?IntroVideo:\s*https?:\/\/\S+/gi, "")
    .trim();
}

function deriveLevel(text) {
  const match = String(text || "").match(/Level:\s*([^\n]+)/i);
  return match?.[1]?.trim() || "Beginner";
}

function listifyDescription(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^level\s*:/i.test(s))
    .filter((s) => !/^introvideo\s*:/i.test(s))
    .slice(0, 8);
}

export function renderStudentAvailableCourseScreen(detail, el) {
  const lessons = flattenLessons(detail?.modules || []);
  const lessonsCount = lessons.length;
  const minutes = Math.max(0, Number(detail?.duration_minutes || 0) || estimatedMinutesFromLessons(lessons));
  const rating = starsHtml(detail?.average_rating, detail?.rating_count);
  const provider = String(detail?.provider_name || "Provider");
  const description = descriptionWithoutLevel(detail?.description || "");
  const aboutLines = listifyDescription(detail?.description || "");
  const contentText = lessonsCount > 0
    ? lessons.map((l, i) => `${i + 1}. ${String(l?.title || "Untitled lesson")}`).join("\n")
    : "No lessons added yet.";

  if (el.studentAvailableCourseTitle) el.studentAvailableCourseTitle.textContent = String(detail?.title || "Course Details");
  if (el.studentAvailableCourseTopMeta) {
    const ratingText = rating ? `<span class="course-meta-pill">${rating}</span>` : "";
    el.studentAvailableCourseTopMeta.innerHTML = `
      <span class="course-meta-pill"><span class="meta-icon">&#128101;</span> ${Number(detail?.enrolled_count || 0)} students</span>
      <span class="course-meta-pill"><span class="meta-icon">&#9201;</span> ${minutes} mins</span>
      <span class="course-meta-pill"><span class="meta-icon">&#128218;</span> ${lessonsCount} lessons</span>
      ${ratingText}
    `;
  }
  if (el.studentAvailableCourseMeta) el.studentAvailableCourseMeta.textContent = `By ${provider}`;
  if (el.studentAvailableCourseDescription) el.studentAvailableCourseDescription.textContent = description || "Description not available.";
  if (el.studentAvailableCourseAbout) {
    el.studentAvailableCourseAbout.innerHTML = aboutLines.length
      ? aboutLines.map((line) => `<div>• ${line}</div>`).join("")
      : "No additional course overview available.";
  }
  if (el.studentAvailableCourseContent) {
    el.studentAvailableCourseContent.innerHTML = lessonsCount > 0
      ? `<pre class="course-content-list">${contentText}</pre>`
      : contentText;
  }
  if (el.studentAvailableCoursePrice) {
    const displayPrice = detail?.base_price_amount || detail?.final_price_amount || 0;
    el.studentAvailableCoursePrice.textContent = formatInrDisplay(displayPrice);
  }
  if (el.studentAvailableCourseLevel) el.studentAvailableCourseLevel.textContent = deriveLevel(detail?.description || "");
  if (el.studentAvailableCourseLanguage) el.studentAvailableCourseLanguage.textContent = "English";
  if (el.studentAvailableCourseViews) el.studentAvailableCourseViews.textContent = "3x";
}
