import { formatInrDisplay, starsHtml } from "./course_screen_ui.js";

export function createCourseCatalogUi({
  state,
  el,
  api,
  toast,
  formatCourseRating,
  formatSecondsToClock,
  escapeHtmlAttr,
  openStudentCourseViewer,
  openStudentAvailableCourseDetail,
  refreshStudentDashboard,
  findPrimaryLesson,
  findLiveLessons,
  resolveCourseThumbnail,
  canDeleteCourseFromUi,
  fetchVideoDuration,
  openCourseViewer,
  refreshProviderContent,
}) {
  const fallbackCourseThumb = "/assets/classagon_logo.png?v=20260422c";

  function courseThumbSrc(course, lesson = null) {
    const src = resolveCourseThumbnail(course, lesson);
    return src || fallbackCourseThumb;
  }

  function safeCourseTime(value) {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  }

  function studentCourseFilterSort(items, searchRaw, sortKey) {
    const q = String(searchRaw || "").trim().toLowerCase();
    let out = Array.isArray(items) ? [...items] : [];
    if (q) {
      out = out.filter((c) => {
        const hay = [
          c?.title || "",
          c?.provider_name || "",
          c?.category || "",
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    const key = String(sortKey || "latest").toLowerCase();
    out.sort((a, b) => {
      if (key === "rating_desc") {
        const ar = Number(a?.average_rating || 0);
        const br = Number(b?.average_rating || 0);
        if (br !== ar) return br - ar;
      } else if (key === "title_asc") {
        return String(a?.title || "").localeCompare(String(b?.title || ""));
      } else if (key === "provider_asc") {
        return String(a?.provider_name || "").localeCompare(String(b?.provider_name || ""));
      } else if (key === "progress_desc") {
        const ap = Number(a?.progress_pct || 0);
        const bp = Number(b?.progress_pct || 0);
        if (bp !== ap) return bp - ap;
      }
      return safeCourseTime(b?.created_at || b?.enrolled_at) - safeCourseTime(a?.created_at || a?.enrolled_at);
    });
    return out;
  }

  function providerCourseFilterSort(items, searchRaw, sortKey) {
    const q = String(searchRaw || "").trim().toLowerCase();
    let out = Array.isArray(items) ? [...items] : [];
    if (q) {
      out = out.filter((c) => {
        const hay = [
          c?.title || "",
          c?.provider_name || "",
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    const key = String(sortKey || "latest").toLowerCase();
    out.sort((a, b) => {
      if (key === "rating_desc") {
        const ar = Number(a?.average_rating || 0);
        const br = Number(b?.average_rating || 0);
        if (br !== ar) return br - ar;
      } else if (key === "title_asc") {
        return String(a?.title || "").localeCompare(String(b?.title || ""));
      } else if (key === "status_active") {
        const aRank = a?.is_published ? 0 : 1;
        const bRank = b?.is_published ? 0 : 1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return safeCourseTime(b?.created_at) - safeCourseTime(a?.created_at);
    });
    return out;
  }

  function providerCourseStatusLabel(course) {
    const raw = String(course?.status || "").trim().toLowerCase();
    if (raw === "draft" || course?.is_draft || course?.draft_id) return "Draft";
    if (course?.is_published) return "Active";
    return "Inactive";
  }

  function providerCourseDifficultyPct(course) {
    const passPct = Number(course?.pass_percentage);
    if (Number.isFinite(passPct)) return Math.max(0, Math.min(100, 100 - passPct));
    const explicit = Number(course?.difficulty_pct ?? course?.difficulty_percent ?? course?.difficulty_score);
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
    const level = String(course?.level || "").toLowerCase();
    if (level.includes("begin")) return 35;
    if (level.includes("inter")) return 65;
    if (level.includes("adv")) return 88;
    return 55;
  }

  function toggleFilterPopover(menu, trigger, show) {
    if (!menu) return;
    const next = typeof show === "boolean" ? show : menu.classList.contains("hidden");
    [el.studentAvailableFilterMenu, el.studentEnrolledFilterMenu, el.studentAssessmentsFilterMenu, el.studentCertificationsFilterMenu, el.providerCoursesFilterMenu].forEach((node) => {
      if (node && node !== menu) node.classList.add("hidden");
    });
    menu.classList.toggle("hidden", !next);
    if (trigger) trigger.classList.toggle("active", next);
  }

  function renderStudentCourseGrid(target, items, { enrolled = false } = {}) {
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<div class="item"><div class="meta">No items</div><div style="margin-top:4px;">No courses found for current search/filter.</div></div>`;
      return;
    }
    const studentDifficultyMeta = (course) => {
      const tag = String(course?.difficulty_tag || "").trim();
      const attempts = Number(course?.difficulty_attempt_count || 0);
      if (!tag || attempts < 15) return "";
      const passRate = Number(course?.difficulty_pass_rate_pct);
      const passText = Number.isFinite(passRate) ? ` | Pass rate ${passRate.toFixed(0)}%` : "";
      return `Difficulty: ${tag[0].toUpperCase()}${tag.slice(1)}${passText}`;
    };
    const cards = items.map((c) => {
      const thumbSrc = courseThumbSrc(c);
      const thumbClass = thumbSrc === fallbackCourseThumb ? "course-tile-thumb is-logo" : "course-tile-thumb";
      const progress = Math.max(0, Math.min(100, Number(c.progress_pct || 0)));
      const moduleLessonCount = Array.isArray(c.modules)
        ? c.modules.reduce((acc, m) => acc + (Array.isArray(m?.lessons) ? m.lessons.length : 0), 0)
        : 0;
      const liveLessonCount = Array.isArray(c.modules)
        ? c.modules.reduce(
          (acc, m) => acc + (Array.isArray(m?.lessons) ? m.lessons.filter((l) => String(l?.lesson_type || "") === "live_class_link").length : 0),
          0,
        )
        : 0;
      const totalLessons = Math.max(0, Number(c.total_lessons || c.lesson_count || moduleLessonCount || 0) || 0);
      const viewedLessons = Math.max(
        0,
        Number(c.viewed_lessons || c.lessons_started || 0) ||
          (c.lesson_views && typeof c.lesson_views === "object" ? Object.keys(c.lesson_views).length : 0),
      );
      const enrollmentStatus = String(c.status || "active").replaceAll("_", " ");
      const assessmentLine = c.assessment_available
        ? "Assessment available"
        : c.exam_eligible
          ? "Assessment not yet published"
          : "Assessment locked";
      const difficultyLine = studentDifficultyMeta(c);
      const publishedAssessments = Math.max(0, Number(c.published_assessments || 0));
      const ratingText = starsHtml(c.average_rating, c.rating_count);
      const displayPrice = formatInrDisplay(c.base_price_amount || c.final_price_amount || 0);
      const durationMinutes = Math.max(0, Number(c.duration_minutes || 0));
      const levelText = String((c.description || "").match(/Level:\s*([^\n]+)/i)?.[1] || "All levels");
      return `
        <article class="course-tile course-tile-elevated ${enrolled ? "course-tile-enrolled" : "course-tile-available"}" data-course-card="${Number(c.course_id || 0)}" data-course-card-mode="${enrolled ? "enrolled" : "available"}">
          <img src="${escapeHtmlAttr(thumbSrc)}" alt="" class="${thumbClass}" onerror="this.onerror=null;this.src='${fallbackCourseThumb}';this.className='course-tile-thumb is-logo';" />
          <div class="course-tile-body">
            <p class="course-kicker">${escapeHtmlAttr(c.category || "course")}</p>
            <div class="course-tile-header-row">
              <div>
                <h4 class="course-tile-title">${escapeHtmlAttr(c.title || "Untitled Course")}</h4>
                <div class="course-tile-meta course-tile-description">${escapeHtmlAttr(String(c.description || "").trim() || "No description provided.")}</div>
              </div>
              ${enrolled ? `<span class="course-status-badge">${escapeHtmlAttr(enrollmentStatus)}</span>` : ""}
            </div>
            <div class="course-tile-meta course-chip-row">
              <span class="course-chip">${escapeHtmlAttr(levelText)}</span>
              <span class="course-chip">Lessons: ${totalLessons}</span>
              ${liveLessonCount > 0 ? `<span class="course-chip">Live: ${liveLessonCount}</span>` : ""}
            </div>
            ${difficultyLine ? `<div class="course-tile-meta">${escapeHtmlAttr(difficultyLine)}</div>` : ""}
            ${
              enrolled
                ? `
                  <div class="course-tile-progress">
                    <div class="course-tile-progress-bar" style="width:${progress}%;"></div>
                  </div>
                  <div class="course-tile-meta course-progress-meta">
                    <span>${progress.toFixed(0)}% completed</span>
                    <span>${escapeHtmlAttr(assessmentLine)}</span>
                  </div>
                `
                : `<div class="course-tile-meta course-available-note">Enroll to unlock course player, assessments, and certificate eligibility.</div>`
            }
            <div class="course-card-footer">
              <div class="course-card-footer-left">
                ${ratingText ? `<div class="course-rating-line">${ratingText}</div>` : ""}
                <div class="course-tile-provider byline">By ${escapeHtmlAttr(c.provider_name || "Provider")}</div>
              </div>
              <div class="course-tile-price course-tile-price-emphasis">${displayPrice}</div>
            </div>
          </div>
        </article>
      `;
    }).join("");
    target.innerHTML = `<div class="course-tile-grid ${enrolled ? "course-tile-grid-enrolled" : ""}">${cards}</div>`;

    target.querySelectorAll("[data-course-card]").forEach((card) => {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      const cid = Number(card.getAttribute("data-course-card") || 0);
      const mode = String(card.getAttribute("data-course-card-mode") || "available");
      const open = async () => {
        if (!cid) return;
        if (mode === "enrolled") await openStudentCourseViewer(cid);
        else await openStudentAvailableCourseDetail(cid);
      };
      card.addEventListener("click", () => open().catch((err) => toast(err?.message || "Failed to open course", "error")));
      card.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        open().catch((err) => toast(err?.message || "Failed to open course", "error"));
      });
    });
  }

  function renderStudentCourseCatalogs() {
    const available = studentCourseFilterSort(
      state.studentDashboard.available || [],
      el.studentAvailableSearch?.value || "",
      el.studentAvailableSort?.value || "latest",
    );
    const enrolled = studentCourseFilterSort(
      state.studentDashboard.enrolled || [],
      el.studentEnrolledSearch?.value || "",
      el.studentEnrolledSort?.value || "latest",
    );
    renderStudentCourseGrid(el.studentAvailableCourses, available, { enrolled: false });
    renderStudentCourseGrid(el.studentEnrolledCourses, enrolled, { enrolled: true });
  }

  function renderProviderCourseCatalog() {
    const courses = providerCourseFilterSort(
      state.providerCourses || [],
      el.providerCoursesSearch?.value || "",
      el.providerCoursesSort?.value || "latest",
    );
    if (!el.providerCoursesList) return;
    if (!courses.length) {
      el.providerCoursesList.innerHTML = `<div class="item"><div style="margin-top:4px;">No courses found for current search/filter.</div></div>`;
      return;
    }
    const cards = courses.map((c) => {
      const firstLesson = findPrimaryLesson(c);
      const firstLiveLesson = findLiveLessons(c)[0] || null;
      const thumb = courseThumbSrc(c, firstLesson);
      const thumbClass = thumb === fallbackCourseThumb ? "course-tile-thumb is-logo" : "course-tile-thumb";
      const durationLabel = firstLesson?.recorded_video_url
        ? (state.videoDurationByUrl[firstLesson.recorded_video_url] != null
          ? formatSecondsToClock(state.videoDurationByUrl[firstLesson.recorded_video_url])
          : "Loading...")
        : "-";
      const statusLabel = providerCourseStatusLabel(c);
      const postedDate = safeCourseTime(c.created_at) ? new Date(c.created_at).toLocaleDateString() : "-";
      const difficultyPct = providerCourseDifficultyPct(c);
      const ratingText = starsHtml(c.average_rating, c.rating_count);
      const displayPrice = formatInrDisplay(c.base_price_amount || c.final_price_amount || 0);
      const levelText = String((c.description || "").match(/Level:\s*([^\n]+)/i)?.[1] || "All levels");
      return `
        <article class="course-tile course-tile-elevated provider-course-tile course-tile-provider-owned" data-provider-course-open="${c.id}">
          ${canDeleteCourseFromUi() ? `<button class="btn small danger icon-action-btn course-tile-delete-corner" data-delete-course="${c.id}" title="Delete Course" aria-label="Delete Course"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M19 6l-1 13.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5L5 6"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/></svg></button>` : ""}
          <img src="${escapeHtmlAttr(thumb)}" alt="" class="${thumbClass}" onerror="this.onerror=null;this.src='${fallbackCourseThumb}';this.className='course-tile-thumb is-logo';" />
          <div class="course-tile-body">
            <p class="course-kicker">${escapeHtmlAttr(c.category || "course")}</p>
            <div class="course-tile-header-row">
              <div>
                <h4 class="course-tile-title">${escapeHtmlAttr(c.title || "Untitled Course")}</h4>
                <div class="course-tile-meta course-tile-description">${escapeHtmlAttr(String(c.description || "").trim() || "No description provided.")}</div>
              </div>
              <span class="course-status-badge">${escapeHtmlAttr(statusLabel)}</span>
            </div>
            <div class="course-tile-meta course-chip-row">
              <span class="course-chip">${escapeHtmlAttr(levelText)}</span>
              <span class="course-chip">Lessons: ${Math.max(0, Number(c.lesson_count || (Array.isArray(c.modules) ? c.modules.reduce((acc, m) => acc + (Array.isArray(m?.lessons) ? m.lessons.length : 0), 0) : 0) || 0))}</span>
              <span class="course-chip">Duration <span data-course-duration="${c.id}">${durationLabel}</span></span>
            </div>
            <div class="course-tile-meta">Difficulty</div>
            <div class="course-difficulty-meter">
              <div class="course-difficulty-fill" style="width:${difficultyPct}%;"></div>
            </div>
            <div class="course-tile-meta">${difficultyPct.toFixed(0)}% relative difficulty</div>
            <div class="course-card-footer">
              <div class="course-card-footer-left">
                ${ratingText ? `<div class="course-rating-line">${ratingText}</div>` : ""}
                <div class="course-tile-provider byline">By You</div>
              </div>
              <div class="course-tile-price course-tile-price-emphasis">${displayPrice}</div>
            </div>
            <div class="actions course-actions-row">
              ${firstLiveLesson?.live_class_url ? `<button class="btn small" data-open-live-course="${c.id}">Open Live Class</button>` : ""}
              ${c.is_published ? `<button class="btn small" data-deactivate-course="${c.id}">Deactivate</button>` : ""}
              ${!c.is_published ? `<button class="btn small" data-activate-course="${c.id}">Activate Course</button>` : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");
    el.providerCoursesList.innerHTML = `<div class="course-tile-grid">${cards}</div>`;

    const durationTasks = courses.map(async (course) => {
      const lesson = findPrimaryLesson(course);
      if (!lesson?.recorded_video_url) return;
      const sec = await fetchVideoDuration(lesson.recorded_video_url);
      const label = document.querySelector(`[data-course-duration="${course.id}"]`);
      if (label) label.textContent = sec != null ? formatSecondsToClock(sec) : "-";
    });
    Promise.all(durationTasks).catch(() => {});

    document.querySelectorAll("[data-provider-course-open]").forEach((card) => {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      const cid = Number(card.getAttribute("data-provider-course-open") || 0);
      const open = () => openCourseViewer(cid);
      card.addEventListener("click", (ev) => {
        if (ev.target?.closest?.(".actions") || ev.target?.closest?.(".course-tile-delete-corner")) return;
        open();
      });
      card.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        if (ev.target?.closest?.(".actions") || ev.target?.closest?.(".course-tile-delete-corner")) return;
        ev.preventDefault();
        open();
      });
    });
    document.querySelectorAll("[data-open-live-course]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const course = state.providerCourses.find((c) => Number(c.id) === Number(btn.dataset.openLiveCourse));
        const lesson = findLiveLessons(course)[0];
        if (!lesson?.live_class_url) return toast("No live class link available", "error");
        window.open(lesson.live_class_url, "_blank", "noopener,noreferrer");
      });
    });
    document.querySelectorAll("[data-activate-course]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const courseId = Number(btn.dataset.activateCourse || 0);
        if (!courseId) return;
        try {
          await api("POST", `/courses/${courseId}/publish`);
          toast("Course activated");
          await refreshProviderContent();
        } catch (err) {
          toast(err?.message || "Failed to activate course", "error");
        }
      });
    });
    document.querySelectorAll("[data-deactivate-course]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const courseId = Number(btn.dataset.deactivateCourse || 0);
        if (!courseId) return;
        try {
          await api("POST", `/courses/${courseId}/unpublish`);
          toast("Course hidden from students");
          await refreshProviderContent();
        } catch (err) {
          toast(err?.message || "Failed to deactivate course", "error");
        }
      });
    });
    document.querySelectorAll("[data-delete-course]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const courseId = Number(btn.dataset.deleteCourse || 0);
        const course = state.providerCourses.find((c) => Number(c.id) === courseId);
        const ok = confirm(`Delete course "${course?.title || courseId}"? This will remove its lessons, enrollments, exams, and related records.`);
        if (!ok) return;
        try {
          await api("DELETE", `/courses/${courseId}`);
          toast("Course deleted");
          await refreshProviderContent();
        } catch (err) {
          toast(err?.message || "Failed to delete course", "error");
        }
      });
    });
  }

  return {
    toggleFilterPopover,
    renderStudentCourseCatalogs,
    renderProviderCourseCatalog,
  };
}






