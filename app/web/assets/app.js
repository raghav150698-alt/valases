import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  setPersistence,
  updateEmail,
  updatePassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { createAssessmentPrecheckUi } from "./modules/assessment/precheck_ui.js";
import { createAssessmentTimer } from "./modules/assessment/timer.js";
import { createAssessmentBuilderUi } from "./modules/assessment/builder_ui.js";
import { createAssessmentPreviewProctorUi } from "./modules/assessment/preview_proctor_ui.js";
import { createUiFeedback } from "./modules/core/ui_feedback.js";
import { createApiClient } from "./modules/core/api_client.js";
import { createCourseCatalogUi } from "./modules/courses/catalog_ui.js";
import { renderStudentAvailableCourseScreen } from "./modules/courses/course_screen_ui.js";
import { createAdminUsersUi } from "./modules/admin/users_ui.js";
import { createLiveClassroomUi } from "./modules/live/classroom_ui.js";

const ASSESSMENT_ONLY_MODE = true;

const state = {
  auth: null,
  context: null,
  authMode: "",
  localAccessToken: "",
  localDummyRole: "",
  localDummyEmail: "",
  localDummyName: "",
  authLoginInFlight: false,
  authLoginFallbackTimer: null,
  authProgressTimer: null,
  authProgressVisible: false,
  authRoleSetupInFlight: false,
  moderationMode: "reports",
  approvalsTab: "students",
  assessmentBuilderStep: 1,
  reports: [],
  complaints: [],
  adminPollingId: null,
  courseWizardStep: "details",
  draftTopics: [],
  activeDraftId: null,
  providerCourses: [],
  providerDrafts: [],
  wizardLocalVideoObjectUrl: "",
  wizardVideoPlaybackUrl: "",
  wizardUploadAbortController: null,
  wizardVideoUploadPromise: null,
  providerAssessments: [],
  providerFeedbackRatings: [],
  providerComplaints: [],
  providerFeedbackTab: "feedback",
  providerFeedbackDetailMode: "",
  providerComplaintsDetailStatus: "",
  providerLiveSessions: [],
  providerLiveEditSessionId: null,
  studentLiveSessions: [],
  studentDashboard: {
    available: [],
    enrolled: [],
    suggested: [],
  },
  studentAvailableDetailCourseId: 0,
  studentAssessments: [],
  studentCertificates: [],
  studentLiveReminderTimers: {},
  studentLiveReminderSent: {},
  viewerTopics: [],
  studentViewerTopics: [],
  studentActiveCourseId: null,
  studentVideoCompletionSent: {},
  studentPlaybackPolicyByCourse: {},
  studentSeekHintAt: 0,
  studentViewerMode: "legacy",
  studentStreamCacheByCourse: {},
  studentStreamPlayback: {
    courseId: 0,
    lessonVideoId: 0,
    sessionId: 0,
    clientApp: "web",
    drmLicenseToken: "",
    drmLicenseExpiresAt: 0,
    positionSeconds: 0,
    durationSeconds: 0,
    heartbeatId: null,
  },
  providerUsingStudentViewer: false,
  studentViewerOriginalParent: null,
  studentViewerOriginalNextSibling: null,
  videoDurationByUrl: {},
  assessmentDraftQuestions: [],
  assessmentDraftTask: null,
  assessmentEditingExamId: null,
  assessmentQuestionDefaultMarks: null,
  assessmentQuestionDefaultNegativeMarks: null,
  assessmentCatalog: [],
  assessmentCatalogQuery: "",
  assessmentCatalogDuration: "all",
  assessmentCatalogSort: "latest",
  selectedCatalogExamId: null,
  selectedAssessmentSource: "catalog",
  issuedCandidateToken: "",
  issuedAccessKey: "",
  issuedCandidateAssessment: null,
  issuedAssessmentStartedAt: 0,
  issuedAssessmentTimerId: null,
  issuedAssessmentSubmitted: false,
  assessmentPreview: {
    mode: "preview",
    attemptId: null,
    exam: null,
    questions: [],
    index: 0,
    answers: {},
    latestResult: null,
    trainingFeedbackChoice: "",
    timerId: null,
    remainingSec: 0,
    timerPaused: false,
    questionRemainingByIndex: {},
    questionTimedOutByIndex: {},
    questionTimeTransitionInFlight: false,
    warningPauseCount: 0,
    proctor: defaultProctorState(),
  },
  liveRoom: {
    active: false,
    sessionId: null,
    role: null,
    lastMessageId: 0,
    pollerId: null,
    classTimerId: null,
    classTimerStartedAt: 0,
    ws: null,
    wsConnected: false,
    wsPingId: null,
    wsReconnectId: null,
    participantMap: {},
    moderation: null,
    selectedParticipantId: 0,
    accessStatus: "admitted",
    hostMuted: false,
    stagePeerId: "",
    focusPeerId: "",
    speakerMonitorId: null,
    speakerScores: {},
    peerAudioContexts: {},
    toolsOpen: false,
    chatOpen: false,
    reactionOpen: false,
    participantsOpen: false,
    sidePanel: "",
    sharedPanel: "",
    qaItems: [],
    boardServerText: "",
    boardDraftDirty: false,
    controlDockIdleTimer: null,
    controlDockPointerInside: false,
    topbarPointerInside: false,
    controlDockVisible: true,
    reactionBurstRecent: {},
    screenShareInFlight: false,
    recording: {
      mediaRecorder: null,
      chunks: [],
      mimeType: "video/webm",
      active: false,
      uploadInFlight: false,
    },
    rtc: {
      peers: {},
      remoteStreams: {},
      signalSeenIds: {},
      signalSeenKeys: {},
      localStream: null,
      cameraStream: null,
      screenStream: null,
      outboundVideoTrack: null,
      micMuted: false,
    },
  },
};

const COURSE_PRICING = {
  currency: "INR",
  gstRate: 0.18,
  platformCommissionRate: 0.25,
  hostingFee: 2500,
};

const COURSE_AGE_RANGE_KEYS = ["under_13", "13_17", "18_24", "25_34", "35_44", "45_plus"];

window.__certoraDebug = {
  getState() {
    return state;
  },
  getCurrentUser() {
    return state.auth?.currentUser ?? null;
  },
  async getIdToken(forceRefresh = false) {
    const user = state.auth?.currentUser;
    if (!user) throw new Error("No signed-in user found");
    return user.getIdToken(forceRefresh);
  },
};

function formatAuthError(err, fallback) {
  const code = String(err?.code || "").trim();
  const message = String(err?.message || "").trim();
  if (!code && message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed?.status === 500) {
        return "Account was created in Firebase but profile setup failed on server. Retry once or login and complete role setup.";
      }
      if (parsed?.status === 409) {
        return String(parsed?.data?.detail || "Account setup conflict. Please login and retry.");
      }
      if (parsed?.status === 403 || parsed?.status === 503) {
        return String(parsed?.data?.detail || `${fallback}.`);
      }
    } catch {}
  }
  if (code === "auth/invalid-credential") {
    return "Invalid email/password. Use Forgot Password to reset this account.";
  }
  if (code === "auth/wrong-password") {
    return "Current password is incorrect.";
  }
  if (code === "auth/weak-password") {
    return "New password is too weak. Use at least 8 characters.";
  }
  if (code === "auth/requires-recent-login") {
    return "Session is old. Login again and retry password change.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a bit and try again.";
  }
  if (code === "auth/email-already-in-use") {
    return "Email already exists. Use Login, or continue Signup with the same existing password.";
  }
  if (code === "auth/invalid-api-key") {
    return "Authentication config error (invalid Firebase API key).";
  }
  if (code) return `${fallback}: ${code}`;
  if (message) return `${fallback}: ${message}`;
  return fallback;
}

function isPlayableVideoElement(video) {
  return Boolean(
    video
    && Number(video.videoWidth) > 0
    && Number(video.videoHeight) > 0
    && video.readyState >= 2,
  );
}

function isRoleRegistrationRequiredError(err) {
  return String(err?.message || "").includes("Account role not registered");
}

function openAccountSetupForCurrentUser() {
  showView("auth");
  showAuthMode("signup");
  if (el.signupName && state.auth?.currentUser?.displayName) el.signupName.value = state.auth.currentUser.displayName;
  if (el.signupEmail && state.auth?.currentUser?.email) el.signupEmail.value = state.auth.currentUser.email;
}

const $ = (id) => document.getElementById(id);
let faceLandmarkerCachePromise = null;
let phoneDetectorCachePromise = null;
let handLandmarkerCachePromise = null;

function speakAssessmentRules() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    toast("Text-to-speech is not supported in this browser.", "error");
    return;
  }
  const synth = window.speechSynthesis;
  const lines = Array.from(document.querySelectorAll("#apPrecheckRulesPage .ap-rules-list li"))
    .map((node) => String(node.textContent || "").trim())
    .filter(Boolean);
  const text = lines.filter(Boolean).join(". ");
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onstart = () => {
    if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "Reading instructions...";
  };
  utterance.onend = () => {
    if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "";
  };
  utterance.onerror = () => {
    if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "";
  };
  synth.cancel();
  synth.speak(utterance);
}

function renderPrecheckScriptProgress(script, progress01) {
  if (!el.apPrecheckVoiceScript) return;
  const txt = String(script || "").trim();
  if (!txt) {
    el.apPrecheckVoiceScript.classList.add("hidden");
    el.apPrecheckVoiceScript.textContent = "";
    return;
  }
  const words = txt.split(/\s+/).filter(Boolean);
  const p = Math.max(0, Math.min(1, Number(progress01 || 0)));
  const fillCount = Math.floor(words.length * p);
  el.apPrecheckVoiceScript.classList.remove("hidden");
  el.apPrecheckVoiceScript.innerHTML = words
    .map((w, i) => `<span style="${i < fillCount ? "color:#0f766e;font-weight:700;" : "color:#6b7280;"}">${escapeHtmlAttr(w)}</span>`)
    .join(" ");
}

const PROCTOR_PRECHECK_TASK_LABELS = {
  cameraReady: "Camera quality check",
  audioReady: "Microphone clarity check",
  speakPromptDone: "Speak verification line",
  holdStillDone: "Hold-still check",
};

function createDefaultPrecheckChecklist() {
  return {
    cameraReady: false,
    audioReady: false,
    speakPromptDone: false,
    holdStillDone: false,
  };
}

function defaultProctorState() {
  return {
    sessionId: null,
    warnings: 0,
    maxWarnings: 999,
    maxPhoneWarnings: 3,
    phoneWarnings: 0,
    penaltyPerWarningPct: 5,
    stream: null,
    audioContext: null,
    analyser: null,
    monitorId: null,
    lastFrame: null,
    lastFaceMetrics: null,
    movementFrames: 0,
    faceModel: null,
    faceModelError: "",
    faceAbsentFrames: 0,
    faceAwayFrames: 0,
    faceMismatchFrames: 0,
    gazeAwayFrames: 0,
    faceTooFarFrames: 0,
    multiFaceFrames: 0,
    speechFrames: 0,
    loudVoiceFrames: 0,
    candidateSpeechFrames: 0,
    backgroundVoiceFrames: 0,
    sideHandFrames: 0,
    handNearFaceFrames: 0,
    lookAwaySinceMs: 0,
    faceReference: null,
    behaviorSignature: null,
    behaviorDriftFrames: 0,
    challengeActive: false,
    challengeTarget: "",
    challengeStartMs: 0,
    challengeDeadlineMs: 0,
    challengeCooldownUntil: 0,
    challengeNextAtMs: 0,
    challengePasses: 0,
    challengeFailures: 0,
    environmentAttested: false,
    precheckBypassed: false,
    precheckReady: false,
    precheckInProgress: false,
    precheckUnlockAtMs: 0,
    precheckChecks: createDefaultPrecheckChecklist(),
    readAloudReady: true,
    calibrated: false,
    audioBaselineRms: 0.03,
    baselineEvidenceReady: false,
    monitorTick: 0,
    phoneFrames: 0,
    phoneModelReady: false,
    handModel: null,
    handModelReady: false,
    startingUp: false,
    warnCooldownMs: 10000,
    lastWarnAt: {},
    visibilityHandler: null,
    blurHandler: null,
    focusHandler: null,
    fullscreenHandler: null,
    gazeGraceUntilMs: 0,
    gazeLastTickMs: 0,
    gazeAllowedUiZones: { primary: true, secondary: true, tertiary: true },
    gazeAllowedRect: { left: 0, right: 1, top: 0, bottom: 1 },
    gazeSmoothedTarget: null,
    gazeSuspicionPoints: [],
    gazeEscalationStageMax: 0,
    gazeFlagReviewEmitted: false,
    gazeLastEmitAt: {},
    gazeSuspiciousDwellMs: 0,
    gazeLastZone: "",
    gazeVarianceSamples: [],
    gazeStaticSuspiciousMs: 0,
    gazeClusterDwellTotals: {},
    gazeSuspiciousEnterCount: {},
    gazeQuestionAwayEpisodes: 0,
    gazeQuestionAwayMarked: false,
    gazeQuestionsWithAwayPattern: 0,
    gazeQuestionPatternWarningsIssued: 0,
    gazeLaptopAwayMarked: false,
    gazeContinuousWarningCount: 0,
    gazeNextContinuousWarningMs: 0,
    gazeDominantClusterHistory: [],
    gazeCrossPatternLastEmit: 0,
    gazeLayer1LogMs: 0,
    screenGazeModel: null,
    screenGazeModelStatus: "idle",
    screenGazeLastResult: null,
  };
}

function detectAudioRms() {
  const p = state.assessmentPreview.proctor;
  if (!p.analyser) return 0;
  const arr = new Uint8Array(p.analyser.fftSize);
  p.analyser.getByteTimeDomainData(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const d = (arr[i] - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / arr.length);
}

function computeFaceMetrics(lm) {
  const leftEye = lm?.[33];
  const rightEye = lm?.[263];
  const nose = lm?.[1];
  const upperLip = lm?.[13];
  const lowerLip = lm?.[14];
  const mouthLeft = lm?.[78];
  const mouthRight = lm?.[308];
  const leftEyeInner = lm?.[133];
  const rightEyeInner = lm?.[362];
  const leftEyeUpper = lm?.[159];
  const leftEyeLower = lm?.[145];
  const rightEyeUpper = lm?.[386];
  const rightEyeLower = lm?.[374];
  const leftIris = [lm?.[468], lm?.[469], lm?.[470], lm?.[471], lm?.[472]].filter(Boolean);
  const rightIris = [lm?.[473], lm?.[474], lm?.[475], lm?.[476], lm?.[477]].filter(Boolean);
  if (!leftEye || !rightEye || !nose) return null;
  const eyeDx = rightEye.x - leftEye.x;
  const eyeDy = rightEye.y - leftEye.y;
  const eyeDist = Math.hypot(eyeDx, eyeDy);
  if (!Number.isFinite(eyeDist) || eyeDist < 0.00001) return null;
  const noseLeft = Math.hypot(nose.x - leftEye.x, nose.y - leftEye.y) / eyeDist;
  const noseRight = Math.hypot(nose.x - rightEye.x, nose.y - rightEye.y) / eyeDist;
  const ratio = (nose.x - leftEye.x) / (rightEye.x - leftEye.x || 0.000001);
  const faceCenterX = (leftEye.x + rightEye.x + nose.x) / 3;
  const faceCenterY = (leftEye.y + rightEye.y + nose.y) / 3;
  const leftEyeOpenRatio = leftEyeUpper && leftEyeLower ? Math.abs(leftEyeLower.y - leftEyeUpper.y) / eyeDist : null;
  const rightEyeOpenRatio = rightEyeUpper && rightEyeLower ? Math.abs(rightEyeLower.y - rightEyeUpper.y) / eyeDist : null;
  let leftGazeX = null;
  let rightGazeX = null;
  let leftGazeY = null;
  let rightGazeY = null;
  let mouthOpenRatio = null;
  if (leftEyeInner && leftIris.length) {
    const irisX = leftIris.reduce((acc, p) => acc + p.x, 0) / leftIris.length;
    leftGazeX = (irisX - leftEye.x) / ((leftEyeInner.x - leftEye.x) || 0.000001);
    if (leftEyeUpper && leftEyeLower) {
      const irisY = leftIris.reduce((acc, p) => acc + p.y, 0) / leftIris.length;
      leftGazeY = (irisY - leftEyeUpper.y) / ((leftEyeLower.y - leftEyeUpper.y) || 0.000001);
    }
  }
  if (rightEyeInner && rightIris.length) {
    const irisX = rightIris.reduce((acc, p) => acc + p.x, 0) / rightIris.length;
    rightGazeX = (irisX - rightEyeInner.x) / ((rightEye.x - rightEyeInner.x) || 0.000001);
    if (rightEyeUpper && rightEyeLower) {
      const irisY = rightIris.reduce((acc, p) => acc + p.y, 0) / rightIris.length;
      rightGazeY = (irisY - rightEyeUpper.y) / ((rightEyeLower.y - rightEyeUpper.y) || 0.000001);
    }
  }
  if (upperLip && lowerLip && mouthLeft && mouthRight) {
    const mouthHeight = Math.hypot(lowerLip.x - upperLip.x, lowerLip.y - upperLip.y);
    const mouthWidth = Math.hypot(mouthRight.x - mouthLeft.x, mouthRight.y - mouthLeft.y);
    mouthOpenRatio = mouthHeight / (mouthWidth || 0.000001);
  }
  return {
    eyeDist,
    noseLeft,
    noseRight,
    ratio,
    faceCenterX,
    faceCenterY,
    leftEyeOpenRatio,
    rightEyeOpenRatio,
    leftGazeX,
    rightGazeX,
    leftGazeY,
    rightGazeY,
    mouthOpenRatio,
  };
}

/** Three-layer gaze policy: raw zones â†’ scored suspicion events â†’ rolling-window thresholds (no instant â€œlooked awayâ€ warnings). */
const GAZE_ROLLING_MS = 120000;
const GAZE_UI_GRACE_MS = 700;
const GAZE_QUESTION_OPTIONS_AWAY_MARK_MS = 700;
const GAZE_QUESTION_OPTIONS_AWAY_REPEAT_COUNT = 2;
const GAZE_LAPTOP_AWAY_LIMIT_MS = 1200;
const GAZE_CONTINUOUS_WARNING_INITIAL_MS = 2600;
const GAZE_CONTINUOUS_WARNING_REPEAT_MS = 2600;
const GAZE_STATIC_LOW_VAR = 0.03;
const GAZE_STATIC_PTS_MS = 900;
const GAZE_EVENT_DEBOUNCE_MS = 10000;
const SCREEN_GAZE_MODEL_URL = "/assets/generated/screen_gaze_model.json?v=20260708b";

let screenGazeModelPromise = null;

function humanizeScreenGazeLabel(label) {
  const value = String(label || "").trim();
  if (!value) return "Checking";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function loadScreenGazeModel() {
  if (screenGazeModelPromise) return screenGazeModelPromise;
  screenGazeModelPromise = fetch(SCREEN_GAZE_MODEL_URL, { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      return payload && payload.model && payload.scaler ? payload : null;
    })
    .catch(() => null);
  return screenGazeModelPromise;
}

function ensureScreenGazeModelWarm(p) {
  if (!p || p.screenGazeModel || p.screenGazeModelStatus === "loading") return;
  p.screenGazeModelStatus = "loading";
  refreshScreenGazeDebugBox(p);
  loadScreenGazeModel().then((model) => {
    const current = state.assessmentPreview?.proctor;
    if (!current) return;
    current.screenGazeModel = model;
    current.screenGazeModelStatus = model ? "ready" : "unavailable";
    refreshScreenGazeDebugBox(current);
  });
}

function buildScreenGazeFeatureVector(metrics, ref) {
  if (!metrics || !ref) return null;
  const leftEyeOpenNow = Number(metrics.leftEyeOpenRatio ?? 0);
  const rightEyeOpenNow = Number(metrics.rightEyeOpenRatio ?? 0);
  const leftEyeOpenBase = Number(ref.leftEyeOpenRatio ?? leftEyeOpenNow);
  const rightEyeOpenBase = Number(ref.rightEyeOpenRatio ?? rightEyeOpenNow);
  const leftGazeXNow = Number(metrics.leftGazeX ?? 0);
  const rightGazeXNow = Number(metrics.rightGazeX ?? 0);
  const leftGazeYNow = Number(metrics.leftGazeY ?? 0);
  const rightGazeYNow = Number(metrics.rightGazeY ?? 0);
  const leftGazeXBase = Number(ref.leftGazeX ?? leftGazeXNow);
  const rightGazeXBase = Number(ref.rightGazeX ?? rightGazeXNow);
  const leftGazeYBase = Number(ref.leftGazeY ?? leftGazeYNow);
  const rightGazeYBase = Number(ref.rightGazeY ?? rightGazeYNow);
  const ratioDelta = Number(metrics.ratio ?? 0.5) - Number(ref.ratio ?? 0.5);
  const leftEyeOpenDelta = leftEyeOpenNow - leftEyeOpenBase;
  const rightEyeOpenDelta = rightEyeOpenNow - rightEyeOpenBase;
  const leftGazeXDelta = leftGazeXNow - leftGazeXBase;
  const rightGazeXDelta = rightGazeXNow - rightGazeXBase;
  const leftGazeYDelta = leftGazeYNow - leftGazeYBase;
  const rightGazeYDelta = rightGazeYNow - rightGazeYBase;
  const avgGazeXDelta = (leftGazeXDelta + rightGazeXDelta) / 2;
  const avgGazeYDelta = (leftGazeYDelta + rightGazeYDelta) / 2;
  return [
    Number(metrics.noseLeft ?? 0) - Number(ref.noseLeft ?? 0),
    Number(metrics.noseRight ?? 0) - Number(ref.noseRight ?? 0),
    ratioDelta,
    leftEyeOpenDelta,
    rightEyeOpenDelta,
    leftGazeXDelta,
    rightGazeXDelta,
    leftGazeYDelta,
    rightGazeYDelta,
    Number(metrics.mouthOpenRatio ?? 0) - Number(ref.mouthOpenRatio ?? 0),
    avgGazeXDelta,
    avgGazeYDelta,
    leftGazeXDelta - rightGazeXDelta,
    leftGazeYDelta - rightGazeYDelta,
    (leftEyeOpenDelta + rightEyeOpenDelta) / 2,
    leftEyeOpenDelta - rightEyeOpenDelta,
    Math.abs(avgGazeXDelta) + (Math.abs(ratioDelta) * 0.7),
    Math.abs(avgGazeYDelta),
    Math.hypot(avgGazeXDelta, avgGazeYDelta),
  ];
}

function softmaxLogits(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0) || 1;
  return exps.map((value) => value / sum);
}

function predictScreenGazeResult(p, metrics) {
  const model = p?.screenGazeModel;
  if (!model || !p?.faceReference || !metrics) return null;
  const featureVec = buildScreenGazeFeatureVector(metrics, p.faceReference);
  const means = Array.isArray(model?.scaler?.mean) ? model.scaler.mean : [];
  const scales = Array.isArray(model?.scaler?.scale) ? model.scaler.scale : [];
  const coefs = Array.isArray(model?.model?.coef) ? model.model.coef : [];
  const intercept = Array.isArray(model?.model?.intercept) ? model.model.intercept : [];
  const classes = Array.isArray(model?.class_names) ? model.class_names : [];
  if (!featureVec || !classes.length || !coefs.length || means.length !== featureVec.length || scales.length !== featureVec.length) return null;
  const scaled = featureVec.map((value, idx) => {
    const std = Math.abs(Number(scales[idx] || 1)) > 1e-7 ? Number(scales[idx] || 1) : 1;
    return (Number(value || 0) - Number(means[idx] || 0)) / std;
  });
  const logits = coefs.map((row, rowIdx) => row.reduce((acc, weight, idx) => acc + (Number(weight || 0) * scaled[idx]), Number(intercept[rowIdx] || 0)));
  const probs = softmaxLogits(logits);
  let topIndex = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[topIndex]) topIndex = i;
  }
  const topClass = String(classes[topIndex] || "");
  const topProb = Number(probs[topIndex] || 0);
  const awayIndex = classes.indexOf("away");
  const awayProb = awayIndex >= 0 ? Number(probs[awayIndex] || 0) : 0;
  const thresholds = model?.thresholds || {};
  let status = "screen";
  if (topClass === "away" || awayProb >= Number(thresholds.suspect_away_probability ?? 0.48)) {
    status = "suspect";
  } else if (
    awayProb > Number(thresholds.borderline_max_away_probability ?? 0.36)
    || topProb < Number(thresholds.min_top_class_probability ?? 0.34)
  ) {
    status = "borderline";
  }
  const displayNames = model?.display_names || {};
  return {
    status,
    topClass,
    topProb,
    awayProb,
    zoneLabel: String(displayNames[topClass] || humanizeScreenGazeLabel(topClass)),
  };
}

function refreshScreenGazeDebugBox(p) {
  const box = el.apGazeDebugBox;
  if (!box) return;
  const stateNode = el.apGazeDebugState;
  const zoneNode = el.apGazeDebugZone;
  const confNode = el.apGazeDebugConfidence;
  const hintNode = el.apGazeDebugHint;
  box.classList.remove("gaze-ok", "gaze-borderline", "gaze-suspect");
  if (!p) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const result = p.screenGazeLastResult;
  if (p.screenGazeModelStatus === "loading") {
    if (stateNode) stateNode.textContent = "Loading model";
    if (zoneNode) zoneNode.textContent = "Preparing live screen-check";
    if (confNode) confNode.textContent = "";
    if (hintNode) hintNode.textContent = "Hold still for a moment.";
    return;
  }
  if (!p.faceReference) {
    if (stateNode) stateNode.textContent = "Calibrating";
    if (zoneNode) zoneNode.textContent = "Complete camera checks first";
    if (confNode) confNode.textContent = "";
    if (hintNode) hintNode.textContent = "We need your neutral face baseline before live gaze check starts.";
    return;
  }
  if (!result) {
    if (stateNode) stateNode.textContent = "Checking";
    if (zoneNode) zoneNode.textContent = "Waiting for eye landmarks";
    if (confNode) confNode.textContent = "";
    if (hintNode) hintNode.textContent = p.screenGazeModelStatus === "unavailable" ? "Model file not loaded. Fallback logic is still active." : "Look naturally at the screen.";
    return;
  }
  if (result.status === "suspect") box.classList.add("gaze-suspect");
  else if (result.status === "borderline") box.classList.add("gaze-borderline");
  else box.classList.add("gaze-ok");
  if (stateNode) {
    stateNode.textContent = result.status === "suspect"
      ? "Suspect"
      : result.status === "borderline"
        ? "Borderline pass"
        : "On screen";
  }
  if (zoneNode) zoneNode.textContent = result.zoneLabel || "On screen";
  if (confNode) confNode.textContent = `Screen ${(Math.max(0, 1 - Number(result.awayProb || 0)) * 100).toFixed(0)}%`;
  if (hintNode) {
    hintNode.textContent = result.status === "suspect"
      ? "Eyes look meaningfully away from the laptop screen."
      : result.status === "borderline"
        ? "Small variation detected, still treated as acceptable."
        : "Eyes appear to be on the laptop screen.";
  }
}

function computeQuestionPanelAllowedGazeZones() {
  const screenRect = el.assessmentPreviewScreen?.getBoundingClientRect?.();
  const contentRect = el.apQuestionContent?.getBoundingClientRect?.();
  const questionRect = el.apQuestionText?.getBoundingClientRect?.();
  const optionsRect = el.apOptionsList?.getBoundingClientRect?.();
  let panelRect = null;
  if (questionRect && optionsRect) {
    panelRect = {
      left: Math.min(questionRect.left, optionsRect.left),
      right: Math.max(questionRect.right, optionsRect.right),
      top: Math.min(questionRect.top, optionsRect.top),
      bottom: Math.max(questionRect.bottom, optionsRect.bottom),
      width: Math.max(questionRect.right, optionsRect.right) - Math.min(questionRect.left, optionsRect.left),
    };
  } else {
    panelRect = contentRect || el.apQuestionPanel?.getBoundingClientRect?.();
  }
  if (!screenRect || !panelRect || screenRect.width < 60 || panelRect.width < 40) {
    return {
      zones: { primary: true, secondary: true, tertiary: true },
      rect: { left: 0, right: 1, top: 0, bottom: 1 },
    };
  }
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const left = clamp(panelRect.left - screenRect.left, 0, screenRect.width);
  const right = clamp(panelRect.right - screenRect.left, 0, screenRect.width);
  const top = clamp(panelRect.top - screenRect.top, 0, screenRect.height || 1);
  const bottom = clamp(panelRect.bottom - screenRect.top, 0, screenRect.height || 1);
  const padX = Math.min(9, screenRect.width * 0.009);
  const padY = Math.min(8, (screenRect.height || 1) * 0.012);
  const zoneLeft = Math.max(0, left - padX);
  const zoneRight = Math.min(screenRect.width, right + padX);
  const zoneTop = Math.max(0, top - padY);
  const zoneBottom = Math.min(screenRect.height || 1, bottom + padY);
  const third = screenRect.width / 3;
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const minimumOverlap = Math.max(26, third * 0.26);
  const secondary = overlap(zoneLeft, zoneRight, 0, third) >= minimumOverlap;
  const primary = overlap(zoneLeft, zoneRight, third, third * 2) >= minimumOverlap;
  const tertiary = overlap(zoneLeft, zoneRight, third * 2, screenRect.width) >= minimumOverlap;
  return {
    zones: {
      primary: primary || (!secondary && !tertiary),
      secondary,
      tertiary,
    },
    rect: {
      left: zoneLeft / screenRect.width,
      right: zoneRight / screenRect.width,
      top: zoneTop / Math.max(1, screenRect.height || 1),
      bottom: zoneBottom / Math.max(1, screenRect.height || 1),
    },
  };
}

function refreshQuestionPanelGazeZones() {
  const cfg = computeQuestionPanelAllowedGazeZones();
  state.assessmentPreview.proctor.gazeAllowedUiZones = cfg.zones;
  state.assessmentPreview.proctor.gazeAllowedRect = cfg.rect;
}

function estimateGazeTarget(metrics, ref) {
  if (!metrics || !ref) return null;
  const ratio = Number(metrics.ratio);
  const lg = Number(metrics.leftGazeX);
  const rg = Number(metrics.rightGazeX);
  const lgy = Number(metrics.leftGazeY);
  const rgy = Number(metrics.rightGazeY);
  const lb = Number(ref.leftGazeX);
  const rb = Number(ref.rightGazeX);
  const lby = Number(ref.leftGazeY);
  const rby = Number(ref.rightGazeY);
  const faceYNow = Number(metrics.faceCenterY);
  const faceYBase = Number(ref.faceCenterY);
  const leftOpen = Number(metrics.leftEyeOpenRatio);
  const rightOpen = Number(metrics.rightEyeOpenRatio);
  const leftOpenBase = Number(ref.leftEyeOpenRatio);
  const rightOpenBase = Number(ref.rightEyeOpenRatio);
  if (!Number.isFinite(ratio) || !Number.isFinite(lg) || !Number.isFinite(rg) || !Number.isFinite(lb) || !Number.isFinite(rb)) return null;
  const eyeDeltaX = ((lg - lb) + (rg - rb)) / 2;
  const headDeltaX = ratio - Number(ref.ratio || 0.5);
  let x = 0.5 + eyeDeltaX * 1.6 + headDeltaX * 2.2;
  let y = 0.5;
  if (Number.isFinite(lgy) && Number.isFinite(rgy) && Number.isFinite(lby) && Number.isFinite(rby)) {
    const eyeDeltaY = ((lgy - lby) + (rgy - rby)) / 2;
    const headDeltaY = Number.isFinite(faceYNow) && Number.isFinite(faceYBase) ? faceYNow - faceYBase : 0;
    y = 0.5 + eyeDeltaY * 1.25 + headDeltaY * 1.9;
  }
  let confidence = 1;
  if (Number.isFinite(leftOpen) && Number.isFinite(rightOpen)) {
    const openMin = Math.min(leftOpen, rightOpen);
    const openBase = Math.max(0.0001, Math.min(
      Number.isFinite(leftOpenBase) ? leftOpenBase : openMin,
      Number.isFinite(rightOpenBase) ? rightOpenBase : openMin,
    ));
    if (openMin < openBase * 0.58) confidence -= 0.32;
    if (Math.abs(leftOpen - rightOpen) > 0.012) confidence -= 0.16;
  }
  if (Math.abs(headDeltaX) > 0.16) confidence -= 0.18;
  if (Math.abs(eyeDeltaX) > 0.22) confidence -= 0.08;
  if (!(Number.isFinite(lgy) && Number.isFinite(rgy) && Number.isFinite(lby) && Number.isFinite(rby))) confidence -= 0.08;
  return {
    x: clamp01(x),
    y: clamp01(y),
    eyeDeltaX,
    headDeltaX,
    confidence: clamp01(confidence),
  };
}

function getSmoothedGazeTarget(p, target) {
  if (!target) return null;
  const current = p.gazeSmoothedTarget;
  const alpha = target.confidence >= 0.8 ? 0.42 : target.confidence >= 0.6 ? 0.28 : 0.16;
  if (!current) {
    p.gazeSmoothedTarget = { ...target };
    return p.gazeSmoothedTarget;
  }
  p.gazeSmoothedTarget = {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
    eyeDeltaX: target.eyeDeltaX,
    headDeltaX: target.headDeltaX,
    confidence: current.confidence + (target.confidence - current.confidence) * 0.35,
  };
  return p.gazeSmoothedTarget;
}

function classifyGazeUiZone(p, metrics, ref, allowedZones = null, allowedRect = null) {
  const rawTarget = estimateGazeTarget(metrics, ref);
  const target = getSmoothedGazeTarget(p, rawTarget);
  if (!target) return "neutral";
  if (allowedRect) {
    const marginX = target.confidence >= 0.82 ? 0.004 : target.confidence >= 0.65 ? 0.008 : 0.014;
    const marginY = target.confidence >= 0.82 ? 0.007 : target.confidence >= 0.65 ? 0.013 : 0.02;
    const insideRect = (
      target.x >= Number(allowedRect.left ?? 0) &&
      target.x <= Number(allowedRect.right ?? 1) &&
      target.y >= Number(allowedRect.top ?? 0) &&
      target.y <= Number(allowedRect.bottom ?? 1)
    );
    const nearRect = (
      target.x >= Number(allowedRect.left ?? 0) - marginX &&
      target.x <= Number(allowedRect.right ?? 1) + marginX &&
      target.y >= Number(allowedRect.top ?? 0) - marginY &&
      target.y <= Number(allowedRect.bottom ?? 1) + marginY
    );
    if (!insideRect && nearRect && target.confidence < 0.4) return "neutral";
    if (!insideRect) return "suspicious";
    if (target.confidence < 0.38) return "neutral";
  }
  let zone = "primary";
  if (target.x < 1 / 3) zone = "secondary";
  else if (target.x > 2 / 3) zone = "tertiary";
  if (!allowedZones || !["primary", "secondary", "tertiary"].includes(zone)) return zone;
  return allowedZones[zone] ? zone : "suspicious";
}

function gazeSuspicionClusterKey(metrics) {
  if (!metrics) return "";
  const x = Math.round(Number(metrics.faceCenterX || 0) * 8) / 8;
  const y = Math.round(Number(metrics.faceCenterY || 0) * 8) / 8;
  return `${x}_${y}`;
}

function sumGazeSuspicionWindow(p) {
  const now = Date.now();
  const arr = p.gazeSuspicionPoints || [];
  return arr.filter((e) => now - e.t <= GAZE_ROLLING_MS).reduce((a, e) => a + e.pts, 0);
}

function canEmitGazeEvent(p, code) {
  const last = p.gazeLastEmitAt[code] || 0;
  return Date.now() - last >= GAZE_EVENT_DEBOUNCE_MS;
}

function markGazeEventEmitted(p, code) {
  p.gazeLastEmitAt[code] = Date.now();
}

function addGazeSuspicionPoints(p, pts, code, details = {}) {
  if (!pts) return;
  const now = Date.now();
  p.gazeSuspicionPoints.push({ t: now, pts, code, details });
  const cutoff = now - GAZE_ROLLING_MS - 5000;
  p.gazeSuspicionPoints = p.gazeSuspicionPoints.filter((e) => e.t >= cutoff);
  logProctorEvent("info", "gaze_suspicion_layer2", {
    layer2_code: code,
    points_added: pts,
    rolling_score: sumGazeSuspicionWindow(p),
    ...details,
  }).catch(() => {});
  reapGazeSuspicionEscalation(p);
}

function reapGazeSuspicionEscalation(p) {
  const s = sumGazeSuspicionWindow(p);
  const stage = p.gazeEscalationStageMax || 0;
  if (s >= 6 && !p.gazeFlagReviewEmitted) {
    p.gazeFlagReviewEmitted = true;
    p.gazeEscalationStageMax = Math.max(stage, 6);
    logProctorEvent("warning", "gaze_pattern_review_flag", { rolling_score: s }).catch(() => {});
    pushProctorWarning(
      "Repeated off-screen gaze pattern noted. This session may be reviewed.",
      "gaze_pattern_review",
      "warning",
    );
  } else if (s >= 4 && stage < 4) {
    p.gazeEscalationStageMax = 4;
    toast("Please keep your attention on the test screen.");
    logProctorEvent("info", "gaze_soft_attention_notice", { rolling_score: s }).catch(() => {});
  } else if (s >= 2 && stage < 2) {
    p.gazeEscalationStageMax = 2;
    logProctorEvent("info", "gaze_suspicion_internal", { rolling_score: s }).catch(() => {});
  } else if (s >= 1 && stage < 1) {
    p.gazeEscalationStageMax = 1;
    logProctorEvent("info", "gaze_suspicion_silent_log", { rolling_score: s }).catch(() => {});
  }
}

function resetPerQuestionGazeAccumulators(p) {
  p.gazeSuspiciousDwellMs = 0;
  p.gazeSuspiciousEnterCount = {};
  p.gazeClusterDwellTotals = {};
  p.gazeSmoothedTarget = null;
  p.gazeQuestionAwayEpisodes = 0;
  p.gazeQuestionAwayMarked = false;
  p.gazeLaptopAwayMarked = false;
  p.gazeContinuousWarningCount = 0;
  p.gazeNextContinuousWarningMs = 0;
  p.gazeVarianceSamples = [];
  p.gazeStaticSuspiciousMs = 0;
  p.gazeLastZone = "";
}

function resetGazeSuspicionSessionState(p) {
  p.gazeGraceUntilMs = 0;
  p.gazeLastTickMs = 0;
  p.gazeSuspicionPoints = [];
  p.gazeEscalationStageMax = 0;
  p.gazeFlagReviewEmitted = false;
  p.gazeLastEmitAt = {};
  resetPerQuestionGazeAccumulators(p);
  p.gazeQuestionsWithAwayPattern = 0;
  p.gazeQuestionPatternWarningsIssued = 0;
  p.gazeDominantClusterHistory = [];
  p.gazeCrossPatternLastEmit = 0;
  p.gazeLayer1LogMs = 0;
}

function beginGazeQuestionGrace(p) {
  refreshQuestionPanelGazeZones();
  p.gazeGraceUntilMs = Date.now() + GAZE_UI_GRACE_MS;
}

function finalizeGazeQuestionForNavigation(preview, leavingForward) {
  const p = preview.proctor;
  if (!leavingForward) {
    resetPerQuestionGazeAccumulators(p);
    beginGazeQuestionGrace(p);
    return;
  }
  const q = preview.questions[preview.index];
  if (q) {
    const correctIds = (q.options || []).filter((o) => o.is_correct).map((o) => o.option_id).sort((a, b) => a - b);
    const selected = (preview.answers[q.question_id] || []).slice().sort((a, b) => a - b);
    const ok = selected.length === correctIds.length && selected.every((v, i) => v === correctIds[i]);
    const now = Date.now();
    const recent = (p.gazeSuspicionPoints || []).filter((e) => now - e.t <= 5000);
    const recentPts = recent.reduce((a, e) => a + e.pts, 0);
    if (ok && recentPts > 0 && canEmitGazeEvent(p, "fast_correct_after_suspicion")) {
      markGazeEventEmitted(p, "fast_correct_after_suspicion");
      const hard = Number(q.marks || 1) >= 2;
      addGazeSuspicionPoints(p, hard ? 2 : 1, "fast_correct_after_suspicion", { question_id: q.question_id });
    }
  }
  if ((p.gazeQuestionAwayEpisodes || 0) > 0) {
    p.gazeQuestionsWithAwayPattern = (p.gazeQuestionsWithAwayPattern || 0) + 1;
    const expectedWarnings = Math.floor((p.gazeQuestionsWithAwayPattern || 0) / 2);
    if (expectedWarnings > (p.gazeQuestionPatternWarningsIssued || 0)) {
      p.gazeQuestionPatternWarningsIssued = expectedWarnings;
      pushProctorWarning(
        "Repeated gaze away from the question text was detected across multiple questions.",
        "repeated_question_text_gaze_pattern",
        "warning",
      );
      logProctorEvent("warning", "repeated_question_text_gaze_pattern_detail", {
        questions_with_away_pattern: p.gazeQuestionsWithAwayPattern,
        warnings_issued: p.gazeQuestionPatternWarningsIssued,
      }).catch(() => {});
    }
  }
  const totals = p.gazeClusterDwellTotals || {};
  let dominant = "";
  let maxD = 0;
  for (const [k, v] of Object.entries(totals)) {
    if (v > maxD) {
      maxD = v;
      dominant = k;
    }
  }
  if (dominant && maxD > 1200) {
    p.gazeDominantClusterHistory = (p.gazeDominantClusterHistory || []).concat([dominant]).slice(-10);
    const h = p.gazeDominantClusterHistory;
    if (h.length >= 3 && h[h.length - 1] === h[h.length - 2] && h[h.length - 2] === h[h.length - 3]) {
      const now = Date.now();
      if (now - (p.gazeCrossPatternLastEmit || 0) > 60000 && canEmitGazeEvent(p, "cross_question_zone_pattern")) {
        p.gazeCrossPatternLastEmit = now;
        markGazeEventEmitted(p, "cross_question_zone_pattern");
        addGazeSuspicionPoints(p, 3, "cross_question_zone_pattern", { cluster: dominant });
      }
    }
  }
  resetPerQuestionGazeAccumulators(p);
  beginGazeQuestionGrace(p);
}

function tickGazeThreeLayerModel(p, metrics, now) {
  if (!p.faceReference || !metrics) return;
  if (now < (p.gazeGraceUntilMs || 0)) return;
  const dt = p.gazeLastTickMs ? Math.min(900, Math.max(80, now - p.gazeLastTickMs)) : 500;
  p.gazeLastTickMs = now;

  if (!p.screenGazeModel && p.screenGazeModelStatus !== "unavailable") ensureScreenGazeModelWarm(p);
  const screenGaze = predictScreenGazeResult(p, metrics);
  p.screenGazeLastResult = screenGaze;
  refreshScreenGazeDebugBox(p);

  const zone = classifyGazeUiZone(metrics, p.faceReference, p.gazeAllowedUiZones, p.gazeAllowedRect);
  const suspicious = screenGaze ? screenGaze.status === "suspect" : zone === "suspicious";
  const cluster = suspicious ? gazeSuspicionClusterKey(metrics) : "";

  if (suspicious && cluster) {
    p.gazeClusterDwellTotals[cluster] = (p.gazeClusterDwellTotals[cluster] || 0) + dt;
  }

  const prev = p.gazeLastZone || "";
  p.gazeLastZone = zone;
  if (suspicious && prev !== "suspicious" && cluster) {
    p.gazeSuspiciousEnterCount[cluster] = (p.gazeSuspiciousEnterCount[cluster] || 0) + 1;
    const n = p.gazeSuspiciousEnterCount[cluster];
    if (n >= 3 && canEmitGazeEvent(p, `revisit_${cluster}`)) {
      markGazeEventEmitted(p, `revisit_${cluster}`);
      addGazeSuspicionPoints(p, 2, "suspicious_zone_revisited", { cluster, visits: n });
    }
  }

  if (suspicious) {
    p.gazeSuspiciousDwellMs = (p.gazeSuspiciousDwellMs || 0) + dt;
    if (!p.lookAwaySinceMs) p.lookAwaySinceMs = now;
  } else {
    p.gazeSuspiciousDwellMs = 0;
    p.lookAwaySinceMs = 0;
    p.gazeQuestionAwayMarked = false;
    p.gazeLaptopAwayMarked = false;
    p.gazeContinuousWarningCount = 0;
    p.gazeNextContinuousWarningMs = 0;
  }
  if (p.lookAwaySinceMs && now - p.lookAwaySinceMs >= 1600 && canEmitGazeEvent(p, "look_away_over_2s")) {
    markGazeEventEmitted(p, "look_away_over_2s");
    pushProctorWarning(
      "Eyes moved away from the laptop screen for too long. Keep your attention on the screen.",
      "look_away_over_2s",
      "warning",
    );
    p.lookAwaySinceMs = now;
  }
  if (
    p.gazeSuspiciousDwellMs >= GAZE_QUESTION_OPTIONS_AWAY_MARK_MS &&
    !p.gazeQuestionAwayMarked
  ) {
    p.gazeQuestionAwayMarked = true;
    p.gazeQuestionAwayEpisodes = (p.gazeQuestionAwayEpisodes || 0) + 1;
    addGazeSuspicionPoints(p, 1, "gaze_outside_question_options", {
      dwell_ms: Math.round(p.gazeSuspiciousDwellMs),
      episodes_this_question: p.gazeQuestionAwayEpisodes,
    });
    if (p.gazeQuestionAwayEpisodes >= GAZE_QUESTION_OPTIONS_AWAY_REPEAT_COUNT) {
      logProctorEvent("info", "repeated_question_options_gaze_away", {
        episodes_this_question: p.gazeQuestionAwayEpisodes,
        dwell_ms: Math.round(p.gazeSuspiciousDwellMs),
      }).catch(() => {});
      addGazeSuspicionPoints(p, 1, "repeated_question_options_gaze_away", {
        episodes_this_question: p.gazeQuestionAwayEpisodes,
      });
    }
  }
  if (
    p.gazeSuspiciousDwellMs >= GAZE_LAPTOP_AWAY_LIMIT_MS &&
    !p.gazeLaptopAwayMarked &&
    canEmitGazeEvent(p, "gaze_away_over_3s")
  ) {
    p.gazeLaptopAwayMarked = true;
    markGazeEventEmitted(p, "gaze_away_over_3s");
    addGazeSuspicionPoints(p, 2, "gaze_away_over_3s", {
      dwell_ms: Math.round(p.gazeSuspiciousDwellMs),
    });
  }
  if (
    p.gazeSuspiciousDwellMs >= GAZE_CONTINUOUS_WARNING_INITIAL_MS &&
    (p.gazeNextContinuousWarningMs || 0) <= p.gazeSuspiciousDwellMs
  ) {
    p.gazeContinuousWarningCount = (p.gazeContinuousWarningCount || 0) + 1;
    p.gazeNextContinuousWarningMs = p.gazeSuspiciousDwellMs + GAZE_CONTINUOUS_WARNING_REPEAT_MS;
    logProctorEvent("info", "continuous_question_area_gaze_detail", {
      continuous_warning_count: p.gazeContinuousWarningCount,
      dwell_ms: Math.round(p.gazeSuspiciousDwellMs),
    }).catch(() => {});
    if (p.gazeContinuousWarningCount === 1 || p.gazeContinuousWarningCount % 2 === 0) {
      pushProctorWarning(
        "Extended off-screen gaze detected. Keep your eyes on the laptop screen.",
        "continuous_question_area_gaze",
        "warning",
      );
    }
  }

  const lg = Number(metrics.leftGazeX);
  const rg = Number(metrics.rightGazeX);
  const ref = p.faceReference || {};
  const baseLG = Number(ref.leftGazeX);
  const baseRG = Number(ref.rightGazeX);
  if (Number.isFinite(lg) && Number.isFinite(rg)) {
    const g = (lg + rg) / 2;
    const samples = p.gazeVarianceSamples || [];
    samples.push(g);
    while (samples.length > 18) samples.shift();
    p.gazeVarianceSamples = samples;
    if (samples.length >= 10 && suspicious) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const v = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
      if (v < GAZE_STATIC_LOW_VAR) p.gazeStaticSuspiciousMs = (p.gazeStaticSuspiciousMs || 0) + dt;
      else p.gazeStaticSuspiciousMs = Math.max(0, (p.gazeStaticSuspiciousMs || 0) - dt * 0.5);
    } else {
      p.gazeStaticSuspiciousMs = 0;
    }
    if (p.gazeStaticSuspiciousMs >= GAZE_STATIC_PTS_MS && canEmitGazeEvent(p, "static_gaze_suspicious")) {
      markGazeEventEmitted(p, "static_gaze_suspicious");
      addGazeSuspicionPoints(p, 1, "static_gaze_suspicious_zone", {});
      p.gazeStaticSuspiciousMs = 0;
    }
    const pupilDrift = Math.max(Math.abs(lg - baseLG), Math.abs(rg - baseRG));
    if (
      suspicious
      && Number.isFinite(baseLG)
      && Number.isFinite(baseRG)
      && pupilDrift >= 0.13
      && canEmitGazeEvent(p, "pupil_drift_non_text_zone")
    ) {
      markGazeEventEmitted(p, "pupil_drift_non_text_zone");
      addGazeSuspicionPoints(p, 2, "pupil_drift_non_text_zone", {
        pupil_drift: Number(pupilDrift.toFixed(4)),
      });
      logProctorEvent("warning", "pupil_drift_non_text_zone", {
        pupil_drift: Number(pupilDrift.toFixed(4)),
      }).catch(() => {});
    }
  }

  if (now - (p.gazeLayer1LogMs || 0) > 12000 && suspicious) {
    p.gazeLayer1LogMs = now;
    const target = estimateGazeTarget(metrics, p.faceReference);
    logProctorEvent("info", "gaze_layer1_observation", {
      zone,
      screen_zone: screenGaze?.topClass || "",
      screen_status: screenGaze?.status || "",
      away_probability: screenGaze?.awayProb,
      cluster,
      ratio: metrics.ratio,
      leftGazeX: metrics.leftGazeX,
      rightGazeX: metrics.rightGazeX,
      leftGazeY: metrics.leftGazeY,
      rightGazeY: metrics.rightGazeY,
      estimatedTargetX: target?.x,
      estimatedTargetY: target?.y,
    }).catch(() => {});
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function buildBehaviorSignature(faceRef, audioBaselineRms) {
  if (!faceRef) return null;
  return {
    faceCenterX: Number(faceRef.faceCenterX || 0.5),
    faceCenterY: Number(faceRef.faceCenterY || 0.5),
    eyeDist: Number(faceRef.eyeDist || 0),
    leftGazeX: Number(faceRef.leftGazeX || 0.5),
    rightGazeX: Number(faceRef.rightGazeX || 0.5),
    leftGazeY: Number(faceRef.leftGazeY || 0.5),
    rightGazeY: Number(faceRef.rightGazeY || 0.5),
    mouthOpenRatio: Number(faceRef.mouthOpenRatio || 0.02),
    audioBaselineRms: Number(audioBaselineRms || 0.03),
  };
}

function evaluateBehaviorDrift() {
  const p = state.assessmentPreview.proctor;
  const sig = p.behaviorSignature;
  const metrics = p.lastFaceMetrics;
  if (!sig || !metrics) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const faceShift = Math.hypot(
    Number(metrics.faceCenterX || 0) - Number(sig.faceCenterX || 0),
    Number(metrics.faceCenterY || 0) - Number(sig.faceCenterY || 0),
  );
  if (faceShift > 0.09) {
    score += 0.8;
    reasons.push("face_position_shift");
  }

  const eyeDist = Number(metrics.eyeDist || 0);
  const eyeBase = Number(sig.eyeDist || 0);
  const faceScaleDrift = eyeBase > 0 ? Math.abs(eyeDist - eyeBase) / eyeBase : 0;
  if (faceScaleDrift > 0.24) {
    score += 0.9;
    reasons.push("face_scale_drift");
  }

  const leftBase = Number(sig.leftGazeX || 0.5);
  const rightBase = Number(sig.rightGazeX || 0.5);
  const leftNow = Number(metrics.leftGazeX || leftBase);
  const rightNow = Number(metrics.rightGazeX || rightBase);
  const gazeDrift = Math.max(Math.abs(leftNow - leftBase), Math.abs(rightNow - rightBase));
  if (gazeDrift > 0.13) {
    score += 1.35;
    reasons.push("gaze_drift");
  }

  const rms = detectAudioRms();
  const audioBase = Number(sig.audioBaselineRms || 0.03);
  const audioDrift = audioBase > 0 ? rms / audioBase : 0;
  if (audioDrift > 2.4) {
    score += 0.7;
    reasons.push("audio_drift");
  }

  if (p.sideHandFrames >= 2) {
    score += 0.9;
    reasons.push("side_hand_pattern");
  }
  if (p.handNearFaceFrames >= 2) {
    score += 0.8;
    reasons.push("hand_near_face_pattern");
  }
  const mouthBase = Number(sig.mouthOpenRatio || 0.02);
  const mouthNow = Number(metrics.mouthOpenRatio || mouthBase);
  if (mouthNow > mouthBase + 0.045 && audioDrift > 1.7) {
    score += 0.7;
    reasons.push("mouth_audio_sync");
  }

  return { score, reasons };
}

function detectCandidateSpeech() {
  const p = state.assessmentPreview.proctor;
  const metrics = p.lastFaceMetrics;
  const sig = p.behaviorSignature;
  if (!metrics || !sig) return false;
  const rms = detectAudioRms();
  const audioBase = Number(sig.audioBaselineRms || p.audioBaselineRms || 0.03);
  const mouthBase = Number(sig.mouthOpenRatio || 0.02);
  const mouthNow = Number(metrics.mouthOpenRatio || mouthBase);
  const voiceActive = rms > Math.max(0.035, audioBase * 1.45);
  const mouthActive = mouthNow > mouthBase + 0.025;
  return voiceActive && mouthActive;
}

function detectBackgroundVoice() {
  const p = state.assessmentPreview.proctor;
  const metrics = p.lastFaceMetrics;
  const sig = p.behaviorSignature;
  const rms = detectAudioRms();
  const audioBase = Number(sig?.audioBaselineRms || p.audioBaselineRms || 0.03);
  const mouthBase = Number(sig?.mouthOpenRatio || 0.02);
  const mouthNow = Number(metrics?.mouthOpenRatio || mouthBase);
  const voiceActive = rms > Math.max(0.035, audioBase * 1.35);
  const mouthStill = mouthNow <= mouthBase + 0.02;
  return voiceActive && mouthStill;
}

function clearAttentionChallengeOverlay() {
  el.apAttentionChallenge?.classList.add("hidden");
  el.apAttentionChallenge?.classList.remove("left", "right");
  if (el.apAttentionChallengeText) {
    el.apAttentionChallengeText.textContent = "Quick focus check";
  }
}

function scheduleNextAttentionChallenge(minDelayMs = 18000, maxDelayMs = 32000) {
  const p = state.assessmentPreview.proctor;
  const span = Math.max(1000, maxDelayMs - minDelayMs);
  p.challengeNextAtMs = Date.now() + minDelayMs + Math.floor(Math.random() * span);
}

function getAttentionChallengeWindow() {
  const p = state.assessmentPreview.proctor;
  const gazeRoll = sumGazeSuspicionWindow(p);
  const suspicionScore = [
    gazeRoll >= 4 ? 2 : gazeRoll >= 1 ? 1 : 0,
    p.sideHandFrames >= 1 ? 1 : 0,
    p.handNearFaceFrames >= 1 ? 1 : 0,
    p.behaviorDriftFrames >= 1 ? 2 : 0,
    p.challengeFailures >= 1 ? 2 : 0,
    p.warnings >= 1 ? 1 : 0,
  ].reduce((acc, value) => acc + value, 0);

  if (suspicionScore >= 4) {
    return { minDelayMs: 18000, maxDelayMs: 28000 };
  }
  if (suspicionScore >= 2) {
    return { minDelayMs: 30000, maxDelayMs: 45000 };
  }
  return { minDelayMs: 45000, maxDelayMs: 75000 };
}

function beginAttentionChallenge() {
  const p = state.assessmentPreview.proctor;
  if (!p.faceReference || !p.lastFaceMetrics || !el.apAttentionChallenge || !el.apAttentionChallengeText) return;
  const target = Math.random() < 0.5 ? "left" : "right";
  p.challengeActive = true;
  p.challengeTarget = target;
  p.challengeStartMs = Date.now();
  p.challengeDeadlineMs = p.challengeStartMs + 1600;
  p.challengeCooldownUntil = p.challengeDeadlineMs + 14000;
  el.apAttentionChallenge.classList.remove("hidden", "left", "right");
  el.apAttentionChallenge.classList.add(target);
  el.apAttentionChallengeText.textContent = target === "left"
    ? "Focus check: glance at the amber marker on the left edge"
    : "Focus check: glance at the amber marker on the right edge";
  logProctorEvent("info", "attention_challenge_started", { target }).catch(() => {});
}

function completeAttentionChallenge(passed) {
  const p = state.assessmentPreview.proctor;
  const target = p.challengeTarget || "unknown";
  const reactionMs = p.challengeStartMs ? Date.now() - p.challengeStartMs : null;
  p.challengeActive = false;
  p.challengeTarget = "";
  p.challengeStartMs = 0;
  p.challengeDeadlineMs = 0;
  clearAttentionChallengeOverlay();
  const window = getAttentionChallengeWindow();
  scheduleNextAttentionChallenge(window.minDelayMs, window.maxDelayMs);
  if (passed) {
    p.challengePasses += 1;
    logProctorEvent("info", "attention_challenge_passed", {
      target,
      reaction_ms: reactionMs,
    }).catch(() => {});
    return;
  }
  p.challengeFailures += 1;
  pushProctorWarning(
    "Attention focus check failed. Keep your eyes on the laptop screen during the exam.",
    "attention_challenge_failed",
    "critical",
  );
}

function evaluateAttentionChallengeResponse() {
  const p = state.assessmentPreview.proctor;
  if (!p.challengeActive || !p.faceReference || !p.lastFaceMetrics) return;
  const ref = p.faceReference;
  const metrics = p.lastFaceMetrics;
  const leftBase = Number(ref.leftGazeX || 0.5);
  const rightBase = Number(ref.rightGazeX || 0.5);
  const leftNow = Number(metrics.leftGazeX || leftBase);
  const rightNow = Number(metrics.rightGazeX || rightBase);
  const leftShift = leftBase - leftNow;
  const rightShift = rightNow - rightBase;
  const passed = p.challengeTarget === "left"
    ? ((leftShift > 0.06 && rightShift < 0.28) || leftShift > 0.075)
    : ((rightShift > 0.06 && leftShift < 0.28) || rightShift > 0.075);
  if (passed) {
    completeAttentionChallenge(true);
    return;
  }
  if (Date.now() >= p.challengeDeadlineMs + 700) {
    completeAttentionChallenge(false);
  }
}

function maybeRunAttentionChallenge() {
  const p = state.assessmentPreview.proctor;
  if (!p.calibrated || !p.faceReference || !p.lastFaceMetrics) return;
  if (p.challengeActive) {
    evaluateAttentionChallengeResponse();
    return;
  }
  const now = Date.now();
  if (!p.challengeNextAtMs) {
    const window = getAttentionChallengeWindow();
    scheduleNextAttentionChallenge(window.minDelayMs, window.maxDelayMs);
    return;
  }
  if (now < p.challengeNextAtMs || now < p.challengeCooldownUntil) return;
  beginAttentionChallenge();
}

const el = {
  loginEmail: $("loginEmail"),
  loginPassword: $("loginPassword"),
  loginShowPasswordBtn: $("loginShowPasswordBtn"),
  loginCard: $("loginCard"),
  signupName: $("signupName"),
  signupEmail: $("signupEmail"),
  signupStudentAge: $("signupStudentAge"),
  signupPassword: $("signupPassword"),
  signupShowPasswordBtn: $("signupShowPasswordBtn"),
  signupRole: $("signupRole"),
  signupVerificationType: $("signupVerificationType"),
  signupVerificationNumber: $("signupVerificationNumber"),
  signupVerificationCountry: $("signupVerificationCountry"),
  signupCard: $("signupCard"),
  showSignupBtn: $("showSignupBtn"),
  showLoginBtn: $("showLoginBtn"),
  workspaceBrand: $("workspaceBrand"),
  workspaceExpandFab: $("workspaceExpandFab"),
  settingsToggles: Array.from(document.querySelectorAll(".js-settings-toggle")),
  settingsMenus: Array.from(document.querySelectorAll(".settings-menu")),
  collapseWorkspaceBtns: Array.from(document.querySelectorAll(".js-collapse-workspace-btn")),
  changePasswordBtns: Array.from(document.querySelectorAll(".js-change-password-btn")),
  adminRecoveryBtns: Array.from(document.querySelectorAll(".js-admin-recovery-btn")),
  adminPasswordBtns: Array.from(document.querySelectorAll(".js-admin-password-btn")),
  sessionBadges: Array.from(document.querySelectorAll(".js-session-badge")),
  userUidBadges: Array.from(document.querySelectorAll(".js-user-uid-badge")),
  logoutBtns: Array.from(document.querySelectorAll(".js-logout-btn")),
  authView: $("authView"),
  studentView: $("studentView"),
  providerView: $("providerView"),
  nonAdminView: $("nonAdminView"),
  nonAdminText: $("nonAdminText"),
  nonAdminRoleFix: $("nonAdminRoleFix"),
  nonAdminRoleSelect: $("nonAdminRoleSelect"),
  nonAdminUpdateRoleBtn: $("nonAdminUpdateRoleBtn"),
  adminView: $("adminView"),
  analyticsGrid: $("analyticsGrid"),
  moderationSummary: $("moderationSummary"),
  moderationTypeCounts: $("moderationTypeCounts"),
  moderationList: $("moderationList"),
  moderationSearch: $("moderationSearch"),
  moderationStatusFilter: $("moderationStatusFilter"),
  reportsBadge: $("reportsBadge"),
  approvalSummary: $("approvalSummary"),
  pendingStudents: $("pendingStudents"),
  pendingProviders: $("pendingProviders"),
  studentsApprovalPane: $("studentsApprovalPane"),
  providersApprovalPane: $("providersApprovalPane"),
  adminUsersSearch: $("adminUsersSearch"),
  refreshAdminUsersBtn: $("refreshAdminUsersBtn"),
  billingPanel: $("billingPanel"),
  loginBtn: $("loginBtn"),
  googleBtn: $("googleBtn"),
  forgotPasswordBtn: $("forgotPasswordBtn"),
  signupBtn: $("signupBtn"),
  providerHomeStats: $("providerHomeStats"),
  studentStats: $("studentStats"),
  studentHomeAvailableList: $("studentHomeAvailableList"),
  studentHomeEnrolledList: $("studentHomeEnrolledList"),
  studentCertificatesList: $("studentCertificatesList"),
  studentCertificatesTabList: $("studentCertificatesTabList"),
  studentCertificationsSearch: $("studentCertificationsSearch"),
  studentCertificationsSort: $("studentCertificationsSort"),
  studentCertificationsStatus: $("studentCertificationsStatus"),
  studentCertificationsFilterBtn: $("studentCertificationsFilterBtn"),
  studentCertificationsFilterMenu: $("studentCertificationsFilterMenu"),
  studentAvailableCourses: $("studentAvailableCourses"),
  studentAvailableCourseTitle: $("studentAvailableCourseTitle"),
  studentAvailableCourseTopMeta: $("studentAvailableCourseTopMeta"),
  studentAvailableCourseMeta: $("studentAvailableCourseMeta"),
  studentAvailableCourseDescription: $("studentAvailableCourseDescription"),
  studentAvailableCourseAbout: $("studentAvailableCourseAbout"),
  studentAvailableCourseContent: $("studentAvailableCourseContent"),
  studentAvailableCoursePrice: $("studentAvailableCoursePrice"),
  studentAvailableCourseVerifyNote: $("studentAvailableCourseVerifyNote"),
  studentAvailableCourseLevel: $("studentAvailableCourseLevel"),
  studentAvailableCourseLanguage: $("studentAvailableCourseLanguage"),
  studentAvailableCourseViews: $("studentAvailableCourseViews"),
  studentAvailableCoursePreviewVideo: $("studentAvailableCoursePreviewVideo"),
  studentAvailableIntroVideo: $("studentAvailableIntroVideo"),
  studentAvailableIntroMeta: $("studentAvailableIntroMeta"),
  studentAvailableCourseBackBtn: $("studentAvailableCourseBackBtn"),
  studentEnrolledCourses: $("studentEnrolledCourses"),
  studentAvailableSearch: $("studentAvailableSearch"),
  studentAvailableSort: $("studentAvailableSort"),
  studentAvailableFilterBtn: $("studentAvailableFilterBtn"),
  studentAvailableFilterMenu: $("studentAvailableFilterMenu"),
  studentAssessmentsList: $("studentAssessmentsList"),
  studentAssessmentsSearch: $("studentAssessmentsSearch"),
  studentAssessmentsSort: $("studentAssessmentsSort"),
  studentAssessmentsStatus: $("studentAssessmentsStatus"),
  studentAssessmentsFilterBtn: $("studentAssessmentsFilterBtn"),
  studentAssessmentsFilterMenu: $("studentAssessmentsFilterMenu"),
  studentEnrolledSearch: $("studentEnrolledSearch"),
  studentEnrolledSort: $("studentEnrolledSort"),
  studentEnrolledFilterBtn: $("studentEnrolledFilterBtn"),
  studentEnrolledFilterMenu: $("studentEnrolledFilterMenu"),
  providerCoursesSearch: $("providerCoursesSearch"),
  providerCoursesSort: $("providerCoursesSort"),
  providerCoursesFilterBtn: $("providerCoursesFilterBtn"),
  providerCoursesFilterMenu: $("providerCoursesFilterMenu"),
  studentLiveClassesList: $("studentLiveClassesList"),
  studentCourseViewer: $("studentCourseViewer"),
  scvTitle: $("scvTitle"),
  scvMeta: $("scvMeta"),
  scvTopicList: $("scvTopicList"),
  scvLiveClassList: $("scvLiveClassList"),
  scvResourceList: $("scvResourceList"),
  scvProgressBar: $("scvProgressBar"),
  scvProgressText: $("scvProgressText"),
  scvCourseRatingSummary: $("scvCourseRatingSummary"),
  scvRateValue: $("scvRateValue"),
  scvRateContent: $("scvRateContent"),
  scvRateClarity: $("scvRateClarity"),
  scvRatePractical: $("scvRatePractical"),
  scvRatingComment: $("scvRatingComment"),
  scvSaveRatingBtn: $("scvSaveRatingBtn"),
  scvRatingStatus: $("scvRatingStatus"),
  scvAssessmentPanel: $("scvAssessmentPanel"),
  scvAssessmentStatus: $("scvAssessmentStatus"),
  providerCoursesList: $("providerCoursesList"),
  providerCourseCreateMount: $("providerCourseCreateMount"),
  closeCourseCreatePageBtn: $("closeCourseCreatePageBtn"),
  providerDraftsPage: $("providerDraftsPage"),
  providerCourseViewer: $("providerCourseViewer"),
  pcvTitle: $("pcvTitle"),
  pcvTopicList: $("pcvTopicList"),
  pcvLiveClassList: $("pcvLiveClassList"),
  courseWizard: $("courseWizard"),
  courseWizardTitle: $("courseWizardTitle"),
  cwStepDetails: $("cwStepDetails"),
  cwStepVideo: $("cwStepVideo"),
  cwStepTopics: $("cwStepTopics"),
  cwStepPricing: $("cwStepPricing"),
  cwTopicsDraftList: $("cwTopicsDraftList"),
  cwTimelineMarkers: $("cwTimelineMarkers"),
  cwMarkerTooltip: $("cwMarkerTooltip"),
  providerDraftsList: $("providerDraftsList"),
  providerAssessmentsList: $("providerAssessmentsList"),
  providerAssessmentsSearch: $("providerAssessmentsSearch"),
  providerAssessmentToolsBtn: $("providerAssessmentToolsBtn"),
  providerAssessmentToolsMenu: $("providerAssessmentToolsMenu"),
  providerAssessmentToolPanel: $("providerAssessmentToolPanel"),
  abAssessmentType: $("abAssessmentType"),
  abInstructions: $("abInstructions"),
  abAbout: $("abAbout"),
  abTools: $("abTools"),
  abTopics: $("abTopics"),
  abPassScore: $("abPassScore"),
  abMcqContentPanel: $("abMcqContentPanel"),
  abTaskContentPanel: $("abTaskContentPanel"),
  abTaskTitle: $("abTaskTitle"),
  abTaskMarks: $("abTaskMarks"),
  abTaskDescription: $("abTaskDescription"),
  abTaskInstructions: $("abTaskInstructions"),
  assessmentCatalogList: $("assessmentCatalogList"),
  assessmentCatalogSearch: $("assessmentCatalogSearch"),
  assessmentCatalogDuration: $("assessmentCatalogDuration"),
  assessmentCatalogSort: $("assessmentCatalogSort"),
  refreshAssessmentCatalogBtn: $("refreshAssessmentCatalogBtn"),
  assessmentCatalogDetail: $("assessmentCatalogDetail"),
  assessmentDetailTitle: $("assessmentDetailTitle"),
  assessmentDetailPassBadge: $("assessmentDetailPassBadge"),
  assessmentDetailActions: $("assessmentDetailActions"),
  backToAssessmentCatalogBtn: $("backToAssessmentCatalogBtn"),
  issueCandidateName: $("issueCandidateName"),
  issueCandidateEmail: $("issueCandidateEmail"),
  issueAssessmentStatus: $("issueAssessmentStatus"),
  issuedAssessmentsList: $("issuedAssessmentsList"),
  issuedCandidateEmail: $("issuedCandidateEmail"),
  issuedCandidatePassword: $("issuedCandidatePassword"),
  issuedAssessmentAttemptScreen: $("issuedAssessmentAttemptScreen"),
  issuedAssessmentTitle: $("issuedAssessmentTitle"),
  issuedAssessmentMeta: $("issuedAssessmentMeta"),
  issuedAssessmentQuestions: $("issuedAssessmentQuestions"),
  issuedAssessmentStatus: $("issuedAssessmentStatus"),
  issuedCountStat: $("issuedCountStat"),
  takenCountStat: $("takenCountStat"),
  avgScoreStat: $("avgScoreStat"),
  providerFeedbackHub: $("providerFeedbackHub"),
  providerFeedbackTiles: $("providerFeedbackTiles"),
  providerComplaintTiles: $("providerComplaintTiles"),
  providerFeedbackTileNew: $("providerFeedbackTileNew"),
  providerFeedbackTileOld: $("providerFeedbackTileOld"),
  providerComplaintTileNew: $("providerComplaintTileNew"),
  providerComplaintTilePending: $("providerComplaintTilePending"),
  providerComplaintTileClosed: $("providerComplaintTileClosed"),
  providerFeedbackNewCount: $("providerFeedbackNewCount"),
  providerFeedbackAvgBadge: $("providerFeedbackAvgBadge"),
  providerComplaintNewCount: $("providerComplaintNewCount"),
  providerComplaintPendingCount: $("providerComplaintPendingCount"),
  providerComplaintClosedCount: $("providerComplaintClosedCount"),
  providerFeedbackDetailPage: $("providerFeedbackDetailPage"),
  providerFeedbackDetailTitle: $("providerFeedbackDetailTitle"),
  providerFeedbackDetailList: $("providerFeedbackDetailList"),
  providerFeedbackBackBtn: $("providerFeedbackBackBtn"),
  providerComplaintsDetailPage: $("providerComplaintsDetailPage"),
  providerComplaintsDetailTitle: $("providerComplaintsDetailTitle"),
  providerComplaintsDetailList: $("providerComplaintsDetailList"),
  providerComplaintsBackBtn: $("providerComplaintsBackBtn"),
  assessmentBuilderScreen: $("assessmentBuilderScreen"),
  abCourseFilter: $("abCourseFilter"),
  abCourseSelect: $("abCourseSelect"),
  abCourseMeta: $("abCourseMeta"),
  abTimingMode: $("abTimingMode"),
  abDurationMinutes: $("abDurationMinutes"),
  abTimePerQuestionSeconds: $("abTimePerQuestionSeconds"),
  abQuestionPoolList: $("abQuestionPoolList"),
  abPoolMeta: $("abPoolMeta"),
  assessmentPreviewScreen: $("assessmentPreviewScreen"),
  apGazeDebugBox: $("apGazeDebugBox"),
  apGazeDebugState: $("apGazeDebugState"),
  apGazeDebugZone: $("apGazeDebugZone"),
  apGazeDebugConfidence: $("apGazeDebugConfidence"),
  apGazeDebugHint: $("apGazeDebugHint"),
  apMeta: $("apMeta"),
  apProctorBadge: $("apProctorBadge"),
  apPrecheckPanel: $("apPrecheckPanel"),
  apPrecheckChecksPage: $("apPrecheckChecksPage"),
  apPrecheckRulesPage: $("apPrecheckRulesPage"),
  apPrecheckInstruction: $("apPrecheckInstruction"),
  apPrecheckInstructionDetail: $("apPrecheckInstructionDetail"),
  apPrecheckVoiceScript: $("apPrecheckVoiceScript"),
  apPrecheckChecklist: $("apPrecheckChecklist"),
  apPrecheckStatus: $("apPrecheckStatus"),
  apProctorVideo: $("apProctorVideo"),
  apProctorHints: $("apProctorHints"),
  apEnvironmentAttest: $("apEnvironmentAttest"),
  apEnvironmentStatus: $("apEnvironmentStatus"),
  apRerunChecksBtn: $("apRerunChecksBtn"),
  apPrecheckNextBtn: $("apPrecheckNextBtn"),
  apBackToChecksBtn: $("apBackToChecksBtn"),
  apRulesReadScript: $("apRulesReadScript"),
  apRulesReadAloudBtn: $("apRulesReadAloudBtn"),
  apRulesReadStatus: $("apRulesReadStatus"),
  apStartTestBtn: $("apStartTestBtn"),
  apQuestionPanel: $("apQuestionPanel"),
  apAttentionChallenge: $("apAttentionChallenge"),
  apAttentionChallengeText: $("apAttentionChallengeText"),
  apAttentionChallengeDot: $("apAttentionChallengeDot"),
  apProgressText: $("apProgressText"),
  apTimerText: $("apTimerText"),
  apQuestionContent: $("apQuestionContent"),
  apQuestionText: $("apQuestionText"),
  apOptionsList: $("apOptionsList"),
  apResultPanel: $("apResultPanel"),
  apResultSummary: $("apResultSummary"),
  apWarningsSummary: $("apWarningsSummary"),
  apTrainingFeedbackPanel: $("apTrainingFeedbackPanel"),
  apTrainingPassBtn: $("apTrainingPassBtn"),
  apTrainingFailBtn: $("apTrainingFailBtn"),
  apTrainingComment: $("apTrainingComment"),
  apTrainingSaveBtn: $("apTrainingSaveBtn"),
  apTrainingFeedbackStatus: $("apTrainingFeedbackStatus"),
  proctorWarningModal: $("proctorWarningModal"),
  proctorWarningBody: $("proctorWarningBody"),
  proctorWarningCountdown: $("proctorWarningCountdown"),
  proctorWarningAcknowledgeBtn: $("proctorWarningAcknowledgeBtn"),
  providerCommentsList: $("providerCommentsList"),
  providerRatingsList: $("providerRatingsList"),
  providerNotificationsList: $("providerNotificationsList"),
  providerCertsList: $("providerCertsList"),
  openLiveClassSchedulerBtn: $("openLiveClassSchedulerBtn"),
  closeLiveClassSchedulerBtn: $("closeLiveClassSchedulerBtn"),
  cancelLiveClassSchedulerBtn: $("cancelLiveClassSchedulerBtn"),
  providerLiveCreateScreen: $("providerLiveCreateScreen"),
  providerLiveStats: $("providerLiveStats"),
  refreshProviderLiveClassesBtn: $("refreshProviderLiveClassesBtn"),
  providerLiveClassSessionsList: $("providerLiveClassSessionsList"),
  createLiveClassBtn: $("createLiveClassBtn"),
  liveClassTitle: $("liveClassTitle"),
  liveClassDescription: $("liveClassDescription"),
  liveClassTimezone: $("liveClassTimezone"),
  liveClassStartAt: $("liveClassStartAt"),
  liveClassEndAt: $("liveClassEndAt"),
  liveClassRecurrencePattern: $("liveClassRecurrencePattern"),
  liveClassRecurrenceCount: $("liveClassRecurrenceCount"),
  liveClassCustomDaysRow: $("liveClassCustomDaysRow"),
  liveClassMode: $("liveClassMode"),
  liveClassExternalUrl: $("liveClassExternalUrl"),
  liveClassMaxParticipants: $("liveClassMaxParticipants"),
  liveClassAllowChat: $("liveClassAllowChat"),
  liveClassAllowRaiseHand: $("liveClassAllowRaiseHand"),
  liveClassAllowReactions: $("liveClassAllowReactions"),
  liveClassGenerateAgendaBtn: $("liveClassGenerateAgendaBtn"),
  liveClassGeneratePollBtn: $("liveClassGeneratePollBtn"),
  liveClassGenerateSummaryBtn: $("liveClassGenerateSummaryBtn"),
  liveClassAiOutput: $("liveClassAiOutput"),
  liveClassAppendAiBtn: $("liveClassAppendAiBtn"),
  liveClassReplaceAiBtn: $("liveClassReplaceAiBtn"),
  refreshStudentLiveClassesBtn: $("refreshStudentLiveClassesBtn"),
  liveClassroomScreen: $("liveClassroomScreen"),
  liveRoomTitle: $("liveRoomTitle"),
  liveRoomMeta: $("liveRoomMeta"),
  liveRoomPresenceBadge: $("liveRoomPresenceBadge"),
  liveRoomSignalStatus: $("liveRoomSignalStatus"),
  liveRoomStageShell: $("liveRoomStageShell"),
  liveRoomStageTopbar: $("liveRoomStageTopbar"),
  liveRoomControlDock: $("liveRoomControlDock"),
  liveRoomStageVideo: $("liveRoomStageVideo"),
  liveRoomStagePlaceholder: $("liveRoomStagePlaceholder"),
  liveRoomFocusTile: $("liveRoomFocusTile"),
  liveRoomFocusVideo: $("liveRoomFocusVideo"),
  liveRoomFocusLabel: $("liveRoomFocusLabel"),
  liveRoomToggleToolsBtn: $("liveRoomToggleToolsBtn"),
  liveRoomToggleChatBtn: $("liveRoomToggleChatBtn"),
  liveRoomReactBtn: $("liveRoomReactBtn"),
  liveRoomReactionMenu: $("liveRoomReactionMenu"),
  liveRoomReactionBurstLayer: $("liveRoomReactionBurstLayer"),
  liveRoomFullscreenBtn: $("liveRoomFullscreenBtn"),
  liveRoomToolsPanel: $("liveRoomToolsPanel"),
  liveRoomChatPanel: $("liveRoomChatPanel"),
  liveRoomWaitingOverlay: $("liveRoomWaitingOverlay"),
  liveRoomWaitingText: $("liveRoomWaitingText"),
  liveRoomVideoStartBtn: $("liveRoomVideoStartBtn"),
  liveRoomVideoStopBtn: $("liveRoomVideoStopBtn"),
  liveRoomToggleMicBtn: $("liveRoomToggleMicBtn"),
  liveRoomShareScreenBtn: $("liveRoomShareScreenBtn"),
  liveRoomStopShareOverlayBtn: $("liveRoomStopShareOverlayBtn"),
  liveRoomParticipantsBtn: $("liveRoomParticipantsBtn"),
  liveRoomParticipantsMenu: $("liveRoomParticipantsMenu"),
  liveRoomParticipantsCountBadge: $("liveRoomParticipantsCountBadge"),
  liveRoomParticipantsCountText: $("liveRoomParticipantsCountText"),
  liveRoomStopShareBtn: $("liveRoomStopShareBtn"),
  liveRoomStartRecordingBtn: $("liveRoomStartRecordingBtn"),
  liveRoomPauseRecordingBtn: $("liveRoomPauseRecordingBtn"),
  liveRoomStopRecordingBtn: $("liveRoomStopRecordingBtn"),
  liveRoomRecordingBadge: $("liveRoomRecordingBadge"),
  liveRoomLocalVideo: $("liveRoomLocalVideo"),
  liveRoomRemoteVideoGrid: $("liveRoomRemoteVideoGrid"),
  leaveLiveRoomBtn: $("leaveLiveRoomBtn"),
  liveRoomBoardText: $("liveRoomBoardText"),
  liveRoomSaveBoardBtn: $("liveRoomSaveBoardBtn"),
  liveRoomRaiseHandBtn: $("liveRoomRaiseHandBtn"),
  liveRoomPickStudentBtn: $("liveRoomPickStudentBtn"),
  liveRoomExportAttendanceBtn: $("liveRoomExportAttendanceBtn"),
  liveRoomTimerText: $("liveRoomTimerText"),
  liveRoomStartTimerBtn: $("liveRoomStartTimerBtn"),
  liveRoomStopTimerBtn: $("liveRoomStopTimerBtn"),
  liveRoomAiTopicInput: $("liveRoomAiTopicInput"),
  liveRoomAiExplainBtn: $("liveRoomAiExplainBtn"),
  liveRoomHandsList: $("liveRoomHandsList"),
  liveRoomWaitingToggle: $("liveRoomWaitingToggle"),
  liveRoomWaitingList: $("liveRoomWaitingList"),
  liveRoomPollQuestion: $("liveRoomPollQuestion"),
  liveRoomPollOptions: $("liveRoomPollOptions"),
  liveRoomStartPollBtn: $("liveRoomStartPollBtn"),
  liveRoomClosePollBtn: $("liveRoomClosePollBtn"),
  liveRoomPollPanel: $("liveRoomPollPanel"),
  liveRoomOpenWhiteboardBtn: $("liveRoomOpenWhiteboardBtn"),
  liveRoomOpenBreakoutBtn: $("liveRoomOpenBreakoutBtn"),
  liveRoomOpenPollBtn: $("liveRoomOpenPollBtn"),
  liveRoomOpenQaBtn: $("liveRoomOpenQaBtn"),
  liveRoomWhiteboardPanel: $("liveRoomWhiteboardPanel"),
  liveRoomPollComposerPanel: $("liveRoomPollComposerPanel"),
  liveRoomBreakoutPanel: $("liveRoomBreakoutPanel"),
  liveRoomQaPanel: $("liveRoomQaPanel"),
  liveRoomShareWhiteboardBtn: $("liveRoomShareWhiteboardBtn"),
  liveRoomShareBreakoutBtn: $("liveRoomShareBreakoutBtn"),
  liveRoomQaInput: $("liveRoomQaInput"),
  liveRoomAddQaBtn: $("liveRoomAddQaBtn"),
  liveRoomShareQaBtn: $("liveRoomShareQaBtn"),
  liveRoomQaList: $("liveRoomQaList"),
  liveRoomChatList: $("liveRoomChatList"),
  liveRoomChatInput: $("liveRoomChatInput"),
  liveRoomSendChatBtn: $("liveRoomSendChatBtn"),
  liveRoomParticipantsList: $("liveRoomParticipantsList"),
  liveRoomBreakoutName: $("liveRoomBreakoutName"),
  liveRoomAssignBreakoutBtn: $("liveRoomAssignBreakoutBtn"),
  liveRoomClearBreakoutsBtn: $("liveRoomClearBreakoutsBtn"),
  authProgressOverlay: $("authProgressOverlay"),
  authProgressTitle: $("authProgressTitle"),
  authProgressDetail: $("authProgressDetail"),
  appNetworkBusy: $("appNetworkBusy"),
  appNetworkBusyText: $("appNetworkBusyText"),
  toastStack: $("toastStack"),
};

const assessmentPrecheckUi = createAssessmentPrecheckUi({
  state,
  el,
  labels: PROCTOR_PRECHECK_TASK_LABELS,
  createDefaultPrecheckChecklist,
});

const renderPrecheckChecklist = (...args) => assessmentPrecheckUi.renderPrecheckChecklist(...args);
const setPrecheckInstruction = (...args) => assessmentPrecheckUi.setPrecheckInstruction(...args);
const showPrecheckChecksPage = (...args) => assessmentPrecheckUi.showPrecheckChecksPage(...args);
const showPrecheckRulesPage = (...args) => assessmentPrecheckUi.showPrecheckRulesPage(...args);
const runRulesReadAloudVerification = (...args) => assessmentPrecheckUi.runRulesReadAloudVerification(...args);
const updateAssessmentStartEligibility = (...args) => assessmentPrecheckUi.updateAssessmentStartEligibility(...args);

const uiFeedback = createUiFeedback({ state, el });
const toast = (...args) => uiFeedback.toast(...args);
const showAuthProgress = (...args) => uiFeedback.showAuthProgress(...args);
const hideAuthProgress = (...args) => uiFeedback.hideAuthProgress(...args);

const apiClient = createApiClient({ state });
const getHeaders = (...args) => apiClient.getHeaders(...args);
const api = (...args) => apiClient.api(...args);

const courseCatalogUi = createCourseCatalogUi({
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
});

const adminUsersUi = createAdminUsersUi({
  state,
  el,
  api,
  toast,
  renderList,
  renderSimpleStats,
  escapeHtmlAttr,
});

const assessmentTimer = createAssessmentTimer({
  state,
  el,
  formatSecondsToClock,
  onAssessmentTimeUp: () => showAssessmentPreviewResult("timer_expired"),
  onQuestionTimeUp: () => onAssessmentQuestionTimerElapsed(),
});

const assessmentBuilderUi = createAssessmentBuilderUi({
  state,
  el,
  $,
  toast,
  api,
  renderList,
  getSelectedAssessmentCourseId,
  isAssessmentDraftSourceSelected,
  getAssessmentSourceValue,
  persistAssessmentBuilderCache,
  resetAssessmentBuilder,
  tryRestoreAssessmentBuilderCache,
  assessmentOnlyMode: ASSESSMENT_ONLY_MODE,
});

const assessmentPreviewProctorUi = createAssessmentPreviewProctorUi({
  state,
  el,
  $,
  renderList,
  beginGazeQuestionGrace,
  persistCurrentStudentAttemptAnswer,
  finalizeGazeQuestionForNavigation,
  showAssessmentPreviewResult,
  assessmentTimer,
  api,
  toast,
});

const liveClassroomUi = createLiveClassroomUi({
  state,
  el,
  escapeHtmlAttr,
  renderList,
  liveParticipantInitials,
  liveParticipantLabel,
  liveRtcState,
  currentLiveUserId,
  pickProviderPeerId,
  pickLastJoinedRemotePeerId,
  streamForPeer,
  setVideoElementStream,
  streamHasActiveVideo,
  setIconButtonLabel,
  liveUiIcon,
  refreshLiveLeaveButton,
  ensureLiveParticipantSelectBinding,
  runHostAction,
  toast,
});

function log(label, payload) {
  console.log(`[${label}]`, payload);
}

function apiErrorStatus(err) {
  try {
    const msg = typeof err?.message === "string" ? err.message : String(err || "");
    const parsed = JSON.parse(msg);
    const status = Number(parsed?.status || 0);
    return Number.isFinite(status) ? status : 0;
  } catch {
    return 0;
  }
}

function showView(mode) {
  if (ASSESSMENT_ONLY_MODE && mode !== "auth" && mode !== "provider") {
    mode = "provider";
  }
  if (mode === "auth" && state.liveRoom.active) {
    clearLiveRoomState();
    el.liveClassroomScreen?.classList.add("hidden");
  }
  [el.authView, el.adminView, el.providerView, el.studentView, el.nonAdminView].forEach((n) => n && n.classList.add("hidden"));
  if (mode === "auth") el.authView?.classList.remove("hidden");
  if (mode === "admin") el.adminView?.classList.remove("hidden");
  if (mode === "provider") el.providerView?.classList.remove("hidden");
  if (mode === "student") el.studentView?.classList.remove("hidden");
  if (mode === "non-admin") el.nonAdminView?.classList.remove("hidden");
  el.workspaceBrand?.classList.add("hidden");
  document.body.classList.toggle("app-workspace-active", mode !== "auth");
  if (mode === "auth") {
    hideAuthProgress();
    el.workspaceExpandFab?.classList.add("hidden");
  } else {
    const collapsed = document.body.classList.contains("workspace-collapsed");
    el.workspaceExpandFab?.classList.toggle("hidden", !collapsed);
  }
  if (mode === "auth") el.settingsMenus.forEach((m) => m.classList.add("hidden"));
}

function showAuthMode(mode = "login") {
  const loginMode = mode !== "signup";
  el.loginCard?.classList.toggle("hidden", !loginMode);
  el.signupCard?.classList.toggle("hidden", loginMode);
  $("issuedCandidateCard")?.classList.remove("hidden");
  if (!loginMode) refreshSignupVerificationOptions();
}

function applyAssessmentOnlyMode() {
  if (!ASSESSMENT_ONLY_MODE) return;
  document.body.classList.add("assessment-only-mode");
  // Restrict workspace to assessment flows only.
  const allowedProviderViews = new Set(["home", "assessments", "assessment-catalog", "assessment-detail"]);
  document.querySelectorAll(".provider-nav-btn").forEach((btn) => {
    const v = String(btn.getAttribute("data-provider-view") || "");
    if (!allowedProviderViews.has(v)) btn.classList.add("hidden");
  });
  document.querySelectorAll(".student-nav-btn").forEach((btn) => btn.classList.add("hidden"));
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => btn.classList.add("hidden"));
  const keepProvider = new Set(["provider-view-home", "provider-view-assessments", "provider-view-assessment-catalog", "provider-view-assessment-detail"]);
  document.querySelectorAll("#providerView .content").forEach((sec) => {
    if (!keepProvider.has(sec.id)) sec.classList.add("hidden");
  });
  document.querySelectorAll("#studentView .content, #adminView .content").forEach((sec) => sec.classList.add("hidden"));
}

const SIGNUP_VERIFICATION_OPTIONS = {
  student: [
    { value: "aadhaar", label: "Aadhaar (India)" },
    { value: "national_id", label: "National ID" },
    { value: "passport", label: "Passport" },
    { value: "driving_license", label: "Driving License" },
    { value: "voter_id", label: "Voter ID" },
    { value: "pan", label: "PAN" },
    { value: "other", label: "Other ID" },
  ],
  provider: [
    { value: "cin", label: "CIN (Business)" },
    { value: "gst", label: "GSTIN (Business)" },
    { value: "pan", label: "PAN" },
    { value: "national_id", label: "National ID" },
    { value: "passport", label: "Passport" },
    { value: "tax_id", label: "Tax ID" },
    { value: "other", label: "Other ID" },
  ],
};

function refreshSignupVerificationOptions() {
  const role = String(el.signupRole?.value || "student").toLowerCase();
  const select = el.signupVerificationType;
  if (!select) return;
  const options = SIGNUP_VERIFICATION_OPTIONS[role] || SIGNUP_VERIFICATION_OPTIONS.student;
  const current = String(select.value || "").trim().toLowerCase();
  select.innerHTML = options.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  const hasCurrent = options.some((item) => item.value === current);
  select.value = hasCurrent ? current : options[0]?.value || "aadhaar";
  const ageInput = el.signupStudentAge;
  if (ageInput) {
    const show = role === "student";
    ageInput.closest("label")?.classList.toggle("hidden", !show);
  }
}

function buildRoleRegistrationPayload(fullName, role) {
  const age = Number(el.signupStudentAge?.value || 0);
  return {
    full_name: fullName,
    role,
    student_age: role === "student" && Number.isFinite(age) && age > 0 ? Math.floor(age) : null,
    verification_id_type: String(el.signupVerificationType?.value || "").trim().toLowerCase() || null,
    verification_id_number: String(el.signupVerificationNumber?.value || "").trim() || null,
    verification_country_code: String(el.signupVerificationCountry?.value || "").trim().toUpperCase() || null,
  };
}

function renderNonAdminRoleFix(context = null) {
  const role = String(context?.role || "").toLowerCase();
  const show = role === "student" || role === "provider";
  el.nonAdminRoleFix?.classList.toggle("hidden", !show);
  if (show && el.nonAdminRoleSelect) {
    el.nonAdminRoleSelect.value = role;
  }
}

function setAuthActionState(ready) {
  [el.loginBtn, el.googleBtn, el.signupBtn].forEach((btn) => {
    if (btn) btn.disabled = !ready;
  });
}

function ensureAuthReady() {
  if (state.authMode === "dummy") return true;
  if (state.auth) return true;
  toast("Authentication is still loading. Wait a moment and try again.", "error");
  return false;
}

function setSessionBadge(text) {
  const full = String(text || "").trim();
  const maxLen = 34;
  state.sessionBadgeText = full.length > maxLen ? `${full.slice(0, maxLen - 2)}..` : full;
  el.sessionBadges.forEach((b) => {
    b.textContent = state.sessionBadgeText;
    b.title = full;
  });
}

function setUserUidBadge(publicUid) {
  const uid = String(publicUid || "").trim();
  state.sessionBadgeUid = uid;
  el.userUidBadges.forEach((b) => {
    b.classList.toggle("hidden", !uid);
    b.textContent = uid ? `UID: ${uid}` : "UID: -";
    b.title = uid ? `UID: ${uid}` : "";
  });
}

function fillProfileForm(prefix, context) {
  const nameInput = $(`${prefix}ProfileName`);
  const uidInput = $(`${prefix}ProfileUid`);
  const phoneInput = $(`${prefix}ProfilePhone`);
  const roleInput = $(`${prefix}ProfileRole`);
  if (nameInput) nameInput.value = String(context?.full_name || "");
  if (uidInput) uidInput.value = String(context?.public_uid || "");
  if (phoneInput) phoneInput.value = String(context?.phone_number || "-");
  if (roleInput) roleInput.value = String(context?.role || "");
  const emailInput = $(`${prefix}ProfileEmail`);
  if (emailInput) emailInput.value = String(context?.email || "");
  const status = $(`${prefix}ProfileStatus`);
  if (status) status.textContent = "";
}

function openCurrentUserProfilePage() {
  if (!state.context?.role) return;
  el.settingsMenus.forEach((m) => m.classList.add("hidden"));
  if (state.context.role === "provider") {
    fillProfileForm("provider", state.context);
    activateProviderSubView("profile");
    return;
  }
  if (state.context.role === "student") {
    fillProfileForm("student", state.context);
    activateStudentSubView("profile");
    return;
  }
  if (state.context.role === "admin") {
    fillProfileForm("admin", state.context);
    activateAdminSubView("profile");
  }
}

async function saveProfileEmail(prefix) {
  const emailInput = $(`${prefix}ProfileEmail`);
  const status = $(`${prefix}ProfileStatus`);
  const nextEmail = String(emailInput?.value || "").trim().toLowerCase();
  if (!nextEmail) {
    if (status) status.textContent = "Email is required.";
    return;
  }
  if (!state.auth?.currentUser) {
    if (status) status.textContent = "Login required.";
    return;
  }
  if (status) status.textContent = "Updating email...";
  try {
    await updateEmail(state.auth.currentUser, nextEmail);
    await state.auth.currentUser.getIdToken(true);
    await loadSessionContext();
    fillProfileForm(prefix, state.context);
    if (status) status.textContent = "Email updated.";
    toast("Email updated");
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("requires-recent-login")) {
      if (status) status.textContent = "Please login again and retry email change.";
      toast("Please login again and retry email change.", "error");
      return;
    }
    if (status) status.textContent = "Failed to update email.";
    toast(formatAuthError(err, "Failed to update email"), "error");
  }
}

function applyWorkspaceCollapse(collapsed) {
  document.body.classList.toggle("workspace-collapsed", collapsed);
  el.collapseWorkspaceBtns.forEach((btn) => {
    btn.textContent = collapsed ? "Expand Workspace" : "Collapse Workspace";
  });
  const onAuth = !el.authView || !el.authView.classList.contains("hidden");
  el.workspaceExpandFab?.classList.toggle("hidden", !collapsed || onAuth);
}

function toggleWorkspaceCollapse() {
  const collapsed = !document.body.classList.contains("workspace-collapsed");
  applyWorkspaceCollapse(collapsed);
  try {
    localStorage.setItem("certora_workspace_collapsed", collapsed ? "1" : "0");
  } catch {}
}

function stopAdminPolling() {
  if (state.adminPollingId) {
    clearInterval(state.adminPollingId);
    state.adminPollingId = null;
  }
}

async function runAdminRecoveryFlow() {
  if (!ensureAuthReady()) return;
  if (!state.auth?.currentUser) {
    toast("Login first, then run admin recovery.", "error");
    return;
  }
  const key = window.prompt("Enter Admin Recovery Key");
  if (!key) return;
  try {
    await api("POST", "/auth/admin/recover-self", { recovery_key: key });
    await state.auth.currentUser.getIdToken(true).catch(() => {});
    await loadSessionContext();
    toast("Admin access granted to this account.");
  } catch (err) {
    toast(formatAuthError(err, "Admin recovery failed"), "error");
    log("admin_recovery_error", String(err));
  }
}

async function runAdminSetUserPasswordFlow() {
  if (!ensureAuthReady()) return;
  if (!state.auth?.currentUser) {
    toast("Login first, then set user password.", "error");
    return;
  }
  const email = window.prompt("User email to reset");
  if (!email) return;
  const newPassword = window.prompt("New password (min 8 chars)");
  if (!newPassword || newPassword.length < 8) {
    toast("Password must be at least 8 characters.", "error");
    return;
  }
  const key = window.prompt("Enter Admin Recovery Key");
  if (!key) return;
  try {
    await api("POST", "/auth/admin/set-user-password", {
      email: String(email).trim().toLowerCase(),
      new_password: String(newPassword).trim(),
      recovery_key: key,
    });
    toast("Password updated for user.");
  } catch (err) {
    toast(formatAuthError(err, "Set user password failed"), "error");
    log("admin_set_password_error", String(err));
  }
}

async function runSelfPasswordChangeFlow() {
  if (!ensureAuthReady()) return;
  const user = state.auth?.currentUser;
  if (!user?.email) {
    toast("No signed-in email user found.", "error");
    return;
  }
  const currentPassword = window.prompt("Current password");
  if (!currentPassword) return;
  const newPassword = window.prompt("New password (min 8 chars)");
  if (!newPassword || newPassword.length < 8) {
    toast("New password must be at least 8 characters.", "error");
    return;
  }
  const confirmPassword = window.prompt("Confirm new password");
  if (!confirmPassword) return;
  if (newPassword !== confirmPassword) {
    toast("Password confirmation does not match.", "error");
    return;
  }
  if (newPassword === currentPassword) {
    toast("New password must be different from current password.", "error");
    return;
  }
  try {
    const credential = EmailAuthProvider.credential(user.email, String(currentPassword));
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, String(newPassword));
    toast("Password changed successfully.");
  } catch (err) {
    toast(formatAuthError(err, "Password change failed"), "error");
    log("self_change_password_error", String(err));
  }
}

function setBadge(node, value) {
  if (!node) return;
  const v = Number(value || 0);
  node.textContent = String(v);
  node.classList.toggle("hidden", v <= 0);
}

function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function renderList(target, items, renderer, empty = "No data.") {
  if (!target) return;
  target.innerHTML = "";
  if (!items.length) {
    target.innerHTML = `<div class="item"><div class="meta">No items</div><div style="margin-top:4px;">${empty}</div></div>`;
    return;
  }
  items.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = renderer(item, index);
    target.appendChild(div);
  });
}

function renderAnalyticsCards(target, stats) {
  if (!target) return;
  const meta = [
    { key: "Onboarded Providers", cls: "t1", icon: "PR" },
    { key: "Students", cls: "t2", icon: "ST" },
    { key: "Enrolled Courses", cls: "t3", icon: "EN" },
    { key: "Issued Certificates", cls: "t4", icon: "CF" },
    { key: "Pass Percentage", cls: "t5", icon: "PP" },
  ];
  target.innerHTML = "";
  meta.forEach((m) => {
    const div = document.createElement("div");
    div.className = `stat analytics ${m.cls}`;
    div.innerHTML = `<div class="icon">${m.icon}</div><div class="text"><div class="k">${m.key}</div><div class="v">${stats[m.key] ?? "-"}</div></div>`;
    target.appendChild(div);
  });
}

function renderProviderHomeCards(target, data) {
  if (!target) return;
  const cards = [
    { key: "Total Courses", value: data.total_courses, cls: "t1", icon: "CR" },
    { key: "Published Courses", value: data.published_courses, cls: "t2", icon: "PB" },
    { key: "Total Enrollments", value: data.total_enrollments, cls: "t3", icon: "EN" },
    { key: "Assessments", value: data.exams_created, cls: "t4", icon: "AS" },
    { key: "Pass Percentage", value: `${data.pass_percentage}%`, cls: "t5", icon: "PP" },
    { key: "Certificates Issued", value: data.certificates_issued, cls: "t1", icon: "CF" },
    { key: "Unread Notifications", value: data.unread_notifications, cls: "t2", icon: "NT" },
  ];
  target.innerHTML = "";
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = `stat analytics ${card.cls}`;
    div.innerHTML = `<div class="icon">${card.icon}</div><div class="text"><div class="k">${card.key}</div><div class="v">${card.value ?? "-"}</div></div>`;
    target.appendChild(div);
  });
}

function renderSimpleStats(target, map) {
  if (!target) return;
  target.innerHTML = "";
  Object.entries(map).forEach(([k, v]) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
    target.appendChild(div);
  });
}

function activateAdminSubView(name) {
  document.querySelectorAll(".nav-btn:not(.provider-nav-btn)").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll('[id^="view-"]').forEach((v) => v.classList.add("hidden"));
  const pane = document.getElementById(`view-${name}`);
  if (pane) pane.classList.remove("hidden");
  if (name === "users") {
    refreshAdminUsers().catch(() => toast("Failed to load users", "error"));
  }
}

function renderStudentHomeCards(target, data) {
  if (!target) return;
  const cards = [
    { key: "Enrolled Courses", value: data?.total_enrolled ?? 0, cls: "t1", icon: "EN" },
    { key: "Completed Courses", value: data?.completed_courses ?? 0, cls: "t2", icon: "CM" },
    { key: "Avg Progress %", value: `${data?.avg_progress ?? 0}%`, cls: "t3", icon: "PR" },
    { key: "Exam Eligible", value: data?.exam_eligible_courses ?? 0, cls: "t4", icon: "EX" },
    { key: "Certificates", value: data?.certificates_issued ?? 0, cls: "t5", icon: "CF" },
  ];
  target.innerHTML = "";
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = `stat analytics ${card.cls}`;
    div.innerHTML = `<div class="icon">${card.icon}</div><div class="text"><div class="k">${card.key}</div><div class="v">${card.value ?? "-"}</div></div>`;
    target.appendChild(div);
  });
}

function renderStudentHomeSnapshots() {
  const suggested = Array.isArray(state.studentDashboard.suggested) ? state.studentDashboard.suggested.slice(0, 6) : [];
  const target = el.studentHomeAvailableList;
  if (!target) return;
  if (!suggested.length) {
    target.innerHTML = `<div class="item"><div class="meta">No suggested courses yet.</div></div>`;
    return;
  }
  const fallbackThumb = "/assets/classagon_logo.png?v=20260422c";
  const difficultyMeta = (course) => {
    const tag = String(course?.difficulty_tag || "").trim();
    const attempts = Number(course?.difficulty_attempt_count || 0);
    if (!tag || attempts < 15) return "";
    const passRate = Number(course?.difficulty_pass_rate_pct);
    const passText = Number.isFinite(passRate) ? ` | Pass rate ${passRate.toFixed(0)}%` : "";
    return `Difficulty: ${tag[0].toUpperCase()}${tag.slice(1)}${passText}`;
  };
  const cards = suggested.map((c) => `
    <article class="course-tile">
      <img src="${escapeHtmlAttr(c.thumbnail_url || fallbackThumb)}" alt="" class="${c.thumbnail_url ? "course-tile-thumb" : "course-tile-thumb is-logo"}" onerror="this.onerror=null;this.src='${fallbackThumb}';this.className='course-tile-thumb is-logo';" />
      <div class="course-tile-body">
        <h4 class="course-tile-title">${escapeHtmlAttr(c.title || "Untitled Course")}</h4>
        <div class="course-tile-provider">${escapeHtmlAttr(c.provider_name || "Provider")}</div>
        <div class="course-tile-meta">${escapeHtmlAttr(c.category || "General")} | ${escapeHtmlAttr(formatCourseRating(c.average_rating, c.rating_count))}</div>
        ${difficultyMeta(c) ? `<div class="course-tile-meta">${escapeHtmlAttr(difficultyMeta(c))}</div>` : ""}
        <div class="actions">
          <button class="btn small" data-student-home-enroll="${Number(c.course_id || 0)}">Enroll</button>
        </div>
      </div>
    </article>
  `).join("");
  target.innerHTML = `<div class="course-tile-grid">${cards}</div>`;
  target.querySelectorAll("[data-student-home-enroll]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const cid = Number(btn.dataset.studentHomeEnroll || 0);
        if (!cid) return;
        await api("POST", "/student/enroll", { course_id: cid });
        toast("Enrollment successful");
        await refreshStudentDashboard();
      } catch {
        toast("Failed to enroll", "error");
      }
    });
  });
}

function buildStudentAssessmentRows() {
  return Array.isArray(state.studentAssessments) ? state.studentAssessments : [];
}

function renderStudentAssessmentsList() {
  if (!el.studentAssessmentsList) return;
  const q = String(el.studentAssessmentsSearch?.value || "").trim().toLowerCase();
  const statusFilter = String(el.studentAssessmentsStatus?.value || "all");
  const sortKey = String(el.studentAssessmentsSort?.value || "latest");
  let rows = Array.isArray(state.studentAssessments) ? [...state.studentAssessments] : [];
  if (q) {
    rows = rows.filter((r) => `${r.title} ${r.provider_name} ${r.category}`.toLowerCase().includes(q));
  }
  if (statusFilter !== "all") {
    rows = rows.filter((r) => r.status === statusFilter);
  }
  rows.sort((a, b) => {
    if (sortKey === "title_asc") return String(a.title).localeCompare(String(b.title));
    if (sortKey === "provider_asc") return String(a.provider_name).localeCompare(String(b.provider_name));
    if (sortKey === "status_available") {
      const rank = { available: 0, locked: 1, unavailable: 2 };
      const ra = rank[a.status] ?? 9;
      const rb = rank[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
    }
    return Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || ""));
  });
  const allRows = Array.isArray(state.studentAssessments) ? state.studentAssessments : [];
  const hasEligible = allRows.some((r) => r.status === "available");
  const eligibleNote = !hasEligible
    ? `
      <div class="item" style="margin-bottom:10px;">
        <div><strong>No eligible assessments right now</strong></div>
        <div style="margin-top:4px;">No directly available assessments yet.</div>
      </div>
    `
    : "";
  if (!rows.length) {
    el.studentAssessmentsList.innerHTML = `
      ${eligibleNote}
      <div class="item">
        <div><strong>No assessments yet</strong></div>
        <div style="margin-top:4px;">Published assessments will appear here.</div>
      </div>
    `;
    return;
  }
  const fallbackThumb = "/assets/classagon_logo.png?v=20260422c";
  const cards = rows.map((r) => `
    <article class="course-tile">
      <img src="${escapeHtmlAttr(r.thumbnail_url || fallbackThumb)}" alt="" class="${r.thumbnail_url ? "course-tile-thumb" : "course-tile-thumb is-logo"}" onerror="this.onerror=null;this.src='${fallbackThumb}';this.className='course-tile-thumb is-logo';" />
      <div class="course-tile-body">
        <h4 class="course-tile-title">${escapeHtmlAttr(r.title)}</h4>
        <div class="course-tile-provider">${escapeHtmlAttr(r.provider_name)}</div>
        <div class="course-tile-meta">${escapeHtmlAttr(r.category)} | Status: ${escapeHtmlAttr(r.statusLabel)}</div>
        <div class="course-tile-meta">Published assessments: ${r.published_assessments}</div>
        <div class="course-tile-meta">Progress: ${Number(r.progress_pct || 0).toFixed(0)}%</div>
        <div class="actions">
          ${r.is_standalone ? "" : `<button class="btn small" data-student-assess-open-course="${r.course_id}">Open Course</button>`}
          ${r.status === "available" ? `<button class="btn small" data-student-assess-start="${r.exam_id}">Start Assessment</button>` : ""}
        </div>
      </div>
    </article>
  `).join("");
  el.studentAssessmentsList.innerHTML = `${eligibleNote}<div class="course-tile-grid">${cards}</div>`;
  document.querySelectorAll("[data-student-assess-open-course]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await openStudentCourseViewer(Number(btn.dataset.studentAssessOpenCourse || 0));
      } catch (err) {
        toast(err?.message || "Failed to open course", "error");
      }
    });
  });
  document.querySelectorAll("[data-student-assess-start]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = Number(btn.dataset.studentAssessStart || 0);
      if (!examId) return;
      try {
        await openStudentAssessmentAttempt(examId);
      } catch (err) {
        toast(err?.message || "Failed to start assessment", "error");
      }
    });
  });
}

async function refreshStudentAssessments() {
  const rows = await api("GET", "/student/assessments/catalog");
  state.studentAssessments = Array.isArray(rows) ? rows : [];
  renderStudentAssessmentsList();
}

function activateProviderSubView(name) {
  if (ASSESSMENT_ONLY_MODE && !["home", "assessments", "assessment-catalog", "assessment-detail"].includes(String(name))) {
    name = "home";
  }
  if (state.providerUsingStudentViewer && name !== "courses") {
    closeProviderUnifiedViewer();
  }
  if (name !== "assessments") {
    el.assessmentBuilderScreen?.classList.add("hidden");
    closeAssessmentPreview();
  }
  document.querySelectorAll(".provider-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.providerView === name));
  document.querySelectorAll('[id^="provider-view-"]').forEach((v) => v.classList.add("hidden"));
  const pane = document.getElementById(`provider-view-${name}`);
  if (pane) pane.classList.remove("hidden");
  if (name === "live") {
    refreshProviderLiveClasses().catch(() => toast("Failed to load live classes", "error"));
  }
  if (name === "feedback") {
    setProviderFeedbackTab(state.providerFeedbackTab || "feedback");
    if (!state.providerFeedbackDetailMode && !state.providerComplaintsDetailStatus) closeProviderFeedbackDetails();
    refreshProviderFeedback().catch(() => toast("Failed to load feedback", "error"));
  }
  if (name === "assessments") {
    refreshIssuedAssessments().catch(() => {});
  }
  if (name === "assessment-catalog") {
    refreshAssessmentCatalogIssueOptions().catch(() => {});
    refreshIssuedAssessments().catch(() => {});
  }
  if (name === "assessment-detail") {
    renderSelectedCatalogDetail();
    refreshIssuedAssessments().catch(() => {});
  }
  if (name === "home") {
    refreshIssuedAssessments().catch(() => {});
  }
}

function ensureCourseWizardMounted() {
  if (!el.providerCourseCreateMount || !el.courseWizard) return;
  if (el.providerCourseCreateMount.contains(el.courseWizard)) return;
  el.providerCourseCreateMount.appendChild(el.courseWizard);
}

function activateStudentSubView(name) {
  const isCoursePage = name === "course";
  const isAvailableDetailPage = name === "available-course";
  const scvShell = $("scvVideoShell");
  const scvVideo = $("scvVideo");
  const scvFrame = $("scvStreamFrame");
  const keepFloating = Boolean(scvShell?.classList.contains("minimized") && scvShell?.classList.contains("scv-shell-detached"));
  if (!isCoursePage) {
    if (!keepFloating) {
      stopStudentStreamHeartbeat();
      setStudentViewerMode("legacy");
      try { scvVideo?.pause?.(); } catch {}
      if (scvFrame) scvFrame.src = "";
    }
    el.studentCourseViewer?.classList.add("hidden");
  }
  document.querySelectorAll(".student-nav-btn").forEach((b) => {
    const target = String(b.dataset.studentView || "");
    b.classList.toggle("active", isCoursePage ? target === "enrolled" : (isAvailableDetailPage ? target === "available" : target === name));
  });
  document.querySelectorAll('[id^="student-view-"]').forEach((v) => v.classList.add("hidden"));
  const pane = document.getElementById(`student-view-${name}`);
  if (pane) pane.classList.remove("hidden");
  if (name === "home" || name === "available" || name === "enrolled" || name === "assessments") {
    refreshStudentDashboard().catch(() => toast("Failed to refresh courses", "error"));
  }
  if (name === "live") {
    refreshStudentLiveClasses().catch(() => toast("Failed to load live classes", "error"));
  }
  if (name === "assessments") {
    refreshStudentAssessments().catch(() => toast("Failed to load assessments", "error"));
  }
  if (name === "certifications") {
    refreshStudentCertifications().catch(() => toast("Failed to load certifications", "error"));
  }
}

function renderApprovalsTab() {
  adminUsersUi.renderApprovalsTab();
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value || "-";
  }
}

function toLocalDatetimeValue(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const off = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - (off * 60 * 1000));
  return local.toISOString().slice(0, 16);
}

function toIsoFromLocalDatetime(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function formatCourseRating(average, count) {
  const avg = Number(average || 0);
  const cnt = Number(count || 0);
  if (!cnt || avg <= 0) return "No ratings yet";
  return `Rating ${avg.toFixed(1)}/5 (${cnt})`;
}

function toggleFilterPopover(menu, trigger, show) {
  courseCatalogUi.toggleFilterPopover(menu, trigger, show);
}

function renderStudentCourseCatalogs() {
  courseCatalogUi.renderStudentCourseCatalogs();
}

function parseTimeToSeconds(raw) {
  const value = String(raw || "").trim();
  if (!value) return NaN;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(":").map((x) => x.trim());
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return NaN;
  if (parts.length === 2) {
    const [mm, ss] = parts.map(Number);
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts.map(Number);
    return hh * 3600 + mm * 60 + ss;
  }
  return NaN;
}

function formatSecondsToClock(totalSeconds) {
  const n = Number(totalSeconds || 0);
  const hh = Math.floor(n / 3600);
  const mm = Math.floor((n % 3600) / 60);
  const ss = n % 60;
  const two = (x) => String(x).padStart(2, "0");
  return hh > 0 ? `${two(hh)}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}

function ensureCourseVideoPreview() {
  const video = $("cwVideoPreview");
  const storageOrManualUrl = $("cwVideoUrl")?.value?.trim();
  const url = state.wizardVideoPlaybackUrl || storageOrManualUrl;
  if (!video || !url) return;
  if (String(url).startsWith("bunny://")) return;
  if (video.getAttribute("src") !== url) {
    video.setAttribute("src", url);
    video.load();
  }
}

function updateVideoTimeMeta() {
  const video = $("cwVideoPreview");
  const meta = $("cwVideoTimeMeta");
  if (!video || !meta) return;
  const current = Math.floor(video.currentTime || 0);
  const duration = Math.floor(video.duration || 0);
  meta.textContent = `${formatSecondsToClock(current)} / ${formatSecondsToClock(duration)}`;
  syncScrubberUi("cwVideoPreview", "cwProgress", "cwBuffered", "cwThumb");
  syncActiveTopic("cwTopicsDraftList", "cwCurrentTopic", state.draftTopics, current);
}

function updateViewerTimeMeta() {
  const video = $("pcvVideo");
  const meta = $("pcvTimeMeta");
  if (!video || !meta) return;
  const current = Math.floor(video.currentTime || 0);
  const duration = Math.floor(video.duration || 0);
  meta.textContent = `${formatSecondsToClock(current)} / ${formatSecondsToClock(duration)}`;
  syncScrubberUi("pcvVideo", "pcvProgress", "pcvBuffered", "pcvThumb");
  syncActiveTopic("pcvTopicList", "pcvCurrentTopic", state.viewerTopics || [], current);
}

function updateStudentViewerTimeMeta() {
  const video = $("scvVideo");
  const meta = $("scvTimeMeta");
  if (!video || !meta) return;
  const total = Number(video.duration || 0);
  const current = Math.floor(Number(video.currentTime || 0));
  const progress = $("scvProgress");
  if (progress) progress.style.width = `${total > 0 ? (current / total) * 100 : 0}%`;
  meta.textContent = `${formatSecondsToClock(current)} / ${formatSecondsToClock(Math.floor(total))}`;
  syncActiveTopic("scvTopicList", "scvCurrentTopic", state.studentViewerTopics || [], current);
}

function stopStudentStreamHeartbeat() {
  const sp = state.studentStreamPlayback;
  const hb = sp.heartbeatId;
  if (hb) {
    clearInterval(hb);
    sp.heartbeatId = null;
  }
  sp.drmLicenseToken = "";
  sp.drmLicenseExpiresAt = 0;
}

function forceStopStudentStreamPlayback(reason = "") {
  stopStudentStreamHeartbeat();
  const sp = state.studentStreamPlayback;
  sp.sessionId = 0;
  sp.lessonVideoId = 0;
  sp.positionSeconds = 0;
  sp.durationSeconds = 0;
  const frame = $("scvStreamFrame");
  if (frame) frame.src = "about:blank";
  if (state.studentViewerMode === "stream") {
    setStudentViewerMode("legacy");
  }
  if (reason) toast(String(reason), "error");
}

function releaseWizardLocalVideoObjectUrl() {
  const prev = String(state.wizardLocalVideoObjectUrl || "");
  if (prev && prev.startsWith("blob:")) {
    try { URL.revokeObjectURL(prev); } catch {}
  }
  state.wizardLocalVideoObjectUrl = "";
}

function setWizardVideoPreviewFromLocalFile(file) {
  if (!file) return "";
  releaseWizardLocalVideoObjectUrl();
  const objectUrl = URL.createObjectURL(file);
  state.wizardLocalVideoObjectUrl = objectUrl;
  state.wizardVideoPlaybackUrl = objectUrl;
  ensureCourseVideoPreview();
  return objectUrl;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function parseApiErrorMessage(err) {
  const parsed = safeJsonParse(err?.message || "");
  if (!parsed || typeof parsed !== "object") return { status: null, detail: null };
  return {
    status: Number(parsed.status || 0) || null,
    detail: parsed.data?.detail ?? null,
  };
}

function setStudentViewerMode(mode = "legacy") {
  const shell = $("scvVideoShell");
  const video = $("scvVideo");
  const frame = $("scvStreamFrame");
  const streamMeta = $("scvStreamMeta");
  state.studentViewerMode = mode === "stream" ? "stream" : "legacy";
  if (state.studentViewerMode === "stream") {
    shell?.classList.add("stream-mode");
    frame?.classList.remove("hidden");
    video?.classList.add("hidden");
    if (streamMeta) streamMeta.classList.remove("hidden");
  } else {
    shell?.classList.remove("stream-mode");
    frame?.classList.add("hidden");
    if (frame) frame.src = "";
    video?.classList.remove("hidden");
    if (streamMeta) {
      streamMeta.classList.add("hidden");
      streamMeta.textContent = "";
    }
  }
}

function streamReadyVideoFromLessons(lessons = []) {
  for (const lesson of lessons || []) {
    const ready = (lesson.videos || []).find((v) => Boolean(v.ready));
    if (ready) return ready;
  }
  return null;
}

async function fetchStudentStreamPayload(courseId) {
  const cid = Number(courseId || 0);
  if (!cid) return null;
  if (state.studentStreamCacheByCourse[cid]) return state.studentStreamCacheByCourse[cid];
  const entitlement = await api("GET", `/stream/courses/${cid}/entitlement`);
  if (!entitlement?.entitled) {
    const payload = { entitlement, lessons: [] };
    state.studentStreamCacheByCourse[cid] = payload;
    return payload;
  }
  const lessonOut = await api("GET", `/stream/courses/${cid}/lessons`);
  const payload = { entitlement, lessons: lessonOut?.lessons || [] };
  state.studentStreamCacheByCourse[cid] = payload;
  return payload;
}

function updateStudentStreamMeta(extra = "") {
  const node = $("scvStreamMeta");
  if (!node || state.studentViewerMode !== "stream") return;
  const sp = state.studentStreamPlayback;
  const base = `Stream: ${formatSecondsToClock(Math.floor(sp.positionSeconds || 0))} / ${formatSecondsToClock(Math.floor(sp.durationSeconds || 0))}`;
  node.textContent = extra ? `${base} | ${extra}` : base;
}

async function issueStudentStreamLicense() {
  const sp = state.studentStreamPlayback;
  if (!sp.sessionId || !sp.lessonVideoId) return "";
  const out = await api("POST", "/stream/license/issue", {
    session_id: Number(sp.sessionId),
    lesson_video_id: Number(sp.lessonVideoId),
    client_app: String(sp.clientApp || "web"),
  });
  const ttl = Math.max(15, Number(out?.expires_in_seconds || 0));
  sp.drmLicenseToken = String(out?.license_token || "");
  sp.drmLicenseExpiresAt = Date.now() + (ttl * 1000);
  return sp.drmLicenseToken;
}

async function ensureStudentStreamLicense() {
  const sp = state.studentStreamPlayback;
  const now = Date.now();
  const remainingMs = Number(sp.drmLicenseExpiresAt || 0) - now;
  if (sp.drmLicenseToken && remainingMs > 15000) return sp.drmLicenseToken;
  return issueStudentStreamLicense();
}

function nextStudentDrmNonce() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function sendStudentStreamHeartbeat() {
  const sp = state.studentStreamPlayback;
  if (!sp.sessionId || !sp.lessonVideoId || !sp.courseId) return;
  if (document.visibilityState === "hidden") return;
  if (state.studentViewerMode !== "stream") return;
  if (Number(state.studentActiveCourseId || 0) !== Number(sp.courseId)) return;
  await ensureStudentStreamLicense();

  const delta = 20; // Lower heartbeat frequency to reduce API calls/cost
  sp.positionSeconds = Math.min(Math.max(0, Number(sp.durationSeconds || 0)), Number(sp.positionSeconds || 0) + delta);
  let out = null;
  const payload = {
    session_id: Number(sp.sessionId),
    lesson_video_id: Number(sp.lessonVideoId),
    watched_seconds_delta: delta,
    position_seconds: Math.max(0, Math.floor(sp.positionSeconds || 0)),
    player_state: "playing",
    drm_license_token: String(sp.drmLicenseToken || ""),
    drm_heartbeat_nonce: nextStudentDrmNonce(),
    ended: false,
  };
  try {
    out = await api("POST", "/stream/watch/heartbeat", payload);
  } catch (err) {
    const parsed = parseApiErrorMessage(err);
    if (Number(parsed.status || 0) === 401) {
      await issueStudentStreamLicense();
      payload.drm_license_token = String(sp.drmLicenseToken || "");
      payload.drm_heartbeat_nonce = nextStudentDrmNonce();
      out = await api("POST", "/stream/watch/heartbeat", payload);
    } else {
      throw err;
    }
  }
  const usage = out?.fair_usage || {};
  const flags = (usage.status_flags || []).join(", ");
  updateStudentStreamMeta(flags || "");
  if (out?.credits_required) {
    forceStopStudentStreamPlayback();
    throw new Error("Maximum watch allowance reached. Buy credits to continue this course.");
  }
  const ratio = Number(sp.durationSeconds || 0) > 0
    ? Number(sp.positionSeconds || 0) / Number(sp.durationSeconds || 1)
    : 0;
  if (ratio >= 0.9 && !state.studentVideoCompletionSent[Number(sp.courseId)]) {
    maybeUnlockAssessmentFromPlayback().catch(() => {});
  }
}

async function startStudentStreamPlayback(courseId, lessonVideo) {
  const cid = Number(courseId || 0);
  const lessonVideoId = Number(lessonVideo?.lesson_video_id || 0);
  if (!cid || !lessonVideoId) return false;

  const tok = await api("POST", "/stream/playback/token", {
    lesson_video_id: lessonVideoId,
    client_app: "web",
  });
  const frame = $("scvStreamFrame");
  if (!frame) return false;

  stopStudentStreamHeartbeat();
  state.studentStreamPlayback = {
    courseId: cid,
    lessonVideoId,
    sessionId: Number(tok.session_id || 0),
    clientApp: "web",
    drmLicenseToken: String(tok.drm_license_token || ""),
    drmLicenseExpiresAt: Date.now() + (Math.max(15, Number(tok.drm_license_expires_in_seconds || 0)) * 1000),
    positionSeconds: Math.max(0, Number(tok.resume_position_seconds || 0)),
    durationSeconds: Math.max(0, Number(lessonVideo?.duration_seconds || 0)),
    heartbeatId: null,
  };

  setStudentViewerMode("stream");
  frame.src = String(tok?.playback?.iframe_url || "");
  updateStudentStreamMeta();
  state.studentStreamPlayback.heartbeatId = setInterval(() => {
    sendStudentStreamHeartbeat().catch((err) => {
      const parsed = parseApiErrorMessage(err);
      const reason = (typeof parsed?.detail === "string" && parsed.detail)
        || parsed?.detail?.message
        || err?.message
        || "Stream access failed";
      forceStopStudentStreamPlayback(reason);
    });
  }, 20000);
  return true;
}

function getStudentPlaybackPolicy(courseId) {
  if (!courseId) return null;
  return state.studentPlaybackPolicyByCourse[Number(courseId)] || null;
}

function ensureStudentPlaybackPolicy(courseId, progressPct = 0) {
  const id = Number(courseId || 0);
  if (!id) return null;
  if (!state.studentPlaybackPolicyByCourse[id]) {
    const seed = Math.max(0, Math.min(100, Number(progressPct || 0)));
    state.studentPlaybackPolicyByCourse[id] = {
      seedProgressPct: seed,
      seededByDuration: false,
      maxReachedSeconds: 0,
      forwardLocked: seed < 90,
      unlockedToastShown: false,
    };
  }
  return state.studentPlaybackPolicyByCourse[id];
}

function refreshStudentSeekUi() {
  const courseId = Number(state.studentActiveCourseId || 0);
  const policy = getStudentPlaybackPolicy(courseId);
  const locked = Boolean(policy?.forwardLocked);
  const fwdBtn = $("scvFwd10Btn");
  if (fwdBtn) {
    fwdBtn.disabled = locked;
    fwdBtn.title = locked ? "Forward unlocks after 90% watch" : "Forward 10s";
    fwdBtn.setAttribute("aria-disabled", locked ? "true" : "false");
  }
}

function maybeShowStudentSeekLockHint() {
  const now = Date.now();
  if (now - Number(state.studentSeekHintAt || 0) < 1500) return;
  state.studentSeekHintAt = now;
  toast("Forward skip unlocks after 90% watch completion.", "error");
}

function canStudentSeekTo(targetSeconds, currentSeconds = 0) {
  const courseId = Number(state.studentActiveCourseId || 0);
  const policy = getStudentPlaybackPolicy(courseId);
  if (!policy || !policy.forwardLocked) return true;
  if (Number(targetSeconds || 0) <= Number(currentSeconds || 0)) return true;
  return Number(targetSeconds || 0) <= Number(policy.maxReachedSeconds || 0) + 1;
}

function updateStudentPlaybackPolicyFromVideo(video) {
  const courseId = Number(state.studentActiveCourseId || 0);
  if (!courseId || !video) return;
  const policy = ensureStudentPlaybackPolicy(courseId, 0);
  if (!policy) return;
  const duration = Number(video.duration || 0);
  if (duration > 0 && !policy.seededByDuration) {
    const seededSeconds = Math.max(0, Math.min(duration, (Number(policy.seedProgressPct || 0) / 100) * duration));
    policy.maxReachedSeconds = Math.max(Number(policy.maxReachedSeconds || 0), seededSeconds);
    policy.seededByDuration = true;
  }
  const current = Number(video.currentTime || 0);
  policy.maxReachedSeconds = Math.max(Number(policy.maxReachedSeconds || 0), current);
  const ratio = duration > 0 ? current / duration : 0;
  if (policy.forwardLocked && ratio >= 0.9) {
    policy.forwardLocked = false;
    if (!policy.unlockedToastShown) {
      policy.unlockedToastShown = true;
      toast("90% reached. Forward seek is now enabled.");
    }
  }
  refreshStudentSeekUi();
}

async function maybeUnlockAssessmentFromPlayback() {
  const courseId = Number(state.studentActiveCourseId || 0);
  if (!courseId) return;
  if (state.studentVideoCompletionSent[courseId]) return;
  let progressRatio = 0;
  if (state.studentViewerMode === "stream") {
    const sp = state.studentStreamPlayback;
    if (Number(sp.courseId || 0) !== courseId || !Number(sp.durationSeconds || 0)) return;
    progressRatio = Number(sp.positionSeconds || 0) / Number(sp.durationSeconds || 1);
  } else {
    const video = $("scvVideo");
    if (!video || !video.duration) return;
    progressRatio = Number(video.currentTime || 0) / Number(video.duration || 1);
  }
  if (progressRatio < 0.9) return;
  state.studentVideoCompletionSent[courseId] = true;
  try {
    await api("POST", `/student/courses/${courseId}/complete`);
    const unlockedPct = Math.max(90, Math.floor(progressRatio * 100));
    if (el.scvProgressBar) el.scvProgressBar.style.width = `${Math.min(100, unlockedPct)}%`;
    if (el.scvProgressText) el.scvProgressText.textContent = `${Math.min(100, unlockedPct)}%`;
    await refreshStudentAssessmentPanel(courseId, {
      examEligible: true,
      hasRecordedLesson: true,
      progressPct: Math.max(90, progressRatio * 100),
    });
    toast("Assessment unlocked at 90% completion");
    refreshStudentDashboard().catch(() => {});
  } catch {
    state.studentVideoCompletionSent[courseId] = false;
  }
}

function syncScrubberUi(videoId, progressId, bufferedId, thumbId) {
  const video = $(videoId);
  const progress = $(progressId);
  const buffered = $(bufferedId);
  const thumb = $(thumbId);
  if (!video || !progress || !thumb) return;
  const duration = Number(video.duration || 0);
  const current = Number(video.currentTime || 0);
  const pct = duration > 0 ? (current / duration) * 100 : 0;
  progress.style.width = `${pct}%`;
  thumb.style.left = `${pct}%`;
  if (buffered && duration > 0 && video.buffered?.length) {
    const end = video.buffered.end(video.buffered.length - 1);
    buffered.style.width = `${Math.max(0, Math.min(100, (end / duration) * 100))}%`;
  } else if (buffered) {
    buffered.style.width = "0%";
  }
}

function syncActiveTopic(listId, labelId, topics, currentSeconds) {
  const list = $(listId);
  const label = $(labelId);
  if (!list || !Array.isArray(topics)) return;
  const sorted = [...topics].sort((a, b) => a.time_seconds - b.time_seconds);
  let active = null;
  for (const t of sorted) {
    if (Number(t.time_seconds) <= currentSeconds) active = t;
    else break;
  }
  list.querySelectorAll("[data-topic-item]").forEach((n) => n.classList.remove("active-topic"));
  if (active) {
    const node = list.querySelector(`[data-topic-item="${active.time_seconds}"]`);
    node?.classList.add("active-topic");
    if (label) label.textContent = `Topic: ${active.title}`;
  } else if (label) {
    label.textContent = "Topic: -";
  }
}

function findPrimaryLesson(course) {
  const modules = course?.modules || [];
  for (const m of modules) {
    for (const l of (m.lessons || [])) {
      if (l.lesson_type === "recorded_video" && l.recorded_video_url) return l;
    }
  }
  return null;
}

function findLiveLessons(course) {
  const items = [];
  const modules = course?.modules || [];
  for (const m of modules) {
    for (const l of (m.lessons || [])) {
      if (l.lesson_type === "live_class_link" && l.live_class_url) {
        items.push({ ...l, module_title: m.title || "" });
      }
    }
  }
  return items;
}

function canDeleteCourseFromUi() {
  const role = String(state.context?.role || "").toLowerCase();
  const email = String(state.context?.email || "").trim().toLowerCase();
  return role === "provider" || (role === "admin" && email === "admin@certora.in");
}

async function fetchVideoDuration(url) {
  if (!url) return null;
  if (state.videoDurationByUrl[url] !== undefined) return state.videoDurationByUrl[url];
  const duration = await new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => resolve(Math.floor(Number(v.duration || 0)));
    v.onerror = () => resolve(null);
  });
  state.videoDurationByUrl[url] = duration;
  return duration;
}

function resolveCourseThumbnail(course, lesson) {
  const fallback = "/assets/classagon_logo.png?v=20260422c";
  if (course?.thumbnail_url) return course.thumbnail_url;
  const firstTopicThumb = lesson?.topics?.find((t) => t.thumbnail_data_url)?.thumbnail_data_url;
  return firstTopicThumb || fallback;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isDraftAlreadyPosted(draft, courses) {
  const dTitle = normalizeText(draft.title);
  const dVideo = normalizeText(draft.video_url);
  if (!courses?.length) return false;
  return courses.some((course) => {
    const titleMatch = dTitle && normalizeText(course.title) === dTitle;
    if (titleMatch) return true;
    const modules = course.modules || [];
    for (const mod of modules) {
      for (const lesson of (mod.lessons || [])) {
        if (dVideo && normalizeText(lesson.recorded_video_url) === dVideo) return true;
      }
    }
    return false;
  });
}

function formatEventTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown";
  return raw.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function severityTone(value) {
  const v = String(value || "").toLowerCase();
  if (v === "critical") return "status-open";
  if (v === "warning" || v === "manual_review") return "status-in_review";
  return "status-resolved";
}

function showMarkerTooltip(tooltip, marker, topic, thumbnail) {
  if (!tooltip || !marker) return;
  const rect = marker.getBoundingClientRect();
  tooltip.innerHTML = `
    ${thumbnail ? `<img src="${thumbnail}" alt="" />` : ""}
    <div><strong>${topic.title}</strong></div>
    <div class="meta">${formatSecondsToClock(topic.time_seconds)}</div>
  `;
  tooltip.style.left = `${window.scrollX + rect.left - 80}px`;
  tooltip.style.top = `${window.scrollY + rect.top - 110}px`;
  tooltip.classList.remove("hidden");
}

function hideMarkerTooltip(tooltip) {
  tooltip?.classList.add("hidden");
}

function bindCustomPlayerControls({
  videoId,
  shellId,
  playBtnId,
  back10BtnId,
  fwd10BtnId,
  scrubberId,
  hoverPreviewId,
  hoverTimeId,
  speedId,
  volumeId,
  fullscreenBtnId,
  minimizeBtnId,
  topicsGetter,
  updateTimeFn,
  canSeekTo,
  onSeekBlocked,
}) {
  const video = $(videoId);
  const shell = $(shellId);
  const playBtn = $(playBtnId);
  const back10Btn = $(back10BtnId);
  const fwd10Btn = $(fwd10BtnId);
  const scrubber = $(scrubberId);
  const hoverPreview = $(hoverPreviewId);
  const hoverTime = $(hoverTimeId);
  const speed = $(speedId);
  const volume = $(volumeId);
  const fullscreenBtn = $(fullscreenBtnId);
  const minimizeBtn = $(minimizeBtnId);
  if (!video) return;

  const refreshPlayLabel = () => {
    if (!playBtn) return;
    playBtn.innerHTML = video.paused ? materialIcon("play_arrow") : materialIcon("pause");
  };
  const refreshFullscreenIcon = () => {
    if (!fullscreenBtn) return;
    const isFs = document.fullscreenElement === shell;
    fullscreenBtn.innerHTML = isFs ? materialIcon("fullscreen_exit") : materialIcon("fullscreen");
    fullscreenBtn.title = isFs ? "Exit Fullscreen" : "Fullscreen";
    fullscreenBtn.setAttribute("aria-label", isFs ? "Exit Fullscreen" : "Fullscreen");
  };
  const refreshMinimizeIcon = () => {
    if (!minimizeBtn || !shell) return;
    const isMini = shell.classList.contains("minimized");
    minimizeBtn.innerHTML = isMini ? materialIcon("close_fullscreen") : materialIcon("picture_in_picture_alt");
    minimizeBtn.title = isMini ? "Restore player" : "Minimize player";
    minimizeBtn.setAttribute("aria-label", isMini ? "Restore player" : "Minimize player");
  };
  const setMinimized = (next) => {
    if (!shell) return;
    if (next && document.fullscreenElement === shell) return;
    shell.classList.toggle("minimized", Boolean(next));
    if (hideTimer) clearTimeout(hideTimer);
    if (next) {
      shell.classList.add("controls-hidden");
    } else {
      shell.classList.remove("controls-hidden");
    }
    refreshMinimizeIcon();
    shell.dispatchEvent(new CustomEvent("player-minimize-change", { detail: { minimized: Boolean(next) } }));
    if (!next) showControls();
  };
  let hideTimer = null;
  const scheduleControlsHide = () => {
    if (!shell) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      shell.classList.add("controls-hidden");
    }, shell.classList.contains("minimized") ? 1200 : 3000);
  };
  const showControls = () => {
    if (!shell) return;
    shell.classList.remove("controls-hidden");
    scheduleControlsHide();
  };
  playBtn?.addEventListener("click", () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    refreshPlayLabel();
    showControls();
  });
  video.addEventListener("click", () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    refreshPlayLabel();
    showControls();
  });
  video.addEventListener("play", refreshPlayLabel);
  video.addEventListener("pause", refreshPlayLabel);
  video.addEventListener("ended", refreshPlayLabel);

  const seekFromClientX = (clientX) => {
    if (!scrubber) return;
    const rect = scrubber.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (video.duration) {
      const target = ratio * video.duration;
      if (canSeekTo && !canSeekTo(target, Number(video.currentTime || 0), video, "scrubber")) {
        onSeekBlocked?.("scrubber");
        return;
      }
      video.currentTime = target;
    }
    updateTimeFn();
  };
  const showHoverPreview = async (clientX) => {
    if (!scrubber || !video.duration) return;
    const rect = scrubber.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const sec = Math.floor(ratio * video.duration);
    const topics = topicsGetter ? topicsGetter() : [];
    const nearest = [...topics].filter((t) => Number(t.time_seconds) <= sec).sort((a, b) => b.time_seconds - a.time_seconds)[0];
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    if (hoverPreview) {
      hoverPreview.innerHTML = `
        ${nearest?.thumbnail_data_url ? `<img src="${nearest.thumbnail_data_url}" alt="" />` : ""}
        <div><strong>${nearest?.title || "No topic"}</strong></div>
      `;
      hoverPreview.style.left = `${x}px`;
      hoverPreview.classList.remove("hidden");
    }
    if (hoverTime) {
      hoverTime.textContent = formatSecondsToClock(sec);
      hoverTime.style.left = `${x}px`;
      hoverTime.classList.remove("hidden");
    }
  };
  scrubber?.addEventListener("pointerdown", (e) => {
    scrubber.classList.add("scrubbing");
    seekFromClientX(e.clientX);
    scrubber.setPointerCapture(e.pointerId);
    showControls();
  });
  scrubber?.addEventListener("pointermove", (e) => {
    if (scrubber.classList.contains("scrubbing")) seekFromClientX(e.clientX);
    showHoverPreview(e.clientX).catch(() => {});
  });
  scrubber?.addEventListener("pointerup", (e) => {
    scrubber.classList.remove("scrubbing");
    scrubber.releasePointerCapture(e.pointerId);
  });
  scrubber?.addEventListener("pointerleave", () => {
    hoverPreview?.classList.add("hidden");
    hoverTime?.classList.add("hidden");
  });
  back10Btn?.addEventListener("click", () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
    updateTimeFn();
  });
  fwd10Btn?.addEventListener("click", () => {
    const target = Math.min(Number(video.duration || video.currentTime + 10), video.currentTime + 10);
    if (canSeekTo && !canSeekTo(target, Number(video.currentTime || 0), video, "forward_button")) {
      onSeekBlocked?.("forward_button");
      return;
    }
    video.currentTime = target;
    updateTimeFn();
  });
  speed?.addEventListener("change", () => {
    video.playbackRate = Number(speed.value || 1);
  });
  volume?.addEventListener("input", () => {
    video.volume = Number(volume.value || 1);
  });
  fullscreenBtn?.addEventListener("click", () => {
    const target = shell || video;
    const isFs = document.fullscreenElement === target;
    if (isFs && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => {});
    }
    showControls();
  });
  minimizeBtn?.addEventListener("click", () => {
    if (!shell) return;
    setMinimized(!shell.classList.contains("minimized"));
  });
  video.addEventListener("loadedmetadata", () => {
    updateTimeFn();
    refreshPlayLabel();
    refreshFullscreenIcon();
    refreshMinimizeIcon();
    showControls();
  });
  video.addEventListener("progress", updateTimeFn);
  document.addEventListener("fullscreenchange", () => {
    refreshFullscreenIcon();
    if (document.fullscreenElement === shell) {
      shell?.classList.remove("minimized");
      refreshMinimizeIcon();
    }
  });
  shell?.addEventListener("mousemove", () => showControls());
  shell?.addEventListener("mouseenter", () => showControls());
  shell?.addEventListener("mouseleave", () => {
    if (hideTimer) clearTimeout(hideTimer);
    shell.classList.add("controls-hidden");
  });
  refreshFullscreenIcon();
  refreshMinimizeIcon();
}

function renderTimelineMarkers(container, tooltip, topics, duration, onSeek) {
  if (!container) return;
  container.innerHTML = "";
  if (!duration || !topics?.length) return;
  topics.forEach((topic) => {
    const marker = document.createElement("div");
    marker.className = "timeline-marker";
    marker.style.left = `${Math.max(0, Math.min(100, (topic.time_seconds / duration) * 100))}%`;
    marker.title = `${topic.title} @ ${formatSecondsToClock(topic.time_seconds)}`;
    marker.addEventListener("click", () => onSeek(topic.time_seconds));
    marker.addEventListener("mouseenter", () => showMarkerTooltip(tooltip, marker, topic, topic.thumbnail_data_url || ""));
    marker.addEventListener("mouseleave", () => hideMarkerTooltip(tooltip));
    container.appendChild(marker);
  });
}

async function captureThumbnailAt(videoUrl, seconds) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.src = videoUrl;
    video.muted = true;
    const done = (value) => resolve(value);
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.max(0, Math.min(seconds, Math.max(0, (video.duration || seconds) - 0.3)));
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 135;
        const ctx = canvas.getContext("2d");
        if (!ctx) return done("");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        done("");
      }
    });
    video.addEventListener("error", () => done(""));
  });
}

function setCourseWizardStep(step) {
  state.courseWizardStep = step;
  el.cwStepDetails?.classList.toggle("hidden", step !== "details");
  el.cwStepVideo?.classList.toggle("hidden", step !== "video");
  el.cwStepTopics?.classList.toggle("hidden", step !== "topics");
  el.cwStepPricing?.classList.toggle("hidden", step !== "pricing");
  if (step === "topics") {
    ensureCourseVideoPreview();
    renderDraftTopics();
  }
  if (step === "pricing") {
    refreshWizardPricing();
  }
}

function coursePricingBreakdownFromBase(baseInput) {
  const base = Math.max(0, Number(baseInput || 0));
  const gstAmount = base * COURSE_PRICING.gstRate;
  const commissionAmount = base * COURSE_PRICING.platformCommissionRate;
  const finalAmount = base + gstAmount + commissionAmount + COURSE_PRICING.hostingFee;
  return {
    base: Number(base.toFixed(2)),
    gstAmount: Number(gstAmount.toFixed(2)),
    commissionAmount: Number(commissionAmount.toFixed(2)),
    hostingFee: Number(COURSE_PRICING.hostingFee.toFixed(2)),
    finalAmount: Number(finalAmount.toFixed(2)),
  };
}

function getWizardSuitableAgeRanges() {
  return Array.from(document.querySelectorAll("[data-cw-age-range]:checked"))
    .map((node) => String(node.getAttribute("data-cw-age-range") || "").trim())
    .filter((key) => COURSE_AGE_RANGE_KEYS.includes(key));
}

function setWizardSuitableAgeRanges(values) {
  const selected = new Set(Array.isArray(values) ? values.map((v) => String(v || "").trim()) : []);
  document.querySelectorAll("[data-cw-age-range]").forEach((node) => {
    const key = String(node.getAttribute("data-cw-age-range") || "").trim();
    node.checked = selected.has(key);
  });
}

function formatInrAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "₹0.00";
  return `₹${numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function refreshWizardPricing() {
  const baseInput = $("cwBasePriceAmount");
  const breakdown = coursePricingBreakdownFromBase(baseInput?.value || 0);
  const baseNode = $("cwPricingBase");
  const gstNode = $("cwPricingGst");
  const commissionNode = $("cwPricingCommission");
  const hostingNode = $("cwPricingHosting");
  const finalNode = $("cwPricingFinal");
  if (baseNode) baseNode.textContent = formatInrAmount(breakdown.base);
  if (gstNode) gstNode.textContent = formatInrAmount(breakdown.gstAmount);
  if (commissionNode) commissionNode.textContent = formatInrAmount(breakdown.commissionAmount);
  if (hostingNode) hostingNode.textContent = formatInrAmount(breakdown.hostingFee);
  if (finalNode) finalNode.textContent = formatInrAmount(breakdown.finalAmount);
}

function renderDraftTopics() {
  const target = el.cwTopicsDraftList;
  if (!target) return;
  const video = $("cwVideoPreview");
  target.innerHTML = "";
  if (!state.draftTopics.length) {
    target.innerHTML = `<div class="item"><div class="meta">No topics added yet.</div></div>`;
    if (video) renderTimelineMarkers(el.cwTimelineMarkers, el.cwMarkerTooltip, [], Number(video.duration || 0), () => {});
    return;
  }
  const sorted = [...state.draftTopics].sort((a, b) => a.time_seconds - b.time_seconds);
  sorted.forEach((t, idx) => {
    const node = document.createElement("div");
    node.className = "item topic-item";
    node.setAttribute("data-topic-item", String(t.time_seconds));
    node.innerHTML = `
      ${t.thumbnail_data_url ? `<img src="${t.thumbnail_data_url}" alt="" style="width:100%;border-radius:8px;border:1px solid #e5e7eb; margin-bottom:6px;" />` : ""}
      <div><strong>${t.title}</strong></div>
      <div class="meta">${formatSecondsToClock(t.time_seconds)}</div>
      <div class="actions">
        <button class="btn small" data-seek-topic="${t.time_seconds}">Go</button>
        <button class="btn small danger" data-remove-topic="${idx}">Remove</button>
      </div>
    `;
    target.appendChild(node);
  });
  target.querySelectorAll("[data-remove-topic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeTopic);
      state.draftTopics = sorted.filter((_, i) => i !== idx);
      renderDraftTopics();
    });
  });
  target.querySelectorAll("[data-seek-topic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!video) return;
      video.currentTime = Number(btn.dataset.seekTopic || 0);
      video.play().catch(() => {});
    });
  });
  if (video) {
    renderTimelineMarkers(el.cwTimelineMarkers, el.cwMarkerTooltip, sorted, Number(video.duration || 0), (seconds) => {
      video.currentTime = seconds;
      video.play().catch(() => {});
    });
  }
}

function resetCourseWizard() {
  state.activeDraftId = null;
  state.draftTopics = [];
  state.wizardVideoPlaybackUrl = "";
  state.wizardVideoUploadPromise = null;
  state.wizardUploadAbortController = null;
  releaseWizardLocalVideoObjectUrl();
  ["cwCourseTitle", "cwCourseCategory", "cwCourseThumbnail", "cwCourseDescription", "cwIntroVideoUrl", "cwVideoUrl", "cwTopicTitle", "cwTopicTime", "cwBasePriceAmount"].forEach((id) => {
    const node = $(id);
    if (node) node.value = "";
  });
  const level = $("cwCourseLevel");
  if (level) level.value = "Beginner";
  const includesExam = $("cwIncludesExam");
  if (includesExam) includesExam.checked = true;
  setWizardSuitableAgeRanges([]);
  const preview = $("cwVideoPreview");
  if (preview) preview.removeAttribute("src");
  if (el.cwTimelineMarkers) el.cwTimelineMarkers.innerHTML = "";
  hideMarkerTooltip(el.cwMarkerTooltip);
  const timeMeta = $("cwVideoTimeMeta");
  if (timeMeta) timeMeta.textContent = "Current: 00:00";
  refreshWizardPricing();
  setCourseWizardStep("details");
  const progress = $("cwUploadProgress");
  if (progress) progress.textContent = "";
  const videoFile = $("cwVideoFile");
  if (videoFile) videoFile.value = "";
  const thumbFile = $("cwThumbnailFile");
  if (thumbFile) thumbFile.value = "";
  const thumbPreview = $("cwThumbnailPreview");
  if (thumbPreview) {
    thumbPreview.setAttribute("src", "");
    thumbPreview.classList.add("hidden");
  }
  renderDraftTopics();
}

function renderCoursePublishProgress(pct, label = "Publishing your course", cancellable = false) {
  const progress = $("cwUploadProgress");
  if (!progress) return;
  const safePct = Math.max(0, Math.min(100, Number(pct || 0)));
  const cancel = cancellable
    ? `<button id="cwCancelUploadBtn" class="icon-btn" title="Stop" aria-label="Stop"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>`
    : "";
  progress.innerHTML = `
    <div class="upload-progress-wrap">
      <div class="upload-progress-label">${label} (${safePct.toFixed(0)}%) ${cancel}</div>
      <div class="upload-progress-bar"><span style="width:${safePct}%;"></span></div>
    </div>
  `;
  if (cancellable) {
    $("cwCancelUploadBtn")?.addEventListener("click", () => {
      const ctrl = state.wizardUploadAbortController;
      if (ctrl) ctrl.abort();
    });
  }
}

function refreshThumbnailPreview() {
  const url = $("cwCourseThumbnail")?.value?.trim();
  const preview = $("cwThumbnailPreview");
  if (!preview) return;
  if (!url) {
    preview.setAttribute("src", "");
    preview.classList.add("hidden");
    return;
  }
  preview.setAttribute("src", url);
  preview.classList.remove("hidden");
}

function setThumbnailValue(url) {
  const input = $("cwCourseThumbnail");
  if (input) input.value = url || "";
  refreshThumbnailPreview();
}

function captureFrameFromVideoElement(videoEl) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return "";
  }
}

function wizardPayload() {
  const rawVideoUrl = $("cwVideoUrl")?.value?.trim() || "";
  const safeVideoUrl = rawVideoUrl.startsWith("blob:") ? "" : rawVideoUrl;
  const priceBreakdown = coursePricingBreakdownFromBase($("cwBasePriceAmount")?.value || 0);
  return {
    draft_id: state.activeDraftId,
    title: $("cwCourseTitle")?.value?.trim() || "",
    level: $("cwCourseLevel")?.value || "Beginner",
    category: $("cwCourseCategory")?.value?.trim() || "General",
    suitable_age_ranges: getWizardSuitableAgeRanges(),
    description: $("cwCourseDescription")?.value?.trim() || "",
    thumbnail_url: $("cwCourseThumbnail")?.value?.trim() || null,
    includes_exam: Boolean($("cwIncludesExam")?.checked),
    video_url: safeVideoUrl || null,
    intro_video_url: $("cwIntroVideoUrl")?.value?.trim() || null,
    base_price_amount: priceBreakdown.base,
    topics: state.draftTopics,
  };
}

async function saveDraftFromWizard() {
  const out = await api("POST", "/provider/workspace/courses/drafts", wizardPayload());
  state.activeDraftId = out.draft_id;
  return out;
}

async function refreshProviderDrafts() {
  // Always read latest posted courses first so stale drafts can be removed reliably.
  try {
    const latestCourses = await api("GET", "/provider/workspace/content/courses");
    state.providerCourses = latestCourses || [];
  } catch {
    // Fallback to in-memory state if course refresh fails.
  }

  const drafts = await api("GET", "/provider/workspace/courses/drafts");
  state.providerDrafts = Array.isArray(drafts) ? drafts : [];
  const postedDrafts = drafts.filter((d) => isDraftAlreadyPosted(d, state.providerCourses));
  const pendingDrafts = drafts.filter((d) => !isDraftAlreadyPosted(d, state.providerCourses));
  state.providerDrafts = pendingDrafts;

  // Cleanup legacy/stale drafts that already became posted courses.
  postedDrafts.forEach((d) => {
    api("DELETE", `/provider/workspace/courses/drafts/${d.draft_id}`).catch(() => {});
  });

  renderList(
    el.providerDraftsList,
    pendingDrafts,
    (d) => `
      <div><strong>${d.title || "Untitled Draft"}</strong></div>
      <div class="meta">Draft #${d.draft_id} | ${d.level} | Topics: ${d.topics_count} | ${formatTime(d.updated_at)}</div>
      <div class="actions"><button class="btn small" data-load-draft="${d.draft_id}">Open Draft</button></div>
    `,
    "No drafts saved yet.",
  );
  document.querySelectorAll("[data-load-draft]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const draft = await api("GET", `/provider/workspace/courses/drafts/${btn.dataset.loadDraft}`);
        state.activeDraftId = draft.draft_id;
        $("cwCourseTitle").value = draft.title || "";
        $("cwCourseLevel").value = draft.level || "Beginner";
        $("cwCourseCategory").value = draft.category || "General";
        setWizardSuitableAgeRanges(draft.suitable_age_ranges || []);
        $("cwCourseDescription").value = draft.description || "";
        $("cwCourseThumbnail").value = draft.thumbnail_url || "";
        refreshThumbnailPreview();
        $("cwIncludesExam").checked = Boolean(draft.includes_exam);
        $("cwIntroVideoUrl").value = draft.intro_video_url || "";
        $("cwVideoUrl").value = draft.video_url || "";
        $("cwBasePriceAmount").value = String(Number(draft.base_price_amount || 0));
        refreshWizardPricing();
        state.wizardVideoPlaybackUrl = draft.video_play_url || "";
        if (draft.video_play_url && $("cwVideoPreview")) {
          $("cwVideoPreview").setAttribute("src", draft.video_play_url);
          $("cwVideoPreview").load();
        } else {
          ensureCourseVideoPreview();
        }
        state.draftTopics = draft.topics || [];
        renderDraftTopics();
        setCourseWizardStep("details");
        el.providerDraftsPage?.classList.add("hidden");
        el.courseWizard?.classList.remove("hidden");
        toast("Draft loaded");
      } catch {
        toast("Failed to load draft", "error");
      }
    });
  });
}

async function uploadLocalVideoInChunks(file, { progressStart = 5, progressEnd = 78, courseId = null } = {}) {
  const chunkSizeCandidates = [2, 1, 0.5, 0.25].map((mb) => Math.floor(mb * 1024 * 1024));
  let lastErr = null;

  for (let sizeIdx = 0; sizeIdx < chunkSizeCandidates.length; sizeIdx += 1) {
    const abortController = new AbortController();
    state.wizardUploadAbortController = abortController;
    const chunkSize = chunkSizeCandidates[sizeIdx];
    const totalChunks = Math.ceil(file.size / chunkSize);
    const maxParallel = chunkSize >= 1024 * 1024 ? 4 : Math.min(4, Math.max(2, totalChunks));
    renderCoursePublishProgress(progressStart, "Uploading video", true);

    const init = await api("POST", "/provider/workspace/uploads/init", {
      filename: file.name,
      total_size: file.size,
      total_chunks: totalChunks,
      mime_type: file.type || "video/mp4",
    });

    const uploadChunk = async (i) => {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      const fd = new FormData();
      fd.append("chunk", blob, `${file.name}.part`);
      const headers = await getHeaders(true);
      delete headers["Content-Type"];
      const res = await fetch(`/provider/workspace/uploads/${init.session_id}/chunk?index=${i}`, {
        method: "PUT",
        headers,
        body: fd,
        signal: abortController.signal,
      });
      if (!res.ok) {
        const err = new Error(`Upload failed (HTTP ${res.status})`);
        err.status = res.status;
        throw err;
      }
    };

    try {
      let uploadedCount = 0;
      let nextIndex = 0;
      const workers = Array.from({ length: maxParallel }).map(async () => {
        while (nextIndex < totalChunks) {
          const current = nextIndex;
          nextIndex += 1;
          await uploadChunk(current);
          uploadedCount += 1;
          const localPct = (uploadedCount / totalChunks) * 100;
          const overall = progressStart + ((progressEnd - progressStart) * localPct) / 100;
          renderCoursePublishProgress(overall, "Uploading video", true);
        }
      });
      await Promise.all(workers);

      renderCoursePublishProgress(Math.max(progressStart, progressEnd - 2), "Finalizing video", true);
      const completeHeaders = await getHeaders(true);
      const completeUrl = courseId
        ? `/provider/workspace/uploads/${init.session_id}/complete?course_id=${encodeURIComponent(String(courseId))}`
        : `/provider/workspace/uploads/${init.session_id}/complete`;
      const completeRes = await fetch(completeUrl, {
        method: "POST",
        headers: completeHeaders,
        signal: abortController.signal,
      });
      const completeRaw = await completeRes.text();
      let done = {};
      try {
        done = completeRaw ? JSON.parse(completeRaw) : {};
      } catch {
        done = {};
      }
      if (!completeRes.ok) {
        const err = new Error(done?.detail || `Upload failed (HTTP ${completeRes.status})`);
        err.status = completeRes.status;
        throw err;
      }
      $("cwVideoUrl").value = done.storage_ref || done.file_url;
      state.wizardVideoPlaybackUrl = done.file_url || "";
      if (done.file_url && $("cwVideoPreview")) {
        $("cwVideoPreview").setAttribute("src", done.file_url);
        $("cwVideoPreview").load();
      }
      renderCoursePublishProgress(progressEnd, "Video uploaded");
      state.wizardUploadAbortController = null;
      return done.storage_ref || done.file_url;
    } catch (err) {
      if (err?.name === "AbortError") {
        state.wizardUploadAbortController = null;
        throw new Error("Video upload stopped");
      }
      lastErr = err;
      if (Number(err?.status || 0) === 413 && sizeIdx < chunkSizeCandidates.length - 1) {
        renderCoursePublishProgress(progressStart, "Uploading video", true);
        continue;
      }
      if (Number(err?.status || 0) === 413) {
        renderCoursePublishProgress(0, "Upload failed");
      }
      state.wizardUploadAbortController = null;
      throw err;
    }
  }
  state.wizardUploadAbortController = null;
  throw lastErr || new Error("Upload failed");
}

async function uploadToCloudflareDirectUrl(uploadUrl, file, onProgress) {
  const authHeader = {};
  const isSameOrigin = String(uploadUrl || "").startsWith("/")
    || String(uploadUrl || "").startsWith(window.location.origin);
  if (isSameOrigin) {
    try {
      const token = await state.auth?.currentUser?.getIdToken?.();
      if (token) authHeader.Authorization = `Bearer ${token}`;
    } catch {}
  }

  const tryPutRaw = async () => {
    const xhr = new XMLHttpRequest();
    await new Promise((resolve, reject) => {
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      if (authHeader.Authorization) xhr.setRequestHeader("Authorization", authHeader.Authorization);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress((event.loaded / event.total) * 100);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(null);
        else reject(new Error(`Bunny direct PUT failed (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Bunny direct PUT failed"));
      xhr.send(file);
    });
  };

  const tryPostMultipart = async () => {
    const fd = new FormData();
    fd.append("file", file, file.name || "video.mp4");
    const res = await fetch(uploadUrl, { method: "POST", headers: authHeader, body: fd });
    if (!res.ok) throw new Error(`Bunny direct POST failed (HTTP ${res.status})`);
    if (typeof onProgress === "function") onProgress(100);
  };

  try {
    await tryPutRaw();
    return;
  } catch {}
  await tryPostMultipart();
}

async function uploadWizardVideoToStream(courseId, title, file) {
  const progress = $("cwUploadProgress");
  const renderUploadProgress = (pct, label = "Uploading video") => {
    if (!progress) return;
    progress.innerHTML = `
      <div class="upload-progress-wrap">
        <div class="upload-progress-label">${label}</div>
        <div class="upload-progress-bar"><span style="width:${Math.max(0, Math.min(100, pct))}%;"></span></div>
      </div>
    `;
  };

  renderUploadProgress(0, "Preparing upload...");
  const streamLesson = await api("POST", `/stream/courses/${Number(courseId)}/lessons`, {
    title: `${String(title || "Course")} - Stream Lesson`,
    position: 1,
  });
  const init = await api("POST", "/stream/videos/upload-init", {
    lesson_id: Number(streamLesson.lesson_id),
  });
  const uploadUrl = String(init?.upload_url || "").trim();
  if (!uploadUrl) throw new Error("Direct upload URL missing.");

  await uploadToCloudflareDirectUrl(uploadUrl, file, (pct) => {
    renderUploadProgress(pct, "Uploading video...");
  });

  renderUploadProgress(100, "Upload completed. Processing...");
  const lessonVideoId = Number(init?.lesson_video_id || 0);
  if (!lessonVideoId) return init;

  const startMs = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  while (Date.now() - startMs < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await api("GET", `/stream/videos/${lessonVideoId}/status?sync=true`);
    if (status?.ready_status) {
      renderUploadProgress(100, "Video ready");
      return { ...init, ...status };
    }
    renderUploadProgress(100, `Processing (${status?.upload_status || "pending"})...`);
  }
  renderUploadProgress(100, "Upload accepted. Processing is still in progress.");
  return init;
}

async function refreshAnalytics() {
  const data = await api("GET", "/admin/analytics");
  renderAnalyticsCards(el.analyticsGrid, {
    "Onboarded Providers": data.onboarded_providers,
    Students: data.approved_students,
    "Enrolled Courses": data.enrolled_courses,
    "Issued Certificates": data.issued_certificates,
    "Pass Percentage": `${data.pass_percentage}%`,
  });
}

function decisionTone(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("fail") || v.includes("flag")) return "status-open";
  if (v.includes("review")) return "status-in_review";
  return "status-resolved";
}

function normalizeDecision(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v.includes("fail") || v.includes("flag")) return "fail";
  if (v.includes("review")) return "manual_review";
  if (v.includes("pass") || v.includes("clean")) return "pass";
  return v;
}

function renderGlimpseOverview(target, kpis, bars) {
  if (!target) return;
  const total = Math.max(1, Number(bars?.reduce((sum, row) => sum + Number(row?.value || 0), 0) || 0));
  const kpiMarkup = (kpis || []).map((item) => `
    <div class="glimpse-kpi">
      <div class="k">${item.label}</div>
      <div class="v">${item.value}</div>
    </div>
  `).join("");
  const barsMarkup = (bars || []).map((item) => {
    const value = Number(item.value || 0);
    const pct = Math.max(0, Math.min(100, Math.round((value / total) * 100)));
    return `
      <div class="glimpse-bar-row">
        <div>
          <div class="label"><span>${item.label}</span><span>${value}</span></div>
          <div class="bar"><div class="fill" style="width:${pct}%;"></div></div>
        </div>
        <div class="meta">${pct}%</div>
      </div>
    `;
  }).join("");
  target.innerHTML = `
    <div class="glimpse-kpis">${kpiMarkup || '<div class="glimpse-kpi"><div class="k">No data</div><div class="v">-</div></div>'}</div>
    <div class="glimpse-bars">${barsMarkup || '<div class="meta">No chart data.</div>'}</div>
  `;
}

function escapeHtmlAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyModerationFilters(items) {
  const q = (el.moderationSearch?.value || "").toLowerCase().trim();
  const status = el.moderationStatusFilter?.value || "all";
  return items.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (!q) return true;
    const blob = `${item.details || ""} ${item.reporter_name || ""} ${item.complainant_name || ""} ${item.reporter_email || ""} ${item.complainant_email || ""}`.toLowerCase();
    return blob.includes(q);
  });
}

function renderModerationPanel() {
  const raw = state.moderationMode === "reports" ? state.reports : state.complaints;
  const items = applyModerationFilters(raw);
  const byStatus = raw.reduce((acc, item) => ((acc[item.status] = (acc[item.status] || 0) + 1), acc), {});

  renderSimpleStats(el.moderationSummary, {
    Total: raw.length,
    Open: byStatus.open || 0,
    "In Review": byStatus.in_review || 0,
    Resolved: byStatus.resolved || 0,
    Dismissed: byStatus.dismissed || 0,
  });

  const byType = raw.reduce((acc, item) => {
    const type = item.report_type || item.complaint_type || "Other";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  if (el.moderationTypeCounts) el.moderationTypeCounts.innerHTML = Object.entries(byType).map(([k, v]) => `<span class="chip">${k}: ${v}</span>`).join("");

  renderList(
    el.moderationList,
    items,
    (item) => {
      const type = item.report_type || item.complaint_type;
      const person = item.reporter_name || item.complainant_name || "Unknown";
      const email = item.reporter_email || item.complainant_email || "-";
      const path = state.moderationMode === "reports" ? `/admin/reports/${item.id}/status` : `/admin/complaints/${item.id}/status`;
      return `
        <div><strong>#${item.id}</strong> ${type} <span class="status-pill status-${item.status}">${item.status.replace("_", " ")}</span></div>
        <div class="meta">By ${person} (${email}) | ${formatTime(item.created_at)}</div>
        <div style="margin-top:6px;">${item.details || "-"}</div>
        <div class="actions">
          <select data-status-select="${item.id}">
            <option value="open" ${item.status === "open" ? "selected" : ""}>Open</option>
            <option value="in_review" ${item.status === "in_review" ? "selected" : ""}>In Review</option>
            <option value="resolved" ${item.status === "resolved" ? "selected" : ""}>Resolved</option>
            <option value="dismissed" ${item.status === "dismissed" ? "selected" : ""}>Dismissed</option>
          </select>
          <button class="btn small" data-status-save="${item.id}" data-status-path="${path}">Update Status</button>
        </div>
      `;
    },
    "No items found.",
  );

  document.querySelectorAll("[data-status-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.statusSave;
      const path = btn.dataset.statusPath;
      const status = document.querySelector(`[data-status-select="${id}"]`)?.value;
      try {
        await api("POST", path, { status });
        toast("Status updated");
        await refreshModerationData();
      } catch (err) {
        toast("Failed to update status", "error");
      }
    });
  });
}

async function refreshModerationData() {
  const reports = await api("GET", "/admin/reports?page=1&page_size=100");
  const complaints = await api("GET", "/admin/complaints?page=1&page_size=100");
  state.reports = reports.items || [];
  state.complaints = complaints.items || [];
  renderModerationPanel();
}

async function refreshAdminBadges() {
  const badgeData = await api("GET", "/admin/workspace-badges");
  setBadge(el.reportsBadge, badgeData.open_moderation);
}

async function refreshAdminUsers() {
  return adminUsersUi.refreshAdminUsers();
}

async function refreshBilling() {
  const data = await api("GET", "/admin/billing-payments");
  renderList(el.billingPanel, [data], (x) => `<div>${x.message}</div>`, "No billing data.");
}

async function refreshProviderHome() {
  if (ASSESSMENT_ONLY_MODE) {
    await refreshIssuedAssessments();
    return;
  }
  const data = await api("GET", "/provider/workspace/home");
  renderProviderHomeCards(el.providerHomeStats, data);
}

async function refreshStudentDashboard() {
  const [data, publicCourses] = await Promise.all([
    api("GET", "/student/dashboard"),
    api("GET", "/courses/public"),
  ]);
  renderStudentHomeCards(el.studentStats, data.stats || {});
  const available = Array.isArray(data.available) ? data.available : [];
  const enrolled = Array.isArray(data.enrolled) ? data.enrolled : [];
  const suggested = Array.isArray(data.suggested) ? data.suggested : [];
  const enrolledIds = new Set(enrolled.map((c) => Number(c.course_id || 0)));
  const availableIds = new Set(available.map((c) => Number(c.course_id || 0)));
  const publicList = Array.isArray(publicCourses) ? publicCourses : [];
  const mergedAvailable = [...available];
  for (const c of publicList) {
    const cid = Number(c?.id || 0);
    if (!cid || enrolledIds.has(cid) || availableIds.has(cid)) continue;
    mergedAvailable.push({
      course_id: cid,
      title: c?.title || "Untitled Course",
      category: c?.category || "General",
      suitable_age_ranges: Array.isArray(c?.suitable_age_ranges) ? c.suitable_age_ranges : [],
      provider_name: "Provider",
      thumbnail_url: c?.thumbnail_url || null,
      average_rating: Number(c?.average_rating || 0),
      rating_count: Number(c?.rating_count || 0),
      created_at: c?.created_at || null,
    });
    availableIds.add(cid);
  }
  state.studentDashboard.available = mergedAvailable;
  state.studentDashboard.enrolled = enrolled;
  state.studentDashboard.suggested = suggested.length ? suggested : mergedAvailable;
  renderStudentHomeSnapshots();
  renderStudentCourseCatalogs();
}

async function refreshStudentCertifications() {
  const certs = await api("GET", "/student/certificates");
  state.studentCertificates = Array.isArray(certs) ? certs : [];
  renderStudentCertificationsList();
}

function renderStudentCertificationsList() {
  const target = el.studentCertificatesTabList;
  if (!target) return;
  const q = String(el.studentCertificationsSearch?.value || "").trim().toLowerCase();
  const sortKey = String(el.studentCertificationsSort?.value || "latest");
  const statusKey = String(el.studentCertificationsStatus?.value || "all");
  let rows = Array.isArray(state.studentCertificates) ? [...state.studentCertificates] : [];
  if (q) {
    rows = rows.filter((c) => {
      const hay = `${c.course_name || ""} ${c.provider_name || ""} ${c.certificate_id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (statusKey !== "all") {
    rows = rows.filter((c) => String(c.status || "").toLowerCase() === statusKey);
  }
  rows.sort((a, b) => {
    if (sortKey === "course_asc") return String(a.course_name || "").localeCompare(String(b.course_name || ""));
    if (sortKey === "provider_asc") return String(a.provider_name || "").localeCompare(String(b.provider_name || ""));
    return Date.parse(String(b.issued_at || "")) - Date.parse(String(a.issued_at || ""));
  });

  const certRenderer = (c) => `
    <div>
      <div><strong>${c.course_name}</strong></div>
      <div class="meta">Certificate ID: ${c.certificate_id} | Provider: ${c.provider_name || "Provider"} | Status: ${String(c.status || "active")}</div>
      <div class="meta">Issued: ${formatTime(c.issued_at)}</div>
      <div class="actions">
        ${c.download_url ? `<a class="btn small" href="${c.download_url}" target="_blank" rel="noreferrer">Download PDF</a>` : ""}
      </div>
    </div>
  `;
  renderList(
    target,
    rows,
    certRenderer,
    "No certificates yet. Complete courses and pass assessments to receive certificates.",
  );
}

function providerLiveSchedulerSetVisible(visible) {
  if (!el.providerLiveCreateScreen) return;
  el.providerLiveCreateScreen.classList.toggle("hidden", !visible);
}

function applyProviderLiveModeUi() {
  const mode = String(el.liveClassMode?.value || "in_app");
  const external = mode === "external";
  if (el.liveClassExternalUrl) {
    el.liveClassExternalUrl.disabled = !external;
    if (!external) el.liveClassExternalUrl.value = "";
  }
}

function applyProviderLiveRecurrenceUi() {
  const pattern = String(el.liveClassRecurrencePattern?.value || "none");
  const isCustom = pattern === "custom";
  el.liveClassCustomDaysRow?.classList.toggle("hidden", !isCustom);
  if (pattern === "none" && el.liveClassRecurrenceCount) {
    el.liveClassRecurrenceCount.value = "1";
  }
}

function getLiveCustomDays() {
  return Array.from(document.querySelectorAll("[data-live-custom-day]:checked"))
    .map((node) => Number(node.getAttribute("data-live-custom-day") || -1))
    .filter((n) => n >= 0 && n <= 6);
}

function generateLiveClassAiDraft(kind = "agenda") {
  const title = String(el.liveClassTitle?.value || "Live Session").trim() || "Live Session";
  const desc = String(el.liveClassDescription?.value || "").trim();
  const topicSeed = desc || title;
  const compactTopic = topicSeed.length > 100 ? `${topicSeed.slice(0, 100)}...` : topicSeed;
  if (kind === "poll") {
    return [
      `Poll Pack for "${title}"`,
      "",
      "1) Which part needs more explanation?",
      "Options: Basics / Intermediate / Advanced / Real example",
      "",
      `2) How confident are you with "${compactTopic}"?`,
      "Options: 1-Low / 2 / 3 / 4 / 5-High",
      "",
      "3) What should we practice next?",
      "Options: Quiz / Case study / Hands-on / Discussion",
    ].join("\n");
  }
  if (kind === "summary") {
    return [
      `Recap Notes for "${title}"`,
      "",
      "- Key concept covered:",
      "- Common student mistakes observed:",
      "- Practical use-case discussed:",
      "- Assignment given:",
      "- Assessment readiness check:",
      "- Next class topic:",
    ].join("\n");
  }
  return [
    `Teaching Agenda for "${title}"`,
    "",
    "00:00 - 05:00  Welcome + class objectives",
    `05:00 - 20:00  Core concept walkthrough: ${compactTopic}`,
    "20:00 - 30:00  Whiteboard explanation + examples",
    "30:00 - 40:00  Interactive poll + raise-hand Q&A",
    "40:00 - 50:00  Practice exercise / mini case",
    "50:00 - 60:00  Summary + next steps + assessment prep",
    "",
    "Teaching prompts:",
    "- Ask one conceptual question every 10 minutes.",
    "- Use chat checkpoints to confirm understanding.",
    "- End with one practical application task.",
  ].join("\n");
}

function resetProviderLiveScheduler() {
  state.providerLiveEditSessionId = null;
  if (el.liveClassTitle) el.liveClassTitle.value = "";
  if (el.liveClassDescription) el.liveClassDescription.value = "";
  if (el.liveClassTimezone) el.liveClassTimezone.value = "Asia/Kolkata";
  if (el.liveClassStartAt) el.liveClassStartAt.value = "";
  if (el.liveClassEndAt) el.liveClassEndAt.value = "";
  if (el.liveClassRecurrencePattern) el.liveClassRecurrencePattern.value = "none";
  if (el.liveClassRecurrenceCount) el.liveClassRecurrenceCount.value = "1";
  document.querySelectorAll("[data-live-custom-day]").forEach((n) => { n.checked = false; });
  if (el.liveClassMode) el.liveClassMode.value = "in_app";
  if (el.liveClassExternalUrl) el.liveClassExternalUrl.value = "";
  if (el.liveClassMaxParticipants) el.liveClassMaxParticipants.value = "200";
  if (el.liveClassAllowChat) el.liveClassAllowChat.checked = true;
  if (el.liveClassAllowRaiseHand) el.liveClassAllowRaiseHand.checked = true;
  if (el.liveClassAllowReactions) el.liveClassAllowReactions.checked = true;
  if (el.liveClassAiOutput) el.liveClassAiOutput.value = "";
  if (el.createLiveClassBtn) el.createLiveClassBtn.textContent = "Create Live Class";
  applyProviderLiveModeUi();
  applyProviderLiveRecurrenceUi();
}

function fillProviderLiveScheduler(session) {
  if (!session) return;
  state.providerLiveEditSessionId = Number(session.session_id || 0);
  if (el.liveClassTitle) el.liveClassTitle.value = session.title || "";
  if (el.liveClassDescription) el.liveClassDescription.value = session.description || "";
  if (el.liveClassTimezone) el.liveClassTimezone.value = session.timezone || "Asia/Kolkata";
  if (el.liveClassStartAt) el.liveClassStartAt.value = toLocalDatetimeValue(session.scheduled_start_at);
  if (el.liveClassEndAt) el.liveClassEndAt.value = toLocalDatetimeValue(session.scheduled_end_at);
  if (el.liveClassRecurrencePattern) el.liveClassRecurrencePattern.value = session.recurrence_pattern || "none";
  if (el.liveClassRecurrenceCount) el.liveClassRecurrenceCount.value = String(session.recurrence_count || 1);
  const customDays = new Set((session.recurrence_custom_days || []).map((x) => Number(x)));
  document.querySelectorAll("[data-live-custom-day]").forEach((n) => {
    const day = Number(n.getAttribute("data-live-custom-day") || -1);
    n.checked = customDays.has(day);
  });
  if (el.liveClassMode) el.liveClassMode.value = session.meeting_mode || "in_app";
  if (el.liveClassExternalUrl) el.liveClassExternalUrl.value = session.external_meeting_url || "";
  if (el.liveClassMaxParticipants) el.liveClassMaxParticipants.value = String(session.max_participants || 200);
  if (el.liveClassAllowChat) el.liveClassAllowChat.checked = Boolean(session.allow_chat);
  if (el.liveClassAllowRaiseHand) el.liveClassAllowRaiseHand.checked = Boolean(session.allow_raise_hand);
  if (el.liveClassAllowReactions) el.liveClassAllowReactions.checked = Boolean(session.allow_reactions);
  if (el.createLiveClassBtn) el.createLiveClassBtn.textContent = "Update Live Class";
  applyProviderLiveModeUi();
  applyProviderLiveRecurrenceUi();
}

async function refreshProviderLiveClasses() {
  const out = await api("GET", "/provider/workspace/live-classes");
  const items = out?.items || [];
  state.providerLiveSessions = items;
  const liveCount = items.filter((s) => s.status === "live").length;
  const scheduledCount = items.filter((s) => s.status === "scheduled").length;
  const completedCount = items.filter((s) => s.status === "ended").length;
  renderSimpleStats(el.providerLiveStats, {
    "Scheduled": scheduledCount,
    "Live Now": liveCount,
    "Completed": completedCount,
  });
  renderList(
    el.providerLiveClassSessionsList,
    items,
    (s) => {
      const isLive = s.status === "live";
      const isClosed = s.status === "ended" || s.status === "cancelled";
      const isScheduled = s.status === "scheduled";
      const ratingClass = isLive ? "status-open" : (isClosed ? "status-dismissed" : "status-in_review");
      const modeLabel = s.meeting_mode === "external" ? "External" : "In-app";
      const recurrenceLabel = s.recurrence_pattern && s.recurrence_pattern !== "none"
        ? `${s.recurrence_pattern} x${Number(s.recurrence_count || 1)}`
        : "one-time";
      return `
        <div>
          <div class="row between">
            <strong>${escapeHtmlAttr(s.title || "Untitled class")}</strong>
            <span class="status-pill ${ratingClass}">${escapeHtmlAttr(s.status || "scheduled")}</span>
          </div>
          <div class="meta">Live Course: ${escapeHtmlAttr(s.course_title || `#${s.course_id}`)} (ID #${Number(s.course_id || 0)}) | Participants: ${Number(s.participant_count || 0)} | Mode: ${modeLabel}</div>
          <div class="meta">Schedule: ${escapeHtmlAttr(recurrenceLabel)}</div>
          <div class="meta">${formatTime(s.scheduled_start_at)}${s.scheduled_end_at ? ` to ${formatTime(s.scheduled_end_at)}` : ""} (${escapeHtmlAttr(s.timezone || "UTC")})</div>
          ${s.description ? `<div style="margin-top:4px;">${escapeHtmlAttr(s.description)}</div>` : ""}
          <div class="actions">
            ${isClosed ? "" : `<button class="btn small" data-provider-live-join="${s.session_id}">Join Room</button>`}
            ${isScheduled ? `<button class="btn small" data-provider-live-start="${s.session_id}">Start Session</button>` : ""}
            ${isLive ? `<button class="btn small danger" data-provider-live-end="${s.session_id}">Complete Session</button>` : ""}
            ${s.meeting_mode === "external" && s.external_meeting_url ? `<a class="btn small" href="${s.external_meeting_url}" target="_blank" rel="noreferrer">Open Meeting</a>` : ""}
            ${isScheduled ? `<button class="btn small" data-provider-live-edit="${s.session_id}">Edit</button>` : ""}
          </div>
        </div>
      `;
    },
    "No live classes scheduled yet.",
  );
  document.querySelectorAll("[data-provider-live-join]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.providerLiveJoin || 0);
      if (!sessionId) return;
      try {
        await api("POST", `/provider/workspace/live-classes/${sessionId}/join`);
        await openLiveClassroom(sessionId, "provider");
      } catch (err) {
        toast(err?.message || "Failed to join live class", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-live-start]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.providerLiveStart || 0);
      if (!sessionId) return;
      try {
        await api("POST", `/provider/workspace/live-classes/${sessionId}/start`);
        toast("Live class started");
        await refreshProviderLiveClasses();
      } catch (err) {
        toast(err?.message || "Failed to start live class", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-live-end]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.providerLiveEnd || 0);
      if (!sessionId) return;
      const ok = confirm("End this live class now? This will unlock assessments for enrolled students.");
      if (!ok) return;
      try {
        const out2 = await api("POST", `/provider/workspace/live-classes/${sessionId}/end`);
        toast(`Live class ended. Students unlocked: ${Number(out2?.students_unlocked || 0)}`);
        await refreshProviderLiveClasses();
      } catch (err) {
        toast(err?.message || "Failed to end live class", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-live-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sessionId = Number(btn.dataset.providerLiveEdit || 0);
      const sess = state.providerLiveSessions.find((row) => Number(row.session_id) === sessionId);
      if (!sess) return;
      fillProviderLiveScheduler(sess);
      providerLiveSchedulerSetVisible(true);
    });
  });
}

async function submitProviderLiveSchedule() {
  const title = String(el.liveClassTitle?.value || "").trim();
  const startIso = toIsoFromLocalDatetime(el.liveClassStartAt?.value || "");
  const endIsoRaw = toIsoFromLocalDatetime(el.liveClassEndAt?.value || "");
  const recurrencePattern = String(el.liveClassRecurrencePattern?.value || "none").trim() || "none";
  const recurrenceCount = Number(el.liveClassRecurrenceCount?.value || 1);
  const recurrenceCustomDays = getLiveCustomDays();
  const timezone = String(el.liveClassTimezone?.value || "Asia/Kolkata").trim() || "Asia/Kolkata";
  const meetingMode = String(el.liveClassMode?.value || "in_app").trim() || "in_app";
  const externalUrl = String(el.liveClassExternalUrl?.value || "").trim();
  const maxParticipants = Number(el.liveClassMaxParticipants?.value || 200);
  const payload = {
    title,
    description: String(el.liveClassDescription?.value || "").trim() || null,
    scheduled_start_at: startIso,
    scheduled_end_at: endIsoRaw || null,
    timezone,
    meeting_mode: meetingMode,
    external_meeting_url: externalUrl || null,
    max_participants: Number.isFinite(maxParticipants) && maxParticipants > 0 ? maxParticipants : 200,
    allow_chat: Boolean(el.liveClassAllowChat?.checked),
    allow_raise_hand: Boolean(el.liveClassAllowRaiseHand?.checked),
    allow_reactions: Boolean(el.liveClassAllowReactions?.checked),
    recurrence_pattern: recurrencePattern,
    recurrence_count: Number.isFinite(recurrenceCount) && recurrenceCount > 0 ? recurrenceCount : 1,
    recurrence_custom_days: recurrenceCustomDays,
  };
  if (!payload.title) throw new Error("Class title is required");
  if (!payload.scheduled_start_at) throw new Error("Scheduled start time is required");
  if (payload.meeting_mode === "external" && !payload.external_meeting_url) {
    throw new Error("External meeting URL is required when mode is external");
  }
  if (state.providerLiveEditSessionId) {
    await api("PATCH", `/provider/workspace/live-classes/${state.providerLiveEditSessionId}`, {
      title: payload.title,
      description: payload.description,
      scheduled_start_at: payload.scheduled_start_at,
      scheduled_end_at: payload.scheduled_end_at,
      timezone: payload.timezone,
      meeting_mode: payload.meeting_mode,
      external_meeting_url: payload.external_meeting_url,
      max_participants: payload.max_participants,
      allow_chat: payload.allow_chat,
      allow_raise_hand: payload.allow_raise_hand,
      allow_reactions: payload.allow_reactions,
      recurrence_pattern: payload.recurrence_pattern,
      recurrence_count: payload.recurrence_count,
      recurrence_custom_days: payload.recurrence_custom_days,
    });
    toast("Live class schedule updated");
  } else {
    const created = await api("POST", "/provider/workspace/live-classes", payload);
    toast(`Live class scheduled (${Number(created?.recurrence_count || 1)} session(s)). Auto course ID: ${Number(created?.course_id || 0)}`);
  }
  resetProviderLiveScheduler();
  providerLiveSchedulerSetVisible(false);
  await refreshProviderLiveClasses();
}

async function refreshStudentLiveClasses() {
  const out = await api("GET", "/student/live-classes");
  const items = out?.items || [];
  state.studentLiveSessions = items;
  const nowMs = Date.now();
  const validReminderKeys = {};
  items.forEach((s) => {
    const reminderAt = s.reminder_at ? new Date(s.reminder_at).getTime() : NaN;
    if (!Number.isFinite(reminderAt)) return;
    const key = `${s.session_id}:${s.reminder_at}`;
    validReminderKeys[key] = true;
    if (state.studentLiveReminderSent[key]) return;
    const delay = reminderAt - nowMs;
    const fireReminder = () => {
      if (state.studentLiveReminderSent[key]) return;
      state.studentLiveReminderSent[key] = true;
      const msg = `Reminder: "${s.title}" starts in 30 minutes.`;
      toast(msg);
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          try { new Notification("Classagon Class Reminder", { body: msg }); } catch {}
        } else if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      }
    };
    if (delay <= 0 && (s.reminder_due || false)) {
      fireReminder();
      return;
    }
    if (delay > 0 && !state.studentLiveReminderTimers[key]) {
      state.studentLiveReminderTimers[key] = setTimeout(fireReminder, delay);
    }
  });
  Object.keys(state.studentLiveReminderTimers).forEach((key) => {
    if (validReminderKeys[key]) return;
    clearTimeout(state.studentLiveReminderTimers[key]);
    delete state.studentLiveReminderTimers[key];
  });
  renderList(
    el.studentLiveClassesList,
    items,
    (s) => {
      const isClosed = s.status === "ended" || s.status === "cancelled";
      const statusClass = s.status === "live" ? "status-open" : (isClosed ? "status-dismissed" : "status-in_review");
      const recurrenceLabel = s.recurrence_pattern && s.recurrence_pattern !== "none"
        ? `${s.recurrence_pattern} x${Number(s.recurrence_count || 1)}`
        : "one-time";
      return `
        <div>
          <div class="row between">
            <strong>${escapeHtmlAttr(s.title || "Live class")}</strong>
            <span class="status-pill ${statusClass}">${escapeHtmlAttr(s.status || "scheduled")}</span>
          </div>
          <div class="meta">Course: ${escapeHtmlAttr(s.course_title || `#${s.course_id}`)} | Participants: ${Number(s.participant_count || 0)}</div>
          <div class="meta">Schedule: ${escapeHtmlAttr(recurrenceLabel)} | Reminder: 30 mins before</div>
          <div class="meta">${formatTime(s.scheduled_start_at)}${s.scheduled_end_at ? ` to ${formatTime(s.scheduled_end_at)}` : ""}</div>
          ${s.description ? `<div style="margin-top:4px;">${escapeHtmlAttr(s.description)}</div>` : ""}
          <div class="actions">
            ${isClosed ? "" : `<button class="btn small" data-student-live-join="${s.session_id}">${s.joined ? "Enter Room" : "Join Class"}</button>`}
            ${s.joined ? `<button class="btn small" data-student-live-leave="${s.session_id}">Leave</button>` : ""}
            ${s.meeting_mode === "external" && s.external_meeting_url ? `<a class="btn small" href="${s.external_meeting_url}" target="_blank" rel="noreferrer">Open Meeting</a>` : ""}
          </div>
        </div>
      `;
    },
    "No live classes for your enrolled courses.",
  );
  document.querySelectorAll("[data-student-live-join]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.studentLiveJoin || 0);
      if (!sessionId) return;
      try {
        const out2 = await api("POST", `/student/live-classes/${sessionId}/join`);
        await openLiveClassroom(sessionId, "student", out2?.room_state || null);
      } catch (err) {
        toast(err?.message || "Failed to join class", "error");
      }
    });
  });
  document.querySelectorAll("[data-student-live-leave]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = Number(btn.dataset.studentLiveLeave || 0);
      if (!sessionId) return;
      try {
        await api("POST", `/student/live-classes/${sessionId}/leave`);
        toast("You left the class");
        await refreshStudentLiveClasses();
      } catch (err) {
        toast(err?.message || "Failed to leave class", "error");
      }
    });
  });
}

function getLiveRoomApiPrefix(role = state.liveRoom.role) {
  return role === "provider" ? "/provider/workspace/live-classes" : "/student/live-classes";
}

function setLiveSignalStatus(connected) {
  state.liveRoom.wsConnected = Boolean(connected);
  if (!el.liveRoomSignalStatus) return;
  el.liveRoomSignalStatus.textContent = connected ? "Realtime: connected" : "Realtime: fallback";
  el.liveRoomSignalStatus.classList.toggle("status-resolved", connected);
  el.liveRoomSignalStatus.classList.toggle("status-in_review", !connected);
}

function setLiveWaitingOverlay(status, flags = {}) {
  state.liveRoom.accessStatus = String(status || "admitted");
  const waiting = state.liveRoom.accessStatus !== "admitted";
  if (!el.liveRoomWaitingOverlay) return;
  el.liveRoomWaitingOverlay.classList.toggle("hidden", !waiting);
  if (!waiting) return;
  let text = "You are waiting for host approval to enter the class.";
  if (state.liveRoom.accessStatus === "blocked" || flags.removed) {
    text = "Host removed you from this class.";
  }
  if (flags.breakout_room) {
    text = `Assigned breakout room: ${String(flags.breakout_room)}`;
  }
  if (el.liveRoomWaitingText) el.liveRoomWaitingText.textContent = text;
}

function ensureLiveParticipantSelectBinding() {
  if (!el.liveRoomParticipantsList) return;
  el.liveRoomParticipantsList.querySelectorAll("[data-live-participant-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const pid = Number(node.getAttribute("data-live-participant-id") || 0);
      state.liveRoom.selectedParticipantId = pid;
      el.liveRoomParticipantsList.querySelectorAll(".item").forEach((n) => n.classList.remove("selected"));
      node.classList.add("selected");
    });
  });
}

async function runHostAction(action, extras = {}) {
  if (state.liveRoom.role !== "provider") return;
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId) return;
  await api("POST", `/provider/workspace/live-classes/${sessionId}/host-action`, {
    action,
    ...extras,
  });
  await refreshLiveRoomState();
  await refreshLiveModerationState();
}

async function refreshLiveModerationState() {
  if (state.liveRoom.role !== "provider") return;
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId) return;
  const out = await api("GET", `/provider/workspace/live-classes/${sessionId}/moderation-state`);
  state.liveRoom.moderation = out || null;
  const waiting = out?.waiting_users || [];
  if (el.liveRoomWaitingToggle) {
    el.liveRoomWaitingToggle.checked = Boolean(out?.waiting_room_enabled ?? true);
  }
  renderList(
    el.liveRoomWaitingList,
    waiting,
    (w) => `
      <div class="row between">
        <span><strong>${escapeHtmlAttr(w.display_name || `User ${w.user_id}`)}</strong> <span class="meta">(${escapeHtmlAttr(w.role || "student")})</span></span>
        <span class="actions">
          <button class="btn small" data-live-admit="${w.user_id}">Admit</button>
          <button class="btn small danger" data-live-reject="${w.user_id}">Reject</button>
        </span>
      </div>
    `,
    "No users in waiting room.",
  );
  document.querySelectorAll("[data-live-admit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = Number(btn.getAttribute("data-live-admit") || 0);
      if (!uid) return;
      runHostAction("admit", { target_user_id: uid }).catch((err) => toast(err?.message || "Admit failed", "error"));
    });
  });
  document.querySelectorAll("[data-live-reject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = Number(btn.getAttribute("data-live-reject") || 0);
      if (!uid) return;
      runHostAction("reject", { target_user_id: uid }).catch((err) => toast(err?.message || "Reject failed", "error"));
    });
  });
}

function setLiveRecordingUi(active) {
  if (el.liveRoomRecordingBadge) el.liveRoomRecordingBadge.classList.toggle("hidden", !active);
  if (el.liveRoomStartRecordingBtn) el.liveRoomStartRecordingBtn.disabled = Boolean(active);
  if (el.liveRoomPauseRecordingBtn) el.liveRoomPauseRecordingBtn.disabled = !active;
  if (el.liveRoomStopRecordingBtn) el.liveRoomStopRecordingBtn.disabled = !active;
  const stateText = String(state.liveRoom.recording?.mediaRecorder?.state || "");
  if (el.liveRoomPauseRecordingBtn) {
    const paused = stateText === "paused";
    el.liveRoomPauseRecordingBtn.classList.toggle("is-active", paused);
    el.liveRoomPauseRecordingBtn.setAttribute("title", paused ? "Resume recording" : "Pause recording");
    el.liveRoomPauseRecordingBtn.setAttribute("aria-label", paused ? "Resume recording" : "Pause recording");
  }
}

async function uploadLiveRecordingChunks(blob, mimeType = "video/webm") {
  if (state.liveRoom.role !== "provider") return;
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId) return;
  const fileName = `live_${sessionId}_${Date.now()}.webm`;
  const initForm = new FormData();
  initForm.append("filename", fileName);
  initForm.append("mime_type", mimeType);
  initForm.append("total_chunks", "0");
  const initRes = await fetch(`/provider/workspace/live-classes/${sessionId}/recordings/init`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await state.auth.currentUser.getIdToken()}` },
    body: initForm,
  });
  if (!initRes.ok) throw new Error("Recording init failed");
  const initData = await initRes.json();
  const uploadId = String(initData.upload_id || "");
  if (!uploadId) throw new Error("Recording upload id missing");
  const chunkSize = 1024 * 1024 * 2;
  const totalChunks = Math.max(1, Math.ceil(blob.size / chunkSize));
  for (let i = 0; i < totalChunks; i += 1) {
    const part = blob.slice(i * chunkSize, Math.min(blob.size, (i + 1) * chunkSize), mimeType);
    const fd = new FormData();
    fd.append("upload_id", uploadId);
    fd.append("index", String(i));
    fd.append("total_chunks", String(totalChunks));
    fd.append("is_last", String(i === totalChunks - 1));
    fd.append("chunk", new File([part], `${uploadId}_${i}.part`, { type: "application/octet-stream" }));
    const res = await fetch(`/provider/workspace/live-classes/${sessionId}/recordings/chunk`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await state.auth.currentUser.getIdToken()}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`Recording chunk ${i + 1}/${totalChunks} failed`);
  }
  const completeFd = new FormData();
  completeFd.append("upload_id", uploadId);
  completeFd.append("filename", fileName);
  completeFd.append("mime_type", mimeType);
  const finalRes = await fetch(`/provider/workspace/live-classes/${sessionId}/recordings/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await state.auth.currentUser.getIdToken()}` },
    body: completeFd,
  });
  if (!finalRes.ok) throw new Error("Recording finalize failed");
  return finalRes.json();
}

async function startLiveRecording() {
  if (state.liveRoom.role !== "provider") throw new Error("Only provider can record");
  const stream = el.liveRoomLocalVideo?.srcObject;
  if (!stream) throw new Error("Start camera before recording");
  const rec = state.liveRoom.recording;
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  rec.chunks = [];
  rec.mimeType = mimeType;
  rec.mediaRecorder = new MediaRecorder(stream, { mimeType });
  rec.mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) rec.chunks.push(e.data);
  };
  rec.mediaRecorder.onpause = () => setLiveRecordingUi(true);
  rec.mediaRecorder.onresume = () => setLiveRecordingUi(true);
  rec.mediaRecorder.start(1000);
  rec.active = true;
  setLiveRecordingUi(true);
}

async function stopLiveRecording() {
  const rec = state.liveRoom.recording;
  if (!rec.mediaRecorder || !rec.active) return;
  if (rec.uploadInFlight) return;
  rec.uploadInFlight = true;
  await new Promise((resolve) => {
    rec.mediaRecorder.onstop = resolve;
    rec.mediaRecorder.stop();
  });
  const blob = new Blob(rec.chunks, { type: rec.mimeType || "video/webm" });
  rec.mediaRecorder = null;
  rec.chunks = [];
  rec.active = false;
  setLiveRecordingUi(false);
  try {
    const out = await uploadLiveRecordingChunks(blob, rec.mimeType || "video/webm");
    toast(`Recording saved${out?.file_url ? "" : " (storage ref only)"}`);
  } finally {
    rec.uploadInFlight = false;
  }
}

function toggleLiveRecordingPause() {
  const rec = state.liveRoom.recording;
  if (!rec?.mediaRecorder || !rec.active) return;
  if (rec.mediaRecorder.state === "recording") rec.mediaRecorder.pause();
  else if (rec.mediaRecorder.state === "paused") rec.mediaRecorder.resume();
  setLiveRecordingUi(true);
}

function normalizeWsBase() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

function liveParticipantLabel(userId) {
  const key = String(Number(userId || 0));
  const row = state.liveRoom.participantMap[key];
  if (!row) return `Participant #${key}`;
  const role = String(row.actor_role || "participant");
  const name = String(row.display_name || `Participant #${key}`);
  return `${name} (${role})`;
}

function liveParticipantInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "U";
  const first = parts[0][0] || "";
  const second = (parts[1] && parts[1][0]) ? parts[1][0] : "";
  return `${first}${second}`.toUpperCase();
}

const LIVE_RTC_CONFIG = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

function liveRtcState() {
  return state.liveRoom.rtc;
}

function currentLiveUserId() {
  return Number(state.context?.id || 0);
}

function livePeerKey(userId) {
  return String(Number(userId || 0));
}

function shouldInitiateLiveOffer(selfUserId, peerUserId) {
  const selfId = Number(selfUserId || 0);
  const peerId = Number(peerUserId || 0);
  if (!selfId || !peerId || selfId === peerId) return false;
  // Deterministic initiator to avoid offer glare.
  return selfId > peerId;
}

function setLiveDrawerState(drawer, open) {
  if (drawer === "tools") state.liveRoom.toolsOpen = Boolean(open);
  if (drawer === "chat") state.liveRoom.chatOpen = Boolean(open);
  if (drawer === "reaction") state.liveRoom.reactionOpen = Boolean(open);
  if (drawer === "participants") state.liveRoom.participantsOpen = Boolean(open);
  if (el.liveRoomToolsPanel) el.liveRoomToolsPanel.classList.toggle("hidden", !state.liveRoom.toolsOpen);
  if (el.liveRoomChatPanel) el.liveRoomChatPanel.classList.toggle("hidden", !state.liveRoom.chatOpen);
  if (el.liveRoomReactionMenu) el.liveRoomReactionMenu.classList.toggle("hidden", !state.liveRoom.reactionOpen);
  if (el.liveRoomParticipantsMenu) el.liveRoomParticipantsMenu.classList.toggle("hidden", !state.liveRoom.participantsOpen);
  if (state.liveRoom.participantsOpen) positionLiveParticipantsMenu();
}

function renderLiveQaList() {
  return liveClassroomUi.renderLiveQaList();
}

function setLiveSidePanel(kind = "", open = true) {
  const next = open ? String(kind || "") : "";
  state.liveRoom.sidePanel = next;
  if (el.liveRoomStageShell) el.liveRoomStageShell.classList.toggle("live-side-open", Boolean(next));
  if (el.liveRoomWhiteboardPanel) el.liveRoomWhiteboardPanel.classList.toggle("hidden", next !== "whiteboard");
  if (el.liveRoomPollComposerPanel) el.liveRoomPollComposerPanel.classList.toggle("hidden", next !== "poll-composer" && next !== "poll");
  if (el.liveRoomBreakoutPanel) el.liveRoomBreakoutPanel.classList.toggle("hidden", next !== "breakout");
  if (el.liveRoomQaPanel) el.liveRoomQaPanel.classList.toggle("hidden", next !== "qa");
}

function clearLiveControlDockIdleTimer() {
  if (state.liveRoom.controlDockIdleTimer) {
    clearTimeout(state.liveRoom.controlDockIdleTimer);
    state.liveRoom.controlDockIdleTimer = null;
  }
}

function setLiveControlDockVisibility(visible) {
  state.liveRoom.controlDockVisible = Boolean(visible);
  if (el.liveRoomControlDock) el.liveRoomControlDock.classList.toggle("is-hidden", !state.liveRoom.controlDockVisible);
  if (el.liveRoomStageTopbar) el.liveRoomStageTopbar.classList.toggle("is-hidden", !state.liveRoom.controlDockVisible);
}

function scheduleLiveControlDockAutoHide() {
  clearLiveControlDockIdleTimer();
  if (!state.liveRoom.active) return;
  state.liveRoom.controlDockIdleTimer = setTimeout(() => {
    if (!state.liveRoom.controlDockPointerInside && !state.liveRoom.topbarPointerInside) setLiveControlDockVisibility(false);
  }, 3000);
}

function pokeLiveControlDock() {
  setLiveControlDockVisibility(true);
  scheduleLiveControlDockAutoHide();
}

function normalizeSharedPanelKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "poll") return "poll";
  if (k === "whiteboard") return "whiteboard";
  if (k === "breakout") return "breakout";
  if (k === "qa") return "qa";
  return "";
}

async function broadcastLiveToolPanel(kind = "", open = true) {
  const panel = normalizeSharedPanelKind(kind);
  await sendLiveSignal("tool_panel", { panel, open: Boolean(open) }).catch(() => {});
}

function setIconButtonLabel(button, icon, label) {
  if (!button) return;
  if (label) {
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
  }
  button.innerHTML = `<span class="ico">${icon}</span><span class="lbl">${escapeHtmlAttr(label)}</span>`;
}

function materialIcon(name, options = {}) {
  const icon = String(name || "").trim() || "circle";
  const filled = Boolean(options.filled);
  const classes = `material-symbols-rounded${filled ? " is-filled" : ""}`;
  return `<span class="${classes}" aria-hidden="true">${icon}</span>`;
}

function setPasswordToggleButtonState(button, reveal) {
  if (!button) return;
  button.innerHTML = materialIcon(reveal ? "visibility_off" : "visibility");
  button.setAttribute("aria-pressed", reveal ? "true" : "false");
  button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  button.setAttribute("title", reveal ? "Hide password" : "Show password");
}

function bindPasswordToggle(input, button) {
  if (!input || !button) return;
  setPasswordToggleButtonState(button, input.type === "text");
  button.addEventListener("click", () => {
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    setPasswordToggleButtonState(button, reveal);
  });
}

function liveUiIcon(name) {
  if (name === "tools") return materialIcon("widgets");
  if (name === "chat") return materialIcon("chat_bubble");
  if (name === "reaction") return materialIcon("celebration");
  if (name === "fullscreen") return materialIcon("fullscreen");
  if (name === "fullscreen-exit") return materialIcon("fullscreen_exit");
  if (name === "camera") return materialIcon("videocam");
  if (name === "camera-off") return materialIcon("videocam_off");
  if (name === "mic") return materialIcon("mic");
  if (name === "mic-off") return materialIcon("mic_off");
  if (name === "screen") return materialIcon("screen_share");
  if (name === "participants") return materialIcon("groups");
  if (name === "leave") return materialIcon("logout");
  if (name === "whiteboard") return materialIcon("draw");
  if (name === "breakout") return materialIcon("hub");
  if (name === "poll") return materialIcon("bar_chart");
  if (name === "qa") return materialIcon("quiz");
  if (name === "stop-share") return materialIcon("stop_screen_share");
  if (name === "record") return materialIcon("fiber_manual_record", { filled: true });
  if (name === "pause") return materialIcon("pause");
  if (name === "stop") return materialIcon("stop");
  if (name === "send") return materialIcon("send");
  return materialIcon("circle");
}

function positionLiveParticipantsMenu() {
  if (!el.liveRoomParticipantsMenu || !el.liveRoomParticipantsBtn || !el.liveRoomStageShell) return;
  const shellRect = el.liveRoomStageShell.getBoundingClientRect();
  const btnRect = el.liveRoomParticipantsBtn.getBoundingClientRect();
  const menu = el.liveRoomParticipantsMenu;
  const width = menu.offsetWidth || 320;
  const preferredLeft = (btnRect.left - shellRect.left) + (btnRect.width / 2) - (width / 2);
  const left = Math.max(8, Math.min(preferredLeft, el.liveRoomStageShell.clientWidth - width - 8));
  const bottom = Math.max(70, (shellRect.bottom - btnRect.top) + 8);
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
  menu.style.bottom = `${bottom}px`;
  menu.style.transform = "none";
}

function initializeLiveIconButtons() {
  return liveClassroomUi.initializeLiveIconButtons();
}

function refreshLiveFullscreenButton() {
  if (!el.liveRoomFullscreenBtn) return;
  const target = el.liveRoomStageShell || el.liveClassroomScreen;
  const isFs = Boolean(target && document.fullscreenElement === target);
  setIconButtonLabel(el.liveRoomFullscreenBtn, liveUiIcon(isFs ? "fullscreen-exit" : "fullscreen"), isFs ? "Exit Fullscreen" : "Fullscreen");
}

function refreshLiveLeaveButton() {
  if (!el.leaveLiveRoomBtn) return;
  const isProvider = state.liveRoom.role === "provider";
  const label = isProvider ? "End Class" : "Leave";
  setIconButtonLabel(el.leaveLiveRoomBtn, liveUiIcon("leave"), label);
  el.leaveLiveRoomBtn.classList.add("live-topbar-danger");
}

function setVideoElementStream(videoEl, stream, options = {}) {
  if (!videoEl) return;
  const mirror = Boolean(options.mirror);
  // Meet-style rendering: mirror only local self-view; keep sent/remote feeds unmirrored.
  videoEl.style.transform = mirror ? "scaleX(-1)" : "scaleX(1)";
  videoEl.style.webkitTransform = mirror ? "scaleX(-1)" : "scaleX(1)";
  videoEl.style.transformOrigin = "center center";
  videoEl.style.backfaceVisibility = "hidden";
  videoEl.style.objectFit = "cover";
  videoEl.style.objectPosition = "center center";
  videoEl.playsInline = true;
  if (Object.prototype.hasOwnProperty.call(options, "muted")) {
    videoEl.muted = Boolean(options.muted);
  }
  const nextStream = stream || null;
  if (videoEl.srcObject !== nextStream) {
    videoEl.srcObject = nextStream;
  }
}

function preferredCameraVideoConstraints() {
  return {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    aspectRatio: { ideal: 1.7777777778 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: "user",
    resizeMode: "crop-and-scale",
  };
}

function preferredCameraAudioConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

async function requestCameraStream() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Camera is unavailable in this browser/environment.");
  }
  const attempts = [
    { video: preferredCameraVideoConstraints(), audio: preferredCameraAudioConstraints() },
    { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: preferredCameraAudioConstraints() },
    { video: { facingMode: "user" }, audio: preferredCameraAudioConstraints() },
    { video: true, audio: preferredCameraAudioConstraints() },
    { video: true, audio: true },
  ];
  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Unable to access camera and microphone.");
}

async function tuneCapturedVideoTrack(videoTrack) {
  if (!videoTrack) return;
  try {
    videoTrack.contentHint = "detail";
  } catch {}
  try {
    await videoTrack.applyConstraints(preferredCameraVideoConstraints());
  } catch {}
  try {
    const caps = videoTrack.getCapabilities?.() || {};
    const advanced = [];
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" });
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.push({ exposureMode: "continuous" });
    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
    if (advanced.length) await videoTrack.applyConstraints({ advanced });
  } catch {}
}

function tuneVideoSenderQuality(sender) {
  if (!sender || sender.track?.kind !== "video") return;
  try {
    if (typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") return;
    const params = sender.getParameters() || {};
    const encodings = Array.isArray(params.encodings) && params.encodings.length ? params.encodings : [{}];
    params.encodings = encodings.map((encoding) => ({
      ...encoding,
      maxBitrate: Math.max(Number(encoding.maxBitrate || 0), 2500000),
      maxFramerate: Math.min(30, Number(encoding.maxFramerate || 30)),
      scaleResolutionDownBy: 1,
      priority: encoding.priority || "high",
    }));
    params.degradationPreference = "maintain-resolution";
    sender.setParameters(params).catch(() => {});
  } catch {}
}

function refreshLiveControlButtonStates() {
  const rtc = liveRtcState();
  const camOn = Boolean(rtc.localStream?.getVideoTracks?.().some((t) => t.readyState === "live" && t.enabled));
  const screenOn = Boolean(rtc.screenStream?.getVideoTracks?.().some((t) => t.readyState === "live"));
  const participantCount = Object.keys(state.liveRoom.participantMap || {}).length;
  if (el.liveRoomVideoStartBtn) {
    el.liveRoomVideoStartBtn.classList.toggle("is-active", camOn);
    el.liveRoomVideoStartBtn.classList.toggle("is-muted", !camOn);
    setIconButtonLabel(el.liveRoomVideoStartBtn, liveUiIcon(camOn ? "camera" : "camera-off"), camOn ? "Camera On" : "Camera Off");
  }
  if (el.liveRoomShareScreenBtn) {
    el.liveRoomShareScreenBtn.disabled = Boolean(state.liveRoom.screenShareInFlight);
    el.liveRoomShareScreenBtn.classList.toggle("is-active", screenOn);
    setIconButtonLabel(el.liveRoomShareScreenBtn, liveUiIcon("screen"), screenOn ? "Sharing" : "Share");
  }
  if (el.liveRoomStopShareOverlayBtn) el.liveRoomStopShareOverlayBtn.classList.toggle("hidden", !screenOn);
  if (el.liveRoomParticipantsCountBadge) el.liveRoomParticipantsCountBadge.textContent = String(participantCount);
  if (el.liveRoomParticipantsCountText) el.liveRoomParticipantsCountText.textContent = `${participantCount} online`;
  if (state.liveRoom.participantsOpen) positionLiveParticipantsMenu();
}

function streamHasActiveVideo(stream) {
  return Boolean(stream?.getVideoTracks?.().some((t) => t.readyState === "live" && t.enabled !== false));
}

function toggleLiveDrawer(drawer) {
  const nextOpen = drawer === "tools"
    ? !state.liveRoom.toolsOpen
    : drawer === "chat"
      ? !state.liveRoom.chatOpen
      : drawer === "reaction"
        ? !state.liveRoom.reactionOpen
        : !state.liveRoom.participantsOpen;
  setLiveDrawerState("tools", false);
  setLiveDrawerState("chat", false);
  setLiveDrawerState("reaction", false);
  setLiveDrawerState("participants", false);
  if (nextOpen) setLiveDrawerState(drawer, true);
}

function streamForPeer(peerId) {
  return liveRtcState().remoteStreams[livePeerKey(peerId)] || null;
}

function pickProviderPeerId() {
  const entries = Object.values(state.liveRoom.participantMap || {});
  const provider = entries.find((p) => String(p.actor_role || "").toLowerCase() === "provider" && Number(p.user_id || 0) !== currentLiveUserId());
  return provider ? String(Number(provider.user_id || 0)) : "";
}

function pickLastJoinedRemotePeerId() {
  const entries = Object.values(state.liveRoom.participantMap || {})
    .filter((p) => Number(p.user_id || 0) !== currentLiveUserId() && streamForPeer(p.user_id))
    .sort((a, b) => {
      const ta = new Date(a.joined_at || 0).getTime();
      const tb = new Date(b.joined_at || 0).getTime();
      return tb - ta;
    });
  return entries.length ? String(Number(entries[0].user_id || 0)) : "";
}

function updateLiveStageAndFocusVideo() {
  return liveClassroomUi.updateLiveStageAndFocusVideo();
}

function setupLiveAudioAnalyzer(peerUserId, stream) {
  const rtc = liveRtcState();
  const key = livePeerKey(peerUserId);
  if (!stream) return;
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) return;
  if (rtc.peerAudioContexts[key]) return;
  try {
    const ac = new AudioContext();
    const source = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    rtc.peerAudioContexts[key] = { ac, analyser };
  } catch {}
}

function teardownLiveAudioAnalyzer(peerUserId) {
  const rtc = liveRtcState();
  const key = livePeerKey(peerUserId);
  const ref = rtc.peerAudioContexts[key];
  if (!ref) return;
  try { ref.ac.close(); } catch {}
  delete rtc.peerAudioContexts[key];
  delete state.liveRoom.speakerScores[key];
}

function computeAnalyserLevel(analyser) {
  const arr = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const d = (arr[i] - 128) / 128;
    sum += d * d;
  }
  return Math.sqrt(sum / arr.length);
}

function startLiveSpeakerMonitor() {
  if (state.liveRoom.speakerMonitorId) return;
  state.liveRoom.speakerMonitorId = setInterval(() => {
    const rtc = liveRtcState();
    let bestPeer = "";
    let bestScore = 0.02;
    Object.entries(rtc.peerAudioContexts || {}).forEach(([key, ref]) => {
      if (!ref?.analyser) return;
      const level = computeAnalyserLevel(ref.analyser);
      const smooth = (state.liveRoom.speakerScores[key] || 0) * 0.65 + level * 0.35;
      state.liveRoom.speakerScores[key] = smooth;
      if (smooth > bestScore) {
        bestScore = smooth;
        bestPeer = key;
      }
    });
    if (bestPeer) state.liveRoom.focusPeerId = bestPeer;
    else if (!state.liveRoom.focusPeerId) state.liveRoom.focusPeerId = pickLastJoinedRemotePeerId();
    updateLiveStageAndFocusVideo();
  }, 700);
}

function stopLiveSpeakerMonitor() {
  if (state.liveRoom.speakerMonitorId) {
    clearInterval(state.liveRoom.speakerMonitorId);
    state.liveRoom.speakerMonitorId = null;
  }
}

function renderLiveRemoteVideos() {
  return liveClassroomUi.renderLiveRemoteVideos();
}

function attachLocalVideoPreview() {
  if (!el.liveRoomLocalVideo) return;
  setVideoElementStream(el.liveRoomLocalVideo, liveRtcState().localStream, { muted: true, mirror: false });
  el.liveRoomLocalVideo.classList.toggle("live-video-muted", Boolean(liveRtcState().micMuted));
  updateLiveStageAndFocusVideo();
}

function replaceLiveOutboundVideoTrack(newVideoTrack) {
  const rtc = liveRtcState();
  rtc.outboundVideoTrack = newVideoTrack || null;
  Object.values(rtc.peers || {}).forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && newVideoTrack) {
      sender.replaceTrack(newVideoTrack)
        .then(() => {
          tuneVideoSenderQuality(sender);
        })
        .catch(() => {});
    }
  });
}

function attachTracksToPeer(pc) {
  const rtc = liveRtcState();
  const stream = rtc.localStream;
  if (stream) {
    stream.getTracks().forEach((track) => {
      const hasSender = pc.getSenders().some((s) => s.track && s.track.id === track.id);
      if (!hasSender) {
        const sender = pc.addTrack(track, stream);
        tuneVideoSenderQuality(sender);
      }
    });
  } else {
    const hasVideo = pc.getTransceivers().some((t) => t.receiver?.track?.kind === "video");
    const hasAudio = pc.getTransceivers().some((t) => t.receiver?.track?.kind === "audio");
    if (!hasVideo) pc.addTransceiver("video", { direction: "recvonly" });
    if (!hasAudio) pc.addTransceiver("audio", { direction: "recvonly" });
  }
}

function closeLiveSignalSocket() {
  if (state.liveRoom.wsPingId) {
    clearInterval(state.liveRoom.wsPingId);
    state.liveRoom.wsPingId = null;
  }
  if (state.liveRoom.wsReconnectId) {
    clearTimeout(state.liveRoom.wsReconnectId);
    state.liveRoom.wsReconnectId = null;
  }
  const ws = state.liveRoom.ws;
  state.liveRoom.ws = null;
  if (ws) {
    try { ws.close(); } catch {}
  }
  setLiveSignalStatus(false);
}

async function openLiveSignalSocket() {
  closeLiveSignalSocket();
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId || !state.auth?.currentUser) return;
  const token = await state.auth.currentUser.getIdToken().catch(() => "");
  if (!token) return;
  const url = `${normalizeWsBase()}/ws/live/${sessionId}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  state.liveRoom.ws = ws;
  ws.onopen = () => {
    if (state.liveRoom.ws !== ws) return;
    setLiveSignalStatus(true);
    state.liveRoom.wsPingId = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {}
    }, 15000);
    sendLiveSignal("presence", { media: "camera" }).catch(() => {});
  };
  ws.onclose = () => {
    if (state.liveRoom.ws !== ws) return;
    closeLiveSignalSocket();
    if (!state.liveRoom.active || !state.liveRoom.sessionId) return;
    state.liveRoom.wsReconnectId = setTimeout(() => {
      openLiveSignalSocket().catch(() => {});
    }, 1800);
  };
  ws.onerror = () => {
    setLiveSignalStatus(false);
  };
  ws.onmessage = (event) => {
    let msg = null;
    try {
      msg = JSON.parse(String(event.data || "{}"));
    } catch {
      return;
    }
    const type = String(msg?.type || "").toLowerCase();
    if (type === "signal") {
      handleLiveSignalEnvelope(msg).catch(() => {});
      return;
    }
    if (type === "presence") {
      refreshLiveRoomState().catch(() => {});
      if (state.liveRoom.role === "provider") refreshLiveModerationState().catch(() => {});
      return;
    }
    if (type === "room_access") {
      setLiveWaitingOverlay(msg?.status || "admitted", msg?.flags || {});
      refreshLiveRoomState().catch(() => {});
      return;
    }
    if (type === "room_flags") {
      const flags = msg?.flags || {};
      setLiveWaitingOverlay(state.liveRoom.accessStatus || "admitted", flags);
      setLiveHostMuted(Boolean(flags.muted));
      return;
    }
    if (type === "moderation" && state.liveRoom.role === "provider") {
      state.liveRoom.moderation = msg?.state || null;
      refreshLiveModerationState().catch(() => {});
    }
  };
}

async function sendLiveSignal(kind, data = {}, toUserId = null) {
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId) return;
  const ws = state.liveRoom.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: "signal",
        kind,
        to_user_id: toUserId ? Number(toUserId) : null,
        payload: data || {},
      }));
      return;
    } catch {}
  }
  const fromUserId = currentLiveUserId();
  if (!fromUserId) return;
  const prefix = getLiveRoomApiPrefix();
  await api("POST", `${prefix}/${sessionId}/messages`, {
    message_type: "signal",
    content: kind,
    payload: {
      kind,
      from_user_id: fromUserId,
      to_user_id: toUserId ? Number(toUserId) : null,
      ...data,
    },
  });
}

function closeLivePeerConnection(peerUserId) {
  const rtc = liveRtcState();
  const key = livePeerKey(peerUserId);
  const pc = rtc.peers[key];
  if (pc) {
    try { pc.onicecandidate = null; } catch {}
    try { pc.ontrack = null; } catch {}
    try { pc.close(); } catch {}
  }
  delete rtc.peers[key];
  delete rtc.remoteStreams[key];
  teardownLiveAudioAnalyzer(peerUserId);
  if (state.liveRoom.focusPeerId === key) state.liveRoom.focusPeerId = pickLastJoinedRemotePeerId();
  renderLiveRemoteVideos();
}

function createLivePeerConnection(peerUserId) {
  const rtc = liveRtcState();
  const key = livePeerKey(peerUserId);
  if (rtc.peers[key]) return rtc.peers[key];
  const pc = new RTCPeerConnection(LIVE_RTC_CONFIG);
  rtc.peers[key] = pc;
  attachTracksToPeer(pc);
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const candidate = typeof event.candidate.toJSON === "function" ? event.candidate.toJSON() : event.candidate;
    sendLiveSignal("ice", { candidate }, Number(peerUserId)).catch(() => {});
  };
  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (!stream) return;
    rtc.remoteStreams[key] = stream;
    setupLiveAudioAnalyzer(peerUserId, stream);
    if (!state.liveRoom.focusPeerId) state.liveRoom.focusPeerId = key;
    renderLiveRemoteVideos();
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      closeLivePeerConnection(peerUserId);
    }
  };
  return pc;
}

async function ensureLiveCameraStream() {
  const rtc = liveRtcState();
  const activeTrack = rtc.cameraStream?.getTracks?.().find((t) => t.readyState === "live");
  if (activeTrack) return rtc.cameraStream;
  rtc.cameraStream = await requestCameraStream();
  await tuneCapturedVideoTrack(rtc.cameraStream?.getVideoTracks?.()[0]);
  return rtc.cameraStream;
}

async function startLiveCamera() {
  const rtc = liveRtcState();
  const cameraStream = await ensureLiveCameraStream();
  if (!rtc.localStream) rtc.localStream = new MediaStream();
  rtc.localStream.getTracks().forEach((t) => t.stop());
  rtc.localStream = new MediaStream(cameraStream.getTracks());
  const videoTrack = rtc.localStream.getVideoTracks()[0] || null;
  replaceLiveOutboundVideoTrack(videoTrack);
  setLiveMicMuted(Boolean(rtc.micMuted));
  attachLocalVideoPreview();
  refreshLiveControlButtonStates();
  await sendLiveSignal("presence", { media: "camera" }).catch(() => {});
  await syncLiveRtcPeersFromRoom().catch(() => {});
  await renegotiateAllLivePeers().catch(() => {});
}

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => {
    try { t.stop(); } catch {}
  });
}

async function stopLiveCamera() {
  const rtc = liveRtcState();
  await sendLiveSignal("leave", {}).catch(() => {});
  stopTracks(rtc.screenStream);
  stopTracks(rtc.cameraStream);
  stopTracks(rtc.localStream);
  rtc.screenStream = null;
  rtc.cameraStream = null;
  rtc.localStream = null;
  rtc.outboundVideoTrack = null;
  Object.keys(rtc.peers || {}).forEach((peerId) => closeLivePeerConnection(Number(peerId)));
  attachLocalVideoPreview();
  refreshLiveControlButtonStates();
}

function setLiveMicMuted(muted) {
  const rtc = liveRtcState();
  rtc.micMuted = Boolean(muted);
  const streams = [rtc.localStream, rtc.cameraStream].filter(Boolean);
  streams.forEach((stream) => {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !rtc.micMuted;
    });
  });
  if (el.liveRoomToggleMicBtn) {
    setIconButtonLabel(el.liveRoomToggleMicBtn, liveUiIcon(rtc.micMuted ? "mic-off" : "mic"), rtc.micMuted ? "Unmute" : "Mic");
    el.liveRoomToggleMicBtn.classList.toggle("is-muted", Boolean(rtc.micMuted));
    el.liveRoomToggleMicBtn.classList.toggle("is-active", !rtc.micMuted);
  }
  attachLocalVideoPreview();
}

function setLiveHostMuted(muted) {
  state.liveRoom.hostMuted = Boolean(muted);
  if (state.liveRoom.hostMuted) setLiveMicMuted(true);
  if (el.liveRoomToggleMicBtn) {
    el.liveRoomToggleMicBtn.disabled = state.liveRoom.hostMuted;
    if (state.liveRoom.hostMuted) {
      setIconButtonLabel(el.liveRoomToggleMicBtn, liveUiIcon("mic-off"), "Host Muted");
      el.liveRoomToggleMicBtn.classList.add("is-muted");
      el.liveRoomToggleMicBtn.classList.remove("is-active");
    } else {
      setLiveMicMuted(liveRtcState().micMuted);
    }
  }
}

async function toggleLiveMic() {
  const rtc = liveRtcState();
  if (!rtc.localStream) await startLiveCamera();
  setLiveMicMuted(!rtc.micMuted);
}

async function startLiveScreenShare() {
  if (state.liveRoom.screenShareInFlight) return false;
  const rtc = liveRtcState();
  if (rtc.screenStream?.getVideoTracks?.().some((t) => t.readyState === "live")) return false;
  const fullscreenTarget = el.liveRoomStageShell || el.liveClassroomScreen;
  const shouldRestoreFullscreen = Boolean(fullscreenTarget && document.fullscreenElement === fullscreenTarget);
  state.liveRoom.screenShareInFlight = true;
  if (el.liveRoomShareScreenBtn) {
    el.liveRoomShareScreenBtn.disabled = true;
    setIconButtonLabel(el.liveRoomShareScreenBtn, liveUiIcon("screen"), "Starting...");
  }
  try {
    if (!rtc.cameraStream) await ensureLiveCameraStream();
    rtc.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = rtc.screenStream.getVideoTracks()[0];
    if (!screenTrack) throw new Error("Unable to start screen share");
    if (!rtc.localStream) rtc.localStream = new MediaStream(rtc.cameraStream.getTracks());
    const oldVideo = rtc.localStream.getVideoTracks()[0];
    if (oldVideo) rtc.localStream.removeTrack(oldVideo);
    rtc.localStream.addTrack(screenTrack);
    replaceLiveOutboundVideoTrack(screenTrack);
    attachLocalVideoPreview();
    refreshLiveControlButtonStates();
    screenTrack.onended = () => {
      stopLiveScreenShare().catch(() => {});
    };
    await sendLiveSignal("presence", { media: "screen" }).catch(() => {});
    await renegotiateAllLivePeers().catch(() => {});
    if (shouldRestoreFullscreen && !document.fullscreenElement) {
      await fullscreenTarget?.requestFullscreen?.().catch(() => {});
    }
    return true;
  } finally {
    state.liveRoom.screenShareInFlight = false;
    if (el.liveRoomShareScreenBtn) el.liveRoomShareScreenBtn.disabled = false;
    refreshLiveControlButtonStates();
  }
}

async function stopLiveScreenShare() {
  const rtc = liveRtcState();
  if (!rtc.screenStream && !state.liveRoom.screenShareInFlight) return;
  stopTracks(rtc.screenStream);
  rtc.screenStream = null;
  if (!rtc.cameraStream) await ensureLiveCameraStream();
  if (!rtc.localStream) rtc.localStream = new MediaStream();
  const existingVideo = rtc.localStream.getVideoTracks()[0];
  if (existingVideo) rtc.localStream.removeTrack(existingVideo);
  const cameraVideo = rtc.cameraStream.getVideoTracks()[0];
  if (cameraVideo) rtc.localStream.addTrack(cameraVideo);
  replaceLiveOutboundVideoTrack(cameraVideo || null);
  attachLocalVideoPreview();
  refreshLiveControlButtonStates();
  await sendLiveSignal("presence", { media: "camera" }).catch(() => {});
  await renegotiateAllLivePeers().catch(() => {});
}

async function sendLiveOfferToPeer(peerUserId) {
  const selfId = currentLiveUserId();
  if (!shouldInitiateLiveOffer(selfId, peerUserId)) return;
  const pc = createLivePeerConnection(peerUserId);
  attachTracksToPeer(pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendLiveSignal("offer", { sdp: offer.sdp, sdp_type: offer.type }, peerUserId);
}

async function renegotiateLivePeer(peerUserId) {
  const pc = createLivePeerConnection(peerUserId);
  attachTracksToPeer(pc);
  if (pc.signalingState !== "stable") return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendLiveSignal("offer", { sdp: offer.sdp, sdp_type: offer.type }, peerUserId);
}

async function renegotiateAllLivePeers() {
  const keys = Object.keys(liveRtcState().peers || {});
  await Promise.all(keys.map((key) => renegotiateLivePeer(Number(key)).catch(() => {})));
}

function liveSignalSeen(rtc, signalId, signalKey) {
  if (signalId && rtc.signalSeenIds[signalId]) return true;
  if (signalKey && rtc.signalSeenKeys[signalKey]) return true;
  if (signalId) rtc.signalSeenIds[signalId] = true;
  if (signalKey) rtc.signalSeenKeys[signalKey] = true;
  return false;
}

async function handleLiveSignalCore(input) {
  const rtc = liveRtcState();
  const signalId = String(input?.id || "").trim();
  const kind = String(input?.kind || "").trim().toLowerCase();
  const toUserId = Number(input?.to_user_id || 0);
  const fromUserId = Number(input?.from_user_id || 0);
  const signalKey = `${kind}:${fromUserId}:${toUserId}:${String(input?.ts || "")}`;
  if (liveSignalSeen(rtc, signalId, signalKey)) return;
  if (!kind) return;
  const payload = input?.payload || {};
  const selfId = currentLiveUserId();
  if (!fromUserId || fromUserId === selfId) return;
  if (toUserId && toUserId !== selfId) return;
  const createdAtMs = Number(input?.ts || 0) || (input?.created_at ? new Date(input.created_at).getTime() : Date.now());
  if (Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) > 90000) return;

  if (kind === "tool_panel") {
    const panel = normalizeSharedPanelKind(payload.panel);
    const open = Boolean(payload.open);
    state.liveRoom.sharedPanel = open ? panel : "";
    if (open && panel) setLiveSidePanel(panel, true);
    else if (!open && state.liveRoom.sharedPanel === "") setLiveSidePanel("", false);
    return;
  }
  if (kind === "qa_add") {
    const text = String(payload.text || "").trim();
    if (!text) return;
    state.liveRoom.qaItems.push({
      text,
      author: String(payload.author || "Participant"),
      ts: Date.now(),
    });
    renderLiveQaList();
    return;
  }

  if (kind === "offer") {
    const pc = createLivePeerConnection(fromUserId);
    if (pc.signalingState === "have-local-offer") {
      const selfId = currentLiveUserId();
      const keepLocalOffer = Number(selfId || 0) > Number(fromUserId || 0);
      if (keepLocalOffer) return;
      await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
    }
    await pc.setRemoteDescription({ type: "offer", sdp: String(payload.sdp || "") });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendLiveSignal("answer", { sdp: answer.sdp, sdp_type: answer.type }, fromUserId);
    return;
  }
  if (kind === "answer") {
    const pc = createLivePeerConnection(fromUserId);
    if (pc.signalingState !== "have-local-offer") return;
    await pc.setRemoteDescription({ type: "answer", sdp: String(payload.sdp || "") });
    return;
  }
  if (kind === "ice" && payload.candidate) {
    const pc = createLivePeerConnection(fromUserId);
    await pc.addIceCandidate(payload.candidate).catch(() => {});
    return;
  }
  if (kind === "presence") {
    await sendLiveOfferToPeer(fromUserId).catch(() => {});
    return;
  }
  if (kind === "leave") {
    closeLivePeerConnection(fromUserId);
  }
}

async function handleLiveSignalEnvelope(msg) {
  await handleLiveSignalCore({
    id: msg?.id,
    kind: msg?.kind,
    from_user_id: msg?.from_user_id,
    to_user_id: msg?.to_user_id,
    payload: msg?.payload || {},
    ts: msg?.ts || Date.now(),
  });
}

async function handleLiveSignalMessage(item) {
  const payload = item?.payload || {};
  await handleLiveSignalCore({
    id: item?.id,
    kind: String(payload.kind || item?.content || "").trim().toLowerCase(),
    from_user_id: payload.from_user_id,
    to_user_id: payload.to_user_id,
    payload,
    ts: item?.created_at ? new Date(item.created_at).getTime() : Date.now(),
    created_at: item?.created_at,
  });
}

async function syncLiveRtcPeersFromRoom(room = null) {
  const currentRoom = room || state.liveRoom.lastRoomState || null;
  if (!currentRoom) return;
  const selfId = currentLiveUserId();
  const participantIds = (currentRoom.participants || [])
    .map((p) => Number(p.user_id || 0))
    .filter((id) => id && id !== selfId);
  const activeSet = new Set(participantIds.map((id) => livePeerKey(id)));
  Object.keys(liveRtcState().peers || {}).forEach((key) => {
    if (!activeSet.has(key)) closeLivePeerConnection(Number(key));
  });
  await Promise.all(participantIds.map((peerId) => sendLiveOfferToPeer(peerId).catch(() => {})));
}

function stopLiveRoomPolling() {
  if (state.liveRoom.pollerId) {
    clearInterval(state.liveRoom.pollerId);
    state.liveRoom.pollerId = null;
  }
}

function clearLiveRoomState() {
  clearLiveControlDockIdleTimer();
  state.liveRoom.controlDockPointerInside = false;
  state.liveRoom.topbarPointerInside = false;
  state.liveRoom.controlDockVisible = true;
  closeLiveSignalSocket();
  try { stopLiveRecording().catch(() => {}); } catch {}
  stopLiveSpeakerMonitor();
  stopLiveRoomPolling();
  if (state.liveRoom.classTimerId) {
    clearInterval(state.liveRoom.classTimerId);
    state.liveRoom.classTimerId = null;
  }
  state.liveRoom.classTimerStartedAt = 0;
  state.liveRoom.active = false;
  state.liveRoom.sessionId = null;
  state.liveRoom.role = null;
  state.liveRoom.lastMessageId = 0;
  state.liveRoom.lastRoomState = null;
  state.liveRoom.participantMap = {};
  state.liveRoom.moderation = null;
  state.liveRoom.selectedParticipantId = 0;
  state.liveRoom.accessStatus = "admitted";
  state.liveRoom.hostMuted = false;
  state.liveRoom.stagePeerId = "";
  state.liveRoom.focusPeerId = "";
  state.liveRoom.speakerScores = {};
  state.liveRoom.toolsOpen = false;
  state.liveRoom.chatOpen = false;
  state.liveRoom.reactionOpen = false;
  state.liveRoom.participantsOpen = false;
  state.liveRoom.sidePanel = "";
  state.liveRoom.sharedPanel = "";
  state.liveRoom.qaItems = [];
  state.liveRoom.boardServerText = "";
  state.liveRoom.boardDraftDirty = false;
  state.liveRoom.controlDockPointerInside = false;
  state.liveRoom.topbarPointerInside = false;
  state.liveRoom.controlDockVisible = true;
  state.liveRoom.reactionBurstRecent = {};
  state.liveRoom.screenShareInFlight = false;
  state.liveRoom.recording = {
    mediaRecorder: null,
    chunks: [],
    mimeType: "video/webm",
    active: false,
    uploadInFlight: false,
  };
  const rtc = liveRtcState();
  stopTracks(rtc.screenStream);
  stopTracks(rtc.cameraStream);
  stopTracks(rtc.localStream);
  Object.keys(rtc.peers || {}).forEach((peerId) => closeLivePeerConnection(Number(peerId)));
  Object.keys(rtc.peerAudioContexts || {}).forEach((peerId) => teardownLiveAudioAnalyzer(Number(peerId)));
  rtc.peers = {};
  rtc.remoteStreams = {};
  rtc.signalSeenIds = {};
  rtc.signalSeenKeys = {};
  rtc.localStream = null;
  rtc.cameraStream = null;
  rtc.screenStream = null;
  rtc.outboundVideoTrack = null;
  rtc.micMuted = false;
  rtc.peerAudioContexts = {};
  if (el.liveRoomChatList) el.liveRoomChatList.innerHTML = "";
  if (el.liveRoomParticipantsList) el.liveRoomParticipantsList.innerHTML = "";
  if (el.liveRoomHandsList) el.liveRoomHandsList.innerHTML = "";
  if (el.liveRoomRemoteVideoGrid) el.liveRoomRemoteVideoGrid.innerHTML = "";
  if (el.liveRoomStageVideo) el.liveRoomStageVideo.srcObject = null;
  if (el.liveRoomStagePlaceholder) el.liveRoomStagePlaceholder.classList.remove("hidden");
  if (el.liveRoomFocusVideo) el.liveRoomFocusVideo.srcObject = null;
  if (el.liveRoomFocusTile) el.liveRoomFocusTile.classList.add("hidden");
  attachLocalVideoPreview();
  setLiveRecordingUi(false);
  setLiveWaitingOverlay("admitted", {});
  setLiveDrawerState("tools", false);
  setLiveDrawerState("chat", false);
  setLiveDrawerState("reaction", false);
  refreshLiveControlButtonStates();
  if (el.liveRoomTimerText) el.liveRoomTimerText.textContent = "Timer: 00:00";
  if (el.liveRoomPollPanel) {
    el.liveRoomPollPanel.classList.add("hidden");
    el.liveRoomPollPanel.innerHTML = "";
  }
  setLiveControlDockVisibility(true);
  setLiveSidePanel("", false);
  renderLiveQaList();
  refreshLiveLeaveButton();
}

function liveRoomMessageRow(item) {
  const typeRaw = String(item.message_type || "").toLowerCase();
  if (typeRaw === "reaction") {
    const emoji = escapeHtmlAttr(String(item.content || "").trim() || "\u{1F44D}");
    return `<div class="live-chat-reaction-item">${emoji}</div>`;
  }
  const who = escapeHtmlAttr(item.actor_name || item.actor_role || "User");
  const kind = escapeHtmlAttr(item.message_type || "chat");
  const content = escapeHtmlAttr(item.content || "");
  return `
    <div>
      <div class="row between">
        <strong>${who}</strong>
        <span class="meta">${kind}</span>
      </div>
      <div style="margin-top:4px;">${content}</div>
      <div class="meta">${formatTime(item.created_at)}</div>
    </div>
  `;
}

function burstLiveReactionOnStage(emoji, dedupeKey = "") {
  const layer = el.liveRoomReactionBurstLayer;
  const glyph = String(emoji || "").trim();
  if (!layer || !glyph) return;
  const now = Date.now();
  const key = String(dedupeKey || `glyph:${glyph}`);
  const lastAt = Number(state.liveRoom.reactionBurstRecent[key] || 0);
  if (now - lastAt < 220) return;
  state.liveRoom.reactionBurstRecent[key] = now;
  const node = document.createElement("span");
  node.className = "live-reaction-burst";
  node.textContent = glyph;
  const offset = Math.round((Math.random() * 54) - 27);
  const duration = 900 + Math.round(Math.random() * 350);
  node.style.setProperty("--rx", `${offset}px`);
  node.style.setProperty("--dur", `${duration}ms`);
  layer.appendChild(node);
  setTimeout(() => {
    try { node.remove(); } catch {}
  }, duration + 120);
}

function appendLiveRoomMessages(items) {
  if (!el.liveRoomChatList || !Array.isArray(items) || !items.length) return;
  const maxId = Math.max(...items.map((row) => Number(row.id || 0)));
  state.liveRoom.lastMessageId = Math.max(state.liveRoom.lastMessageId, maxId);
  const visibleItems = [];
  items.forEach((row) => {
    if (String(row?.message_type || "").toLowerCase() === "signal") {
      handleLiveSignalMessage(row).catch(() => {});
      return;
    }
    if (String(row?.message_type || "").toLowerCase() === "reaction") {
      burstLiveReactionOnStage(String(row?.content || ""), `msg:${Number(row?.id || 0)}`);
    }
    visibleItems.push(row);
  });
  if (!visibleItems.length) return;
  const nearBottom = (el.liveRoomChatList.scrollHeight - el.liveRoomChatList.scrollTop - el.liveRoomChatList.clientHeight) < 30;
  const html = visibleItems.map((row) => `<div class="item">${liveRoomMessageRow(row)}</div>`).join("");
  el.liveRoomChatList.insertAdjacentHTML("beforeend", html);
  if (nearBottom) el.liveRoomChatList.scrollTop = el.liveRoomChatList.scrollHeight;
}

function renderLiveRoomParticipants(room) {
  return liveClassroomUi.renderLiveRoomParticipants(room);
}

function renderLivePollPanel(room) {
  if (!el.liveRoomPollPanel) return;
  const session = room?.session || {};
  const poll = session.active_poll || {};
  const options = Array.isArray(poll.options) ? poll.options : [];
  if (!poll.key || !options.length) {
    el.liveRoomPollPanel.classList.add("hidden");
    el.liveRoomPollPanel.innerHTML = "";
    if (state.liveRoom.sidePanel === "poll") setLiveSidePanel("", false);
    return;
  }
  const canVote = state.liveRoom.role === "student" && Boolean(poll.is_open);
  const totalVotes = Number(poll.total_votes || 0);
  const votes = Array.isArray(poll.votes) ? poll.votes : [];
  const myVote = (poll.my_vote === null || poll.my_vote === undefined) ? null : Number(poll.my_vote);
  el.liveRoomPollPanel.classList.remove("hidden");
  el.liveRoomPollPanel.innerHTML = `
    <div class="row between">
      <strong>${escapeHtmlAttr(poll.question || "Live poll")}</strong>
      <span class="meta">${poll.is_open ? "Open" : "Closed"} | Votes: ${totalVotes}</span>
    </div>
    <div class="list" style="margin-top:8px;">
      ${options.map((opt, idx) => {
    const count = Number(votes[idx] || 0);
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const active = myVote === idx ? "status-open" : "status-dismissed";
    return `
          <div>
            <div class="row between">
              <span>${escapeHtmlAttr(opt)}</span>
              <span class="status-pill ${active}">${count} (${pct}%)</span>
            </div>
            ${canVote ? `<div class="actions"><button class="btn small" data-live-poll-vote="${idx}">${myVote === idx ? "Selected" : "Vote"}</button></div>` : ""}
          </div>
        `;
  }).join("")}
    </div>
  `;
  if (canVote) {
    el.liveRoomPollPanel.querySelectorAll("[data-live-poll-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const optionIndex = Number(btn.dataset.livePollVote || 0);
        try {
          await api("POST", `/student/live-classes/${state.liveRoom.sessionId}/poll-vote`, { option_index: optionIndex });
          await refreshLiveRoomState();
        } catch (err) {
          toast(err?.message || "Failed to submit poll vote", "error");
        }
      });
    });
  }
  if (state.liveRoom.sharedPanel === "poll" && state.liveRoom.sidePanel !== "poll") {
    setLiveSidePanel("poll", true);
  }
}

function applyLiveRoomState(room) {
  state.liveRoom.lastRoomState = room || null;
  const session = room?.session || {};
  const me = room?.me || {};
  setLiveWaitingOverlay(me.access_status || "admitted", {
    muted: Boolean(me.muted),
    removed: Boolean(me.removed),
    breakout_room: me.breakout_room || null,
  });
  setLiveHostMuted(Boolean(me.muted));
  if (el.liveRoomTitle) el.liveRoomTitle.textContent = session.title || "Live Classroom";
  if (el.liveRoomMeta) {
    const mode = session.meeting_mode === "external" ? "External meeting + in-app tools" : "In-app video classroom";
    el.liveRoomMeta.textContent = `${session.course_title || "Course"} | ${mode} | ${session.status || "scheduled"}`;
  }
  if (el.liveRoomPresenceBadge) {
    el.liveRoomPresenceBadge.textContent = `Participants: ${Number(room?.participant_count || 0)}`;
  }
  const boardServerText = String(session.board_text || "");
  state.liveRoom.boardServerText = boardServerText;

  const isProvider = state.liveRoom.role === "provider";
  if (el.liveRoomBoardText) {
    const boardFocused = document.activeElement === el.liveRoomBoardText;
    const shouldSyncBoard = !isProvider || !state.liveRoom.boardDraftDirty || !boardFocused;
    if (shouldSyncBoard && el.liveRoomBoardText.value !== boardServerText) {
      el.liveRoomBoardText.value = boardServerText;
    }
  }
  if (el.liveRoomBoardText) el.liveRoomBoardText.disabled = !isProvider;
  if (el.liveRoomSaveBoardBtn) el.liveRoomSaveBoardBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomPollQuestion) el.liveRoomPollQuestion.disabled = !isProvider;
  if (el.liveRoomPollOptions) el.liveRoomPollOptions.disabled = !isProvider;
  if (el.liveRoomStartPollBtn) el.liveRoomStartPollBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomClosePollBtn) el.liveRoomClosePollBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomOpenWhiteboardBtn) el.liveRoomOpenWhiteboardBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomOpenBreakoutBtn) el.liveRoomOpenBreakoutBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomOpenPollBtn) el.liveRoomOpenPollBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomOpenQaBtn) el.liveRoomOpenQaBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomShareWhiteboardBtn) el.liveRoomShareWhiteboardBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomShareBreakoutBtn) el.liveRoomShareBreakoutBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomShareQaBtn) el.liveRoomShareQaBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomPickStudentBtn) el.liveRoomPickStudentBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomExportAttendanceBtn) el.liveRoomExportAttendanceBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomStartTimerBtn) el.liveRoomStartTimerBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomStopTimerBtn) el.liveRoomStopTimerBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomAiTopicInput) el.liveRoomAiTopicInput.disabled = !isProvider;
  if (el.liveRoomAiExplainBtn) el.liveRoomAiExplainBtn.classList.toggle("hidden", !isProvider);

  const canRaise = !isProvider && Boolean(session.allow_raise_hand);
  if (el.liveRoomRaiseHandBtn) {
    el.liveRoomRaiseHandBtn.classList.toggle("hidden", !canRaise);
    el.liveRoomRaiseHandBtn.textContent = me.raised_hand ? "Lower Hand" : "Raise Hand";
  }
  if (el.liveRoomSendChatBtn) {
    el.liveRoomSendChatBtn.disabled = !session.allow_chat;
  }
  if (el.liveRoomChatInput) {
    el.liveRoomChatInput.disabled = !session.allow_chat || (me.access_status && me.access_status !== "admitted") || Boolean(me.muted);
    if (!session.allow_chat) el.liveRoomChatInput.placeholder = "Chat is disabled for this class";
    else if (Boolean(me.muted)) el.liveRoomChatInput.placeholder = "You are muted by host";
    else if (me.access_status && me.access_status !== "admitted") el.liveRoomChatInput.placeholder = "Waiting for host approval";
    else el.liveRoomChatInput.placeholder = "Type message";
  }
  if (el.liveRoomVideoStartBtn) el.liveRoomVideoStartBtn.disabled = false;
  if (el.liveRoomVideoStopBtn) el.liveRoomVideoStopBtn.disabled = false;
  if (el.liveRoomToggleMicBtn) {
    el.liveRoomToggleMicBtn.disabled = state.liveRoom.hostMuted;
    if (state.liveRoom.hostMuted) {
      setIconButtonLabel(el.liveRoomToggleMicBtn, liveUiIcon("mic-off"), "Host Muted");
      el.liveRoomToggleMicBtn.classList.add("is-muted");
      el.liveRoomToggleMicBtn.classList.remove("is-active");
    } else {
      setLiveMicMuted(liveRtcState().micMuted);
    }
  }
  if (el.liveRoomShareScreenBtn) el.liveRoomShareScreenBtn.disabled = false;
  if (el.liveRoomStopShareBtn) el.liveRoomStopShareBtn.disabled = false;
  if (el.liveRoomStartRecordingBtn) el.liveRoomStartRecordingBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomPauseRecordingBtn) el.liveRoomPauseRecordingBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomStopRecordingBtn) el.liveRoomStopRecordingBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomRecordingBadge) el.liveRoomRecordingBadge.classList.toggle("hidden", !(isProvider && state.liveRoom.recording.active));
  if (el.liveRoomParticipantsBtn) el.liveRoomParticipantsBtn.classList.toggle("hidden", false);
  if (el.liveRoomWaitingToggle) el.liveRoomWaitingToggle.closest("label")?.classList.toggle("hidden", !isProvider);
  if (el.liveRoomWaitingList) el.liveRoomWaitingList.parentElement?.classList.toggle("hidden", !isProvider);
  if (el.liveRoomAssignBreakoutBtn) el.liveRoomAssignBreakoutBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomClearBreakoutsBtn) el.liveRoomClearBreakoutsBtn.classList.toggle("hidden", !isProvider);
  if (el.liveRoomBreakoutName) el.liveRoomBreakoutName.classList.toggle("hidden", !isProvider);

  renderLiveRoomParticipants(room);
  renderLiveQaList();
  renderLivePollPanel(room);
  refreshLiveControlButtonStates();
  syncLiveRtcPeersFromRoom(room).catch(() => {});
}

async function refreshLiveRoomMessages() {
  if (!state.liveRoom.active || !state.liveRoom.sessionId) return;
  const prefix = getLiveRoomApiPrefix();
  const out = await api(
    "GET",
    `${prefix}/${state.liveRoom.sessionId}/messages?after_id=${state.liveRoom.lastMessageId}&limit=100`,
  );
  appendLiveRoomMessages(out?.items || []);
}

async function refreshLiveRoomState() {
  if (!state.liveRoom.active || !state.liveRoom.sessionId) return;
  const prefix = getLiveRoomApiPrefix();
  const room = await api("GET", `${prefix}/${state.liveRoom.sessionId}/room-state`);
  applyLiveRoomState(room);
}

async function refreshLiveRoom() {
  if (!state.liveRoom.active || !state.liveRoom.sessionId) return;
  const tasks = [refreshLiveRoomState(), refreshLiveRoomMessages()];
  if (state.liveRoom.role === "provider") tasks.push(refreshLiveModerationState());
  await Promise.all(tasks);
}

function startLiveRoomPolling() {
  stopLiveRoomPolling();
  state.liveRoom.pollerId = setInterval(() => {
    refreshLiveRoom().catch((err) => {
      log("live_room_poll_error", String(err));
    });
  }, 4000);
}

async function openLiveClassroom(sessionId, role, initialState = null) {
  state.liveRoom.active = true;
  state.liveRoom.sessionId = Number(sessionId);
  state.liveRoom.role = role;
  state.liveRoom.lastMessageId = 0;
  state.liveRoom.lastRoomState = null;
  if (liveRtcState().signalSeenIds) liveRtcState().signalSeenIds = {};
  if (liveRtcState().signalSeenKeys) liveRtcState().signalSeenKeys = {};
  state.liveRoom.moderation = null;
  state.liveRoom.selectedParticipantId = 0;
  state.liveRoom.accessStatus = "admitted";
  state.liveRoom.hostMuted = false;
  state.liveRoom.stagePeerId = "";
  state.liveRoom.focusPeerId = "";
  state.liveRoom.speakerScores = {};
  state.liveRoom.toolsOpen = false;
  state.liveRoom.chatOpen = false;
  state.liveRoom.reactionOpen = false;
  state.liveRoom.participantsOpen = false;
  state.liveRoom.sidePanel = "";
  state.liveRoom.sharedPanel = "";
  state.liveRoom.qaItems = [];
  state.liveRoom.boardServerText = "";
  state.liveRoom.boardDraftDirty = false;
  state.liveRoom.controlDockPointerInside = false;
  state.liveRoom.topbarPointerInside = false;
  state.liveRoom.controlDockVisible = true;
  refreshLiveLeaveButton();
  if (el.liveRoomChatList) el.liveRoomChatList.innerHTML = "";
  renderLiveRemoteVideos();
  attachLocalVideoPreview();
  setLiveSignalStatus(false);
  setLiveRecordingUi(false);
  setLiveWaitingOverlay("admitted", {});
  if (el.liveClassroomScreen) el.liveClassroomScreen.classList.remove("hidden");
  el.liveRoomStageShell?.requestFullscreen?.().catch(() => {});
  setLiveDrawerState("tools", false);
  setLiveDrawerState("chat", false);
  setLiveDrawerState("reaction", false);
  setLiveDrawerState("participants", false);
  setLiveControlDockVisibility(true);
  scheduleLiveControlDockAutoHide();
  setLiveSidePanel("", false);
  renderLiveQaList();
  refreshLiveControlButtonStates();
  if (initialState) applyLiveRoomState(initialState);
  await refreshLiveRoom();
  openLiveSignalSocket().catch(() => {});
  startLiveSpeakerMonitor();
  startLiveRoomPolling();
}

async function leaveLiveClassroom() {
  const { sessionId, role } = state.liveRoom;
  if (!sessionId || !role) {
    clearLiveRoomState();
    if (el.liveClassroomScreen) el.liveClassroomScreen.classList.add("hidden");
    return;
  }
  const prefix = getLiveRoomApiPrefix(role);
  try {
    await stopLiveCamera();
  } catch {}
  try {
    await api("POST", `${prefix}/${sessionId}/leave`);
  } catch (err) {
    log("live_room_leave_error", String(err));
  }
  clearLiveRoomState();
  if (el.liveClassroomScreen) el.liveClassroomScreen.classList.add("hidden");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (role === "provider") {
    refreshProviderLiveClasses().catch(() => {});
  } else {
    refreshStudentLiveClasses().catch(() => {});
  }
}

async function sendLiveRoomChatMessage(messageType = "chat", contentRaw = "") {
  const sessionId = Number(state.liveRoom.sessionId || 0);
  if (!sessionId) return;
  if (state.liveRoom.accessStatus && state.liveRoom.accessStatus !== "admitted") {
    throw new Error("Waiting for host approval");
  }
  if (messageType === "chat" && state.liveRoom.hostMuted && state.liveRoom.role === "student") {
    throw new Error("You are muted by host");
  }
  const content = String(contentRaw || "").trim();
  if (!content) return;
  const prefix = getLiveRoomApiPrefix();
  await api("POST", `${prefix}/${sessionId}/messages`, {
    message_type: messageType,
    content,
    payload: {},
  });
  if (el.liveRoomChatInput) el.liveRoomChatInput.value = "";
  await refreshLiveRoomMessages();
}

function formatTimerDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function startLiveClassTimer() {
  if (state.liveRoom.classTimerId) return;
  state.liveRoom.classTimerStartedAt = Date.now();
  if (el.liveRoomTimerText) el.liveRoomTimerText.textContent = "Timer: 00:00";
  state.liveRoom.classTimerId = setInterval(() => {
    if (!el.liveRoomTimerText || !state.liveRoom.classTimerStartedAt) return;
    el.liveRoomTimerText.textContent = `Timer: ${formatTimerDuration(Date.now() - state.liveRoom.classTimerStartedAt)}`;
  }, 1000);
}

function stopLiveClassTimer() {
  if (state.liveRoom.classTimerId) {
    clearInterval(state.liveRoom.classTimerId);
    state.liveRoom.classTimerId = null;
  }
}

function generateLiveTopicExplainer(topicRaw) {
  const topic = String(topicRaw || "").trim() || "Core concept";
  return [
    `AI Explainer: ${topic}`,
    "",
    `1) Definition`,
    `${topic} means the primary principle learners must understand before applying it.`,
    "",
    "2) Why it matters",
    `If ${topic} is clear, students can solve practical scenarios with fewer mistakes.`,
    "",
    "3) Example",
    `Show one real case, then ask students to identify where ${topic} appears.`,
    "",
    "4) Quick check question",
    `Ask: "In your own words, how would you apply ${topic} in real work?"`,
  ].join("\n");
}

function exportLiveAttendanceCsv() {
  const people = Array.from(el.liveRoomParticipantsList?.querySelectorAll(".item") || []);
  if (!people.length) {
    toast("No participants to export", "error");
    return;
  }
  const lines = ["name,role,status"];
  people.forEach((node) => {
    const txt = node.textContent || "";
    const row = txt.replace(/\s+/g, " ").trim();
    lines.push(`"${row.replace(/"/g, '""')}"`);
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `live-attendance-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}


function renderProviderCourseCatalog() {
  courseCatalogUi.renderProviderCourseCatalog();
}

async function refreshProviderContent() {
  const items = await api("GET", "/provider/workspace/content/courses");
  state.providerCourses = items || [];
  renderProviderCourseCatalog();
}

async function loadProviderDraftsRaw() {
  try {
    const drafts = await api("GET", "/provider/workspace/courses/drafts");
    const allDrafts = Array.isArray(drafts) ? drafts : [];
    state.providerDrafts = allDrafts.filter((d) => !isDraftAlreadyPosted(d, state.providerCourses));
  } catch {
    state.providerDrafts = [];
  }
}

function getAssessmentSourceValue() {
  return $("abCourseSelect")?.value || "";
}

function setAssessmentBuilderStep(step, options = {}) {
  return assessmentBuilderUi.setAssessmentBuilderStep(step, options);
}

function goToAssessmentStep(step) {
  return assessmentBuilderUi.goToAssessmentStep(step);
}

function validateAssessmentStep(step) {
  return assessmentBuilderUi.validateAssessmentStep(step);
}

function getSelectedAssessmentCourseId() {
  const raw = getAssessmentSourceValue();
  if (raw === "standalone") return 0;
  if (!raw || !raw.startsWith("course:")) return null;
  return Number(raw.split(":")[1] || 0);
}

function isAssessmentDraftSourceSelected() {
  const raw = getAssessmentSourceValue();
  return raw.startsWith("draft:");
}

const ASSESSMENT_BUILDER_CACHE_KEY = "certora_assessment_builder_cache_v1";

function persistAssessmentBuilderCache() {
  try {
    const payload = {
      ts: Date.now(),
      courseFilter: $("abCourseFilter")?.value || "all",
      courseSelect: $("abCourseSelect")?.value || "",
      title: $("abTitle")?.value || "",
      assessmentType: $("abAssessmentType")?.value || "mcq",
      instructions: $("abInstructions")?.value || "",
      about: $("abAbout")?.value || "",
      tools: $("abTools")?.value || "",
      topics: $("abTopics")?.value || "",
      passScore: $("abPassScore")?.value || "70",
      maxAttempts: $("abMaxAttempts")?.value || "",
      questionsPerAttempt: $("abQuestionsPerAttempt")?.value || "",
      negativeMarking: Boolean($("abNegativeMarking")?.checked),
      defaultNegativeMarks: $("abDefaultNegativeMarks")?.value || "",
      shuffleQuestions: Boolean($("abShuffleQuestions")?.checked),
      shuffleOptions: Boolean($("abShuffleOptions")?.checked),
      certificateEnabled: Boolean($("abCertificateEnabled")?.checked),
      timingMode: $("abTimingMode")?.value || "question",
      durationMinutes: $("abDurationMinutes")?.value || "",
      timePerQuestionSeconds: $("abTimePerQuestionSeconds")?.value || "",
      questionType: $("abQuestionType")?.value || "mcq_single_correct",
      questionMarks: $("abQuestionMarks")?.value || "",
      questionNegativeMarks: $("abQuestionNegativeMarks")?.value || "",
      questionText: $("abQuestionText")?.value || "",
      option1: $("abOption1")?.value || "",
      option2: $("abOption2")?.value || "",
      option3: $("abOption3")?.value || "",
      option4: $("abOption4")?.value || "",
      correctIndexes: Array.from(document.querySelectorAll("[data-ab-correct]"))
        .map((n, idx) => (n.checked ? idx : -1))
        .filter((idx) => idx >= 0),
      questions: state.assessmentDraftQuestions || [],
      task: buildPersistedAssessmentTaskSnapshot(),
      questionDefaultMarks: state.assessmentQuestionDefaultMarks,
      questionDefaultNegativeMarks: state.assessmentQuestionDefaultNegativeMarks,
      editingExamId: state.assessmentEditingExamId ? Number(state.assessmentEditingExamId) : null,
    };
    localStorage.setItem(ASSESSMENT_BUILDER_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

function clearAssessmentBuilderCache() {
  try {
    localStorage.removeItem(ASSESSMENT_BUILDER_CACHE_KEY);
  } catch {}
}

function tryRestoreAssessmentBuilderCache() {
  try {
    if (state.assessmentEditingExamId) return;
    const raw = localStorage.getItem(ASSESSMENT_BUILDER_CACHE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload) return;
    const ageMs = Date.now() - Number(payload.ts || 0);
    if (!Number.isFinite(ageMs) || ageMs > (24 * 60 * 60 * 1000)) return;
    const hasPool = Array.isArray(payload.questions) && payload.questions.length > 0;
    const hasFormState = Boolean(
      String(payload.title || "").trim()
      || String(payload.maxAttempts || "").trim()
      || String(payload.instructions || "").trim()
      || String(payload.about || "").trim()
      || String(payload.tools || "").trim()
      || String(payload.topics || "").trim()
      || String(payload.passScore || "").trim()
      || String(payload.questionsPerAttempt || "").trim()
      || String(payload.durationMinutes || "").trim()
      || String(payload.timePerQuestionSeconds || "").trim()
      || String(payload.questionText || "").trim()
      || String(payload.questionMarks || "").trim()
      || String(payload.questionNegativeMarks || "").trim()
      || String(payload.option1 || "").trim()
      || String(payload.option2 || "").trim()
      || String(payload.option3 || "").trim()
      || String(payload.option4 || "").trim(),
    );
    if (!hasPool && !hasFormState) return;
    $("abCourseFilter").value = String(payload.courseFilter || "all");
    renderAssessmentCourseOptions();
    $("abCourseSelect").value = String(payload.courseSelect || "");
    $("abTitle").value = String(payload.title || "");
    $("abAssessmentType").value = String(payload.assessmentType || "mcq");
    $("abInstructions").value = String(payload.instructions || "");
    if ($("abAbout")) $("abAbout").value = String(payload.about || "");
    if ($("abTools")) $("abTools").value = String(payload.tools || "");
    if ($("abTopics")) $("abTopics").value = String(payload.topics || "");
    $("abPassScore").value = String(payload.passScore || "70");
    $("abMaxAttempts").value = String(payload.maxAttempts || "");
    $("abQuestionsPerAttempt").value = String(payload.questionsPerAttempt || "");
    $("abNegativeMarking").checked = Boolean(payload.negativeMarking);
    $("abDefaultNegativeMarks").value = String(payload.defaultNegativeMarks || "");
    $("abShuffleQuestions").checked = Boolean(payload.shuffleQuestions);
    $("abShuffleOptions").checked = Boolean(payload.shuffleOptions);
    $("abCertificateEnabled").checked = Boolean(payload.certificateEnabled);
    $("abTimingMode").value = String(payload.timingMode || "question");
    $("abDurationMinutes").value = String(payload.durationMinutes || "");
    $("abTimePerQuestionSeconds").value = String(payload.timePerQuestionSeconds || "");
    $("abQuestionType").value = String(payload.questionType || "mcq_single_correct");
    $("abQuestionMarks").value = String(payload.questionMarks || "");
    $("abQuestionNegativeMarks").value = String(payload.questionNegativeMarks || "");
    $("abQuestionText").value = String(payload.questionText || "");
    if ($("abOption1")) $("abOption1").value = String(payload.option1 || "");
    if ($("abOption2")) $("abOption2").value = String(payload.option2 || "");
    if ($("abOption3")) $("abOption3").value = String(payload.option3 || "");
    if ($("abOption4")) $("abOption4").value = String(payload.option4 || "");
    const correct = Array.isArray(payload.correctIndexes) ? payload.correctIndexes.map((x) => Number(x)) : [];
    document.querySelectorAll("[data-ab-correct]").forEach((n, idx) => {
      n.checked = correct.includes(idx);
    });
    state.assessmentQuestionDefaultMarks = Number.isFinite(Number(payload.questionDefaultMarks))
      ? Number(payload.questionDefaultMarks)
      : null;
    state.assessmentQuestionDefaultNegativeMarks = Number.isFinite(Number(payload.questionDefaultNegativeMarks))
      ? Number(payload.questionDefaultNegativeMarks)
      : null;
    state.assessmentDraftQuestions = payload.questions;
    restoreAssessmentTaskSnapshot(payload.task || {});
    applyAssessmentTimingMode();
    applyAssessmentTypeUi();
    applyAssessmentNegativeMarkingUi();
    updateAssessmentSourceMeta();
    renderAssessmentPool();
    toast("Recovered unsaved assessment builder work");
  } catch {}
}

function applyAssessmentNegativeMarkingUi() {
  const enabled = Boolean($("abNegativeMarking")?.checked);
  $("abDefaultNegativeMarks")?.classList.toggle("hidden", !enabled);
  if ($("abQuestionNegativeMarks")) {
    $("abQuestionNegativeMarks").disabled = !enabled;
    if (!enabled) $("abQuestionNegativeMarks").value = "";
  }
}

function resetAssessmentBuilder() {
  state.assessmentEditingExamId = null;
  state.assessmentDraftQuestions = [];
  state.assessmentDraftTask = null;
  state.assessmentQuestionDefaultMarks = null;
  state.assessmentQuestionDefaultNegativeMarks = null;
  $("abCourseFilter").value = "active";
  $("abCourseSelect").value = "";
  $("abCourseMeta").textContent = "No course selected.";
  $("abTitle").value = "";
  $("abAssessmentType").value = "mcq";
  $("abInstructions").value = "";
  if ($("abAbout")) $("abAbout").value = "";
  if ($("abTools")) $("abTools").value = "";
  if ($("abTopics")) $("abTopics").value = "";
  $("abPassScore").value = "70";
  $("abMaxAttempts").value = "3";
  $("abQuestionsPerAttempt").value = "25";
  $("abNegativeMarking").checked = false;
  $("abDefaultNegativeMarks").value = "";
  $("abShuffleQuestions").checked = true;
  $("abShuffleOptions").checked = true;
  $("abCertificateEnabled").checked = true;
  $("abTimingMode").value = "question";
  $("abDurationMinutes").value = "25";
  $("abTimePerQuestionSeconds").value = "25";
  $("abQuestionType").value = "mcq_single_correct";
  $("abQuestionText").value = "";
  $("abQuestionMarks").value = "";
  $("abQuestionNegativeMarks").value = "";
  resetAssessmentTaskFields();
  $("abCourseSelect").disabled = false;
  $("abCourseFilter").disabled = false;
  ["abOption1", "abOption2", "abOption3", "abOption4"].forEach((id) => {
    const node = $(id);
    if (node) node.value = "";
  });
  document.querySelectorAll("[data-ab-correct]").forEach((n) => {
    n.checked = false;
  });
  renderAssessmentPool();
  renderAssessmentCourseOptions();
  applyAssessmentTimingMode();
  applyAssessmentTypeUi();
  applyAssessmentNegativeMarkingUi();
  const title = $("assessmentBuilderScreen")?.querySelector("h2");
  if (title) title.textContent = "Assessment Builder";
  const saveBtn = $("abSaveDraftBtn");
  const publishBtn = $("abPublishBtn");
  if (saveBtn) saveBtn.textContent = "Save Assessment Draft";
  if (publishBtn) publishBtn.textContent = "Publish Assessment";
  setAssessmentBuilderStep(1, { noAnimate: true });
}

function openAssessmentBuilder(allowRestore = true) {
  return assessmentBuilderUi.openAssessmentBuilder(allowRestore);
}

function closeAssessmentBuilder() {
  return assessmentBuilderUi.closeAssessmentBuilder();
}

function renderAssessmentCourseOptions() {
  return assessmentBuilderUi.renderAssessmentCourseOptions();
}

function updateAssessmentSourceMeta() {
  return assessmentBuilderUi.updateAssessmentSourceMeta();
}

function applyAssessmentTimingMode() {
  const mode = $("abTimingMode")?.value || "question";
  const type = $("abAssessmentType")?.value || "mcq";
  const durationField = $("abDurationMinutes");
  const perQuestionField = $("abTimePerQuestionSeconds");
  const durationWrap = durationField?.closest?.(".ab-field-wrap");
  const perQuestionWrap = perQuestionField?.closest?.(".ab-field-wrap");
  durationWrap?.classList.toggle("hidden", type === "mcq" && mode !== "assessment");
  perQuestionWrap?.classList.toggle("hidden", type !== "mcq" || mode !== "question");
}

function renderAssessmentPool() {
  return assessmentBuilderUi.renderAssessmentPool();
}

function applyAssessmentTypeUi() {
  const type = $("abAssessmentType")?.value || "mcq";
  const isMcq = type === "mcq";
  document.querySelectorAll(".ab-mcq-only").forEach((node) => node.classList.toggle("hidden", !isMcq));
  document.querySelectorAll("[data-ab-type-card]").forEach((node) => {
    node.classList.toggle("active", String(node.getAttribute("data-ab-type-card") || "") === type);
  });
  el.abMcqContentPanel?.classList.toggle("hidden", !isMcq);
  el.abTaskContentPanel?.classList.toggle("hidden", isMcq);
  ["abCodingFields", "abSpreadsheetFields", "abTaxFields", "abCaseFields"].forEach((id) => $(id)?.classList.add("hidden"));
  if (type === "coding") $("abCodingFields")?.classList.remove("hidden");
  if (type === "spreadsheet") $("abSpreadsheetFields")?.classList.remove("hidden");
  if (type === "tax_simulator") $("abTaxFields")?.classList.remove("hidden");
  if (type === "case_study") $("abCaseFields")?.classList.remove("hidden");
  if (!isMcq && $("abTimingMode")) $("abTimingMode").value = "assessment";
  applyAssessmentTimingMode();
}

function parseJsonField(id, fallback) {
  const raw = String($(id)?.value || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${id} must contain valid JSON`);
  }
}

function linesField(id) {
  return String($(id)?.value || "")
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function arrayToLines(value) {
  return Array.isArray(value) ? value.filter(Boolean).join("\n") : "";
}

function buildTaskFromAssessmentForm() {
  const type = $("abAssessmentType")?.value || "mcq";
  const title = String(el.abTaskTitle?.value || "").trim();
  const description = String(el.abTaskDescription?.value || "").trim();
  const instructions = String(el.abTaskInstructions?.value || "").trim();
  const marks = Number(el.abTaskMarks?.value || 0);
  if (!title) throw new Error("Task title is required");
  if (!description) throw new Error("Task description is required");
  if (!Number.isFinite(marks) || marks <= 0) throw new Error("Task marks must be greater than 0");
  const task = {
    type,
    title,
    description,
    instructions,
    marks,
    metadata: {},
    expected_output: {},
    grading_config: {},
  };
  if (type === "coding") {
    const visible = parseJsonField("abVisibleTests", []);
    const hidden = parseJsonField("abHiddenTests", []);
    task.metadata = {
      allowed_languages: linesField("abCodingLanguages"),
      starter_code: String($("abStarterCode")?.value || ""),
      visible_test_cases: visible,
    };
    task.expected_output = { test_cases: [...(Array.isArray(visible) ? visible : []), ...(Array.isArray(hidden) ? hidden : [])] };
    task.grading_config = { auto_grading_enabled: Boolean($("abTaskAutoGrading")?.checked) };
  } else if (type === "spreadsheet") {
    task.metadata = {
      initial_spreadsheet_data: parseJsonField("abInitialSheet", {}),
      locked_cells: linesField("abLockedCells"),
    };
    task.expected_output = {
      expected_final_values: parseJsonField("abExpectedValues", {}),
      expected_formulas: parseJsonField("abExpectedFormulas", {}),
    };
    task.grading_config = { auto_grading_enabled: Boolean($("abSpreadsheetAutoGrading")?.checked) };
  } else if (type === "tax_simulator") {
    task.metadata = {
      client_scenario: String($("abClientScenario")?.value || ""),
      tax_year: String($("abTaxYear")?.value || ""),
      client_documents: linesField("abClientDocuments"),
      required_simulated_forms: linesField("abRequiredForms"),
      scenario_facts: String($("abScenarioFacts")?.value || ""),
      compliance_checks: linesField("abComplianceChecks"),
    };
    task.expected_output = {
      expected_form_values: parseJsonField("abExpectedFormValues", {}),
      red_flags: linesField("abRedFlags"),
    };
    task.grading_config = { manual_review_required: Boolean($("abTaxManualReview")?.checked) };
  } else if (type === "case_study") {
    task.metadata = {
      case_prompt: String($("abCasePrompt")?.value || description),
      allowed_file_types: linesField("abAllowedFileTypes"),
      max_file_size_mb: Number($("abMaxFileSize")?.value || 10),
    };
    task.expected_output = { rubric: String($("abRubric")?.value || "") };
    task.grading_config = { manual_review_required: Boolean($("abCaseManualReview")?.checked), rubric: String($("abRubric")?.value || "") };
  }
  return task;
}

function buildPersistedAssessmentTaskSnapshot() {
  return {
    taskTitle: $("abTaskTitle")?.value || "",
    taskMarks: $("abTaskMarks")?.value || "",
    taskDescription: $("abTaskDescription")?.value || "",
    taskInstructions: $("abTaskInstructions")?.value || "",
    codingLanguages: $("abCodingLanguages")?.value || "",
    starterCode: $("abStarterCode")?.value || "",
    visibleTests: $("abVisibleTests")?.value || "",
    hiddenTests: $("abHiddenTests")?.value || "",
    taskAutoGrading: Boolean($("abTaskAutoGrading")?.checked),
    initialSheet: $("abInitialSheet")?.value || "",
    expectedValues: $("abExpectedValues")?.value || "",
    expectedFormulas: $("abExpectedFormulas")?.value || "",
    lockedCells: $("abLockedCells")?.value || "",
    spreadsheetAutoGrading: Boolean($("abSpreadsheetAutoGrading")?.checked),
    clientScenario: $("abClientScenario")?.value || "",
    taxYear: $("abTaxYear")?.value || "",
    clientDocuments: $("abClientDocuments")?.value || "",
    requiredForms: $("abRequiredForms")?.value || "",
    scenarioFacts: $("abScenarioFacts")?.value || "",
    expectedFormValues: $("abExpectedFormValues")?.value || "",
    complianceChecks: $("abComplianceChecks")?.value || "",
    redFlags: $("abRedFlags")?.value || "",
    taxManualReview: Boolean($("abTaxManualReview")?.checked),
    casePrompt: $("abCasePrompt")?.value || "",
    allowedFileTypes: $("abAllowedFileTypes")?.value || "",
    maxFileSize: $("abMaxFileSize")?.value || "",
    rubric: $("abRubric")?.value || "",
    caseManualReview: Boolean($("abCaseManualReview")?.checked),
  };
}

function restoreAssessmentTaskSnapshot(t = {}) {
  Object.entries({
    abTaskTitle: t.taskTitle,
    abTaskMarks: t.taskMarks,
    abTaskDescription: t.taskDescription,
    abTaskInstructions: t.taskInstructions,
    abCodingLanguages: t.codingLanguages,
    abStarterCode: t.starterCode,
    abVisibleTests: t.visibleTests,
    abHiddenTests: t.hiddenTests,
    abInitialSheet: t.initialSheet,
    abExpectedValues: t.expectedValues,
    abExpectedFormulas: t.expectedFormulas,
    abLockedCells: t.lockedCells,
    abClientScenario: t.clientScenario,
    abTaxYear: t.taxYear,
    abClientDocuments: t.clientDocuments,
    abRequiredForms: t.requiredForms,
    abScenarioFacts: t.scenarioFacts,
    abExpectedFormValues: t.expectedFormValues,
    abComplianceChecks: t.complianceChecks,
    abRedFlags: t.redFlags,
    abCasePrompt: t.casePrompt,
    abAllowedFileTypes: t.allowedFileTypes,
    abMaxFileSize: t.maxFileSize,
    abRubric: t.rubric,
  }).forEach(([id, value]) => {
    const node = $(id);
    if (node) node.value = String(value || "");
  });
  if ($("abTaskAutoGrading")) $("abTaskAutoGrading").checked = t.taskAutoGrading !== false;
  if ($("abSpreadsheetAutoGrading")) $("abSpreadsheetAutoGrading").checked = t.spreadsheetAutoGrading !== false;
  if ($("abTaxManualReview")) $("abTaxManualReview").checked = t.taxManualReview !== false;
  if ($("abCaseManualReview")) $("abCaseManualReview").checked = t.caseManualReview !== false;
}

function resetAssessmentTaskFields() {
  restoreAssessmentTaskSnapshot({
    taskAutoGrading: true,
    spreadsheetAutoGrading: true,
    taxManualReview: true,
    caseManualReview: true,
    maxFileSize: "10",
  });
}

const ASSESSMENT_SAMPLE_TEMPLATES = {
  mcq: {
    title: "Accounting Fundamentals MCQ Assessment",
    instructions: "Answer each question carefully. Choose the best option and submit before the timer ends.",
    about: "Checks core accounting concepts, journal entries, and financial statement basics.",
    tools: "Calculator\nScratch pad",
    topics: "Debit and credit rules\nJournal entries\nTrial balance\nFinancial statements",
    duration: "25",
    questions: [
      {
        question_text: "Which account is credited when cash is received from a customer for an invoice?",
        question_type: "mcq_single_correct",
        marks: 1,
        negative_marks: 0,
        options: [
          { option_text: "Accounts Receivable", is_correct: true, position: 1 },
          { option_text: "Cash", is_correct: false, position: 2 },
          { option_text: "Sales Returns", is_correct: false, position: 3 },
          { option_text: "Accounts Payable", is_correct: false, position: 4 },
        ],
      },
      {
        question_text: "Which statement is prepared to show assets, liabilities, and equity at a specific date?",
        question_type: "mcq_single_correct",
        marks: 1,
        negative_marks: 0,
        options: [
          { option_text: "Income Statement", is_correct: false, position: 1 },
          { option_text: "Balance Sheet", is_correct: true, position: 2 },
          { option_text: "Cash Flow Forecast", is_correct: false, position: 3 },
          { option_text: "Bank Reconciliation", is_correct: false, position: 4 },
        ],
      },
    ],
  },
  coding: {
    title: "Coding Assessment - Invoice Total Calculator",
    instructions: "Use the code editor. Keep the function name exactly as requested and make sure all visible tests pass.",
    about: "Evaluates basic programming ability, data handling, and edge-case thinking.",
    tools: "Code editor\nVisible test runner\nConsole output",
    topics: "Arrays\nFunctions\nNumerical accuracy\nTest cases",
    taskTitle: "Build an invoice total function",
    taskMarks: "20",
    taskDescription: "Write a function named calculate_total(items, tax_rate) that receives line items with price and quantity, then returns the final amount including tax rounded to 2 decimals.",
    taskInstructions: "Do not change the function name. Handle empty item lists and decimal values.",
    codingLanguages: "Python, JavaScript",
    starterCode: "def calculate_total(items, tax_rate):\n    # items: [{'price': 100, 'quantity': 2}]\n    return 0",
    visibleTests: '[{"name":"basic invoice","input":"items=[{\\"price\\":100,\\"quantity\\":2}], tax_rate=0.1","expected_output":"220.0"}]',
    hiddenTests: '[{"name":"empty invoice","input":"items=[], tax_rate=0.18","expected_output":"0.0"}]',
  },
  spreadsheet: {
    title: "Excel Assessment - Monthly Sales Workbook",
    instructions: "Complete the spreadsheet using formulas. Do not overwrite locked input cells.",
    about: "Measures Excel formula usage, totals, percentages, and spreadsheet accuracy.",
    tools: "Spreadsheet grid\nFormula bar\nCalculator",
    topics: "SUM formulas\nGross margin\nCell references\nLocked cells",
    taskTitle: "Complete the sales summary worksheet",
    taskMarks: "25",
    taskDescription: "Use the given sales and cost values to calculate total sales, total cost, profit, and margin percentage.",
    taskInstructions: "Enter formulas in the expected cells and leave input cells unchanged.",
    initialSheet: '{\n  "A1": "Metric",\n  "B1": "Value",\n  "A2": "Sales",\n  "B2": 125000,\n  "A3": "Cost",\n  "B3": 76000,\n  "A4": "Profit",\n  "B4": "",\n  "A5": "Margin %",\n  "B5": ""\n}',
    expectedValues: '{"B4":49000,"B5":0.392}',
    expectedFormulas: '{"B4":"=B2-B3","B5":"=B4/B2"}',
    lockedCells: "A1,B1,A2,B2,A3,B3,A4,A5",
  },
  tax_simulator: {
    title: "Accounting & Tax Assessment - Client Return Review",
    instructions: "Review the client scenario, identify tax treatment, and complete the required simulated forms.",
    about: "Evaluates practical accounting and tax judgment using client facts and supporting documents.",
    tools: "Tax simulator\nClient document viewer\nCalculator",
    topics: "Income classification\nDeduction review\nCompliance checks\nRed flags",
    taskTitle: "Prepare a client tax review memo",
    taskMarks: "30",
    taskDescription: "Review the client facts and document list. Identify income, deductions, missing documents, and compliance risks.",
    taskInstructions: "Use the simulator fields and provide a short explanation for each adjustment.",
    clientScenario: "Client is a self-employed consultant with professional income, home-office expenses, travel claims, and one missing bank statement.",
    taxYear: "2025",
    clientDocuments: "Form 1099-NEC\nExpense ledger\nTravel receipts\nHome-office worksheet",
    requiredForms: "Schedule C\nSelf-employment tax worksheet\nDeductions summary",
    scenarioFacts: "Gross receipts: 86,000. Claimed travel: 9,200. Home office: 12% business use. Missing March bank statement.",
    expectedFormValues: '{"gross_receipts":86000,"home_office_business_use":0.12}',
    complianceChecks: "Verify business purpose for travel\nFlag missing bank statement\nCheck home-office percentage",
    redFlags: "Missing March bank statement\nLarge travel claim without complete notes",
  },
  case_study: {
    title: "Case Study Assessment - Finance Operations Review",
    instructions: "Read the case, prepare your analysis, and upload the requested file.",
    about: "Assesses business reasoning, written communication, and structured analysis.",
    tools: "Document upload\nSpreadsheet or PDF support\nRubric-based review",
    topics: "Financial controls\nProcess review\nRisk analysis\nRecommendation writing",
    taskTitle: "Analyze an expense control case",
    taskMarks: "20",
    taskDescription: "A company has rising travel expenses and inconsistent approval records. Prepare a short review with findings and recommendations.",
    taskInstructions: "Upload a PDF, DOCX, or XLSX file containing your analysis.",
    casePrompt: "Review the case facts and identify control weaknesses, likely causes, and practical improvements for the finance team.",
    allowedFileTypes: "pdf, docx, xlsx",
    maxFileSize: "10",
    rubric: "Problem framing: 25%\nEvidence-based analysis: 35%\nRecommendations: 30%\nClarity: 10%",
  },
};

function setAssessmentField(id, value) {
  const node = $(id);
  if (node) node.value = String(value ?? "");
}

function fillAssessmentSampleTemplate(type, options = {}) {
  const template = ASSESSMENT_SAMPLE_TEMPLATES[type];
  if (!template) return;
  if ($("abAssessmentType")) $("abAssessmentType").value = type;
  setAssessmentField("abTitle", template.title);
  setAssessmentField("abInstructions", template.instructions);
  setAssessmentField("abAbout", template.about);
  setAssessmentField("abTools", template.tools);
  setAssessmentField("abTopics", template.topics);
  setAssessmentField("abPassScore", "70");
  setAssessmentField("abMaxAttempts", "3");
  setAssessmentField("abDurationMinutes", template.duration || "30");
  setAssessmentField("abTimingMode", type === "mcq" ? "question" : "assessment");
  if (type === "mcq") {
    state.assessmentDraftQuestions = (template.questions || []).map((q) => ({ ...q, options: (q.options || []).map((o) => ({ ...o })) }));
    setAssessmentField("abQuestionsPerAttempt", "25");
    renderAssessmentPool();
  } else {
    state.assessmentDraftQuestions = [];
    setAssessmentField("abTaskTitle", template.taskTitle);
    setAssessmentField("abTaskMarks", template.taskMarks);
    setAssessmentField("abTaskDescription", template.taskDescription);
    setAssessmentField("abTaskInstructions", template.taskInstructions);
    setAssessmentField("abCodingLanguages", template.codingLanguages);
    setAssessmentField("abStarterCode", template.starterCode);
    setAssessmentField("abVisibleTests", template.visibleTests);
    setAssessmentField("abHiddenTests", template.hiddenTests);
    setAssessmentField("abInitialSheet", template.initialSheet);
    setAssessmentField("abExpectedValues", template.expectedValues);
    setAssessmentField("abExpectedFormulas", template.expectedFormulas);
    setAssessmentField("abLockedCells", template.lockedCells);
    setAssessmentField("abClientScenario", template.clientScenario);
    setAssessmentField("abTaxYear", template.taxYear);
    setAssessmentField("abClientDocuments", template.clientDocuments);
    setAssessmentField("abRequiredForms", template.requiredForms);
    setAssessmentField("abScenarioFacts", template.scenarioFacts);
    setAssessmentField("abExpectedFormValues", template.expectedFormValues);
    setAssessmentField("abComplianceChecks", template.complianceChecks);
    setAssessmentField("abRedFlags", template.redFlags);
    setAssessmentField("abCasePrompt", template.casePrompt);
    setAssessmentField("abAllowedFileTypes", template.allowedFileTypes);
    setAssessmentField("abMaxFileSize", template.maxFileSize || "10");
    setAssessmentField("abRubric", template.rubric);
  }
  applyAssessmentTypeUi();
  applyAssessmentNegativeMarkingUi();
  persistAssessmentBuilderCache();
  if (options.gotoContent) {
    setAssessmentBuilderStep(type === "mcq" ? 2 : 3);
  }
  toast(`${template.title} loaded`, "success");
}

function jsonPretty(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "";
  }
}

function fillAssessmentTaskForEdit(task) {
  if (!task) return;
  const meta = task.metadata || {};
  const expected = task.expected_output || {};
  const grading = task.grading_config || {};
  if (el.abTaskTitle) el.abTaskTitle.value = task.title || "";
  if (el.abTaskMarks) el.abTaskMarks.value = String(task.marks || "");
  if (el.abTaskDescription) el.abTaskDescription.value = task.description || "";
  if (el.abTaskInstructions) el.abTaskInstructions.value = task.instructions || "";
  if (task.type === "coding") {
    $("abCodingLanguages").value = (meta.allowed_languages || []).join(", ");
    $("abStarterCode").value = meta.starter_code || "";
    $("abVisibleTests").value = jsonPretty(meta.visible_test_cases || []);
    $("abHiddenTests").value = jsonPretty((expected.test_cases || []).filter((t) => !(meta.visible_test_cases || []).some((v) => JSON.stringify(v) === JSON.stringify(t))));
    $("abTaskAutoGrading").checked = grading.auto_grading_enabled !== false;
  }
  if (task.type === "spreadsheet") {
    $("abInitialSheet").value = jsonPretty(meta.initial_spreadsheet_data || {});
    $("abExpectedValues").value = jsonPretty(expected.expected_final_values || {});
    $("abExpectedFormulas").value = jsonPretty(expected.expected_formulas || {});
    $("abLockedCells").value = (meta.locked_cells || []).join(", ");
    $("abSpreadsheetAutoGrading").checked = grading.auto_grading_enabled !== false;
  }
  if (task.type === "tax_simulator") {
    $("abClientScenario").value = meta.client_scenario || "";
    $("abTaxYear").value = meta.tax_year || "";
    $("abClientDocuments").value = (meta.client_documents || []).join("\n");
    $("abRequiredForms").value = (meta.required_simulated_forms || []).join("\n");
    $("abScenarioFacts").value = meta.scenario_facts || "";
    $("abExpectedFormValues").value = jsonPretty(expected.expected_form_values || {});
    $("abComplianceChecks").value = (meta.compliance_checks || []).join("\n");
    $("abRedFlags").value = (expected.red_flags || []).join("\n");
    $("abTaxManualReview").checked = grading.manual_review_required !== false;
  }
  if (task.type === "case_study") {
    $("abCasePrompt").value = meta.case_prompt || "";
    $("abAllowedFileTypes").value = (meta.allowed_file_types || []).join(", ");
    $("abMaxFileSize").value = String(meta.max_file_size_mb || 10);
    $("abRubric").value = grading.rubric || expected.rubric || "";
    $("abCaseManualReview").checked = grading.manual_review_required !== false;
  }
}

async function openAssessmentBuilderForEdit(assessment) {
  await Promise.all([refreshProviderContent(), loadProviderDraftsRaw()]);
  openAssessmentBuilder(false);
  state.assessmentEditingExamId = Number(assessment.exam_id);
  const titleNode = $("assessmentBuilderScreen")?.querySelector("h2");
  if (titleNode) titleNode.textContent = `Edit Draft Assessment #${assessment.exam_id}`;
  const saveBtn = $("abSaveDraftBtn");
  const publishBtn = $("abPublishBtn");
  if (saveBtn) saveBtn.textContent = "Save Changes";
  if (publishBtn) publishBtn.textContent = "Save & Publish";

  $("abTitle").value = assessment.title || "";
  $("abAssessmentType").value = assessment.assessment_type || "mcq";
  $("abInstructions").value = assessment.instructions || "";
  if ($("abAbout")) $("abAbout").value = assessment.about || "";
  if ($("abTools")) $("abTools").value = arrayToLines(assessment.tools || []);
  if ($("abTopics")) $("abTopics").value = arrayToLines(assessment.topics || []);
  $("abPassScore").value = String(assessment.pass_score || 70);
  $("abMaxAttempts").value = String(Math.min(3, Math.max(1, Number(assessment.max_attempts ?? 3))));
  $("abQuestionsPerAttempt").value = String(assessment.questions_per_attempt > 0 ? assessment.questions_per_attempt : 25);
  $("abNegativeMarking").checked = Boolean(assessment.negative_marking);
  $("abDefaultNegativeMarks").value = "";
  $("abShuffleQuestions").checked = Boolean(assessment.shuffle_questions);
  $("abShuffleOptions").checked = Boolean(assessment.shuffle_options);
  $("abCertificateEnabled").checked = Boolean(assessment.certificate_enabled);
  $("abTimingMode").value = assessment.timing_mode || "question";
  $("abDurationMinutes").value = String(Math.max(25, Number(assessment.duration_minutes || 25)));
  $("abTimePerQuestionSeconds").value = String(assessment.time_per_question_seconds || 25);
  applyAssessmentTimingMode();
  applyAssessmentTypeUi();
  applyAssessmentNegativeMarkingUi();

  renderAssessmentCourseOptions();
  $("abCourseSelect").value = assessment.is_standalone ? "standalone" : `course:${assessment.course_id}`;
  $("abCourseSelect").disabled = true;
  $("abCourseFilter").disabled = true;
  updateAssessmentSourceMeta();

  if (($("abAssessmentType")?.value || "mcq") === "mcq") {
    const existingQuestions = await api("GET", `/exams/${assessment.exam_id}/questions`);
    state.assessmentDraftQuestions = (existingQuestions || []).map((q) => ({
      question_id: q.question_id,
      question_text: q.question_text,
      question_type: q.question_type,
      marks: q.marks,
      negative_marks: q.negative_marks,
      options: (q.options || []).map((o) => ({
        option_text: o.option_text,
        is_correct: o.is_correct,
        position: o.position,
      })),
    }));
  } else {
    const task = assessment.task || await api("GET", `/exams/${assessment.exam_id}/task`).catch(() => null);
    fillAssessmentTaskForEdit(task);
  }
  if (state.assessmentDraftQuestions.length) {
    const first = state.assessmentDraftQuestions[0];
    state.assessmentQuestionDefaultMarks = Number(first?.marks) > 0 ? Number(first.marks) : null;
    state.assessmentQuestionDefaultNegativeMarks = Number(first?.negative_marks) >= 0 ? Number(first.negative_marks) : null;
    $("abQuestionMarks").value = state.assessmentQuestionDefaultMarks != null ? String(state.assessmentQuestionDefaultMarks) : "";
    if (Boolean($("abNegativeMarking")?.checked)) {
      const suggestedNeg = state.assessmentQuestionDefaultNegativeMarks != null ? state.assessmentQuestionDefaultNegativeMarks : 0;
      $("abDefaultNegativeMarks").value = String(suggestedNeg);
      $("abQuestionNegativeMarks").value = String(suggestedNeg);
    }
  }
  renderAssessmentPool();
  setAssessmentBuilderStep(1, { noAnimate: true });
}

function buildQuestionFromAssessmentForm() {
  const questionType = $("abQuestionType")?.value || "mcq_single_correct";
  const questionText = $("abQuestionText")?.value?.trim() || "";
  const marksInputRaw = String($("abQuestionMarks")?.value || "").trim();
  const firstQuestion = (state.assessmentDraftQuestions || []).length === 0;
  let marks = null;
  if (marksInputRaw) {
    const parsed = Number(marksInputRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Question marks must be greater than 0");
    marks = parsed;
  } else if (state.assessmentQuestionDefaultMarks != null) {
    marks = Number(state.assessmentQuestionDefaultMarks);
  }
  if (!Number.isFinite(marks) || marks <= 0) {
    if (firstQuestion) throw new Error("Marks is required for the first question");
    throw new Error("Marks is required");
  }

  const negativeEnabled = Boolean($("abNegativeMarking")?.checked);
  const defaultNegativeRaw = String($("abDefaultNegativeMarks")?.value || "").trim();
  const negativeInputRaw = String($("abQuestionNegativeMarks")?.value || "").trim();
  let negativeMarks = 0;
  if (negativeEnabled) {
    if (negativeInputRaw) {
      const parsed = Number(negativeInputRaw);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Negative marks cannot be negative");
      negativeMarks = parsed;
    } else if (defaultNegativeRaw) {
      const parsed = Number(defaultNegativeRaw);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Default negative marks cannot be negative");
      negativeMarks = parsed;
    } else if (state.assessmentQuestionDefaultNegativeMarks != null) {
      negativeMarks = Number(state.assessmentQuestionDefaultNegativeMarks);
    } else if (firstQuestion) {
      throw new Error("Set default negative marks or question negative marks");
    }
  }
  const optionsText = ["abOption1", "abOption2", "abOption3", "abOption4"]
    .map((id) => ($(id)?.value || "").trim());
  const correctChecks = Array.from(document.querySelectorAll("[data-ab-correct]"));
  const options = optionsText
    .map((txt, idx) => ({
      option_text: txt,
      is_correct: Boolean(correctChecks[idx]?.checked),
      position: idx + 1,
    }))
    .filter((o) => o.option_text);
  if (!questionText) throw new Error("Question text is required");
  if (options.length < 2) throw new Error("At least 2 options are required");
  const correctCount = options.filter((o) => o.is_correct).length;
  if (questionType === "mcq_single_correct" && correctCount !== 1) throw new Error("Single correct MCQ needs exactly 1 correct option");
  if (questionType === "mcq_multiple_correct" && correctCount < 1) throw new Error("Multiple correct MCQ needs at least 1 correct option");
  return {
    question_text: questionText,
    question_type: questionType,
    marks,
    negative_marks: negativeMarks,
    options,
  };
}

async function createAssessmentFromBuilder(publishNow) {
  if (isAssessmentDraftSourceSelected()) {
    throw new Error("Draft videos are not eligible. Publish the course first.");
  }
  const courseId = getSelectedAssessmentCourseId();
  if (courseId == null) throw new Error("Choose an active/inactive course or standalone assessment");
  const title = $("abTitle")?.value?.trim() || "";
  const assessmentType = $("abAssessmentType")?.value || "mcq";
  const instructions = $("abInstructions")?.value?.trim() || "";
  const about = $("abAbout")?.value?.trim() || "";
  const tools = linesField("abTools");
  const topics = linesField("abTopics");
  const passScore = Number($("abPassScore")?.value || 70);
  const maxAttempts = Number($("abMaxAttempts")?.value);
  const questionsPerAttempt = Number($("abQuestionsPerAttempt")?.value);
  const timingMode = assessmentType === "mcq" ? ($("abTimingMode")?.value || "question") : "assessment";
  const durationMinutesRaw = Number($("abDurationMinutes")?.value || 0);
  const timePerQuestionSeconds = Number($("abTimePerQuestionSeconds")?.value);
  const questionPool = state.assessmentDraftQuestions || [];
  const taskPayload = assessmentType === "mcq" ? null : buildTaskFromAssessmentForm();

  if (!title) throw new Error("Assessment title is required");
  if (!instructions) throw new Error("Instructions are required");
  if (!about) throw new Error("About assessment is required");
  if (!tools.length) throw new Error("Add at least one tool used");
  if (!topics.length) throw new Error("Add at least one topic included");
  if (!Number.isFinite(passScore) || passScore < 70 || passScore > 100) throw new Error("Passing score must be between 70 and 100");
  if (assessmentType === "mcq" && !questionPool.length) throw new Error("Add at least one question");
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0 || maxAttempts > 3) throw new Error("Max attempts must be between 1 and 3");
  if (assessmentType === "mcq" && ![25, 30, 35, 40].includes(questionsPerAttempt)) throw new Error("Questions shown must be 25, 30, 35, or 40");
  if (assessmentType === "mcq" && questionsPerAttempt > questionPool.length) {
    throw new Error("Questions shown to student cannot exceed pool size");
  }
  let durationMinutes = 25;
  if (timingMode === "assessment") {
    if (!Number.isFinite(durationMinutesRaw) || ![25, 30, 35, 40, 45].includes(durationMinutesRaw)) {
      throw new Error("Assessment duration must be 25, 30, 35, 40, or 45 minutes");
    }
    durationMinutes = durationMinutesRaw;
  }
  if (assessmentType === "mcq" && timingMode === "question" && ![25, 30, 35, 40, 45].includes(timePerQuestionSeconds)) {
    throw new Error("Time per question must be 25, 30, 35, 40, or 45 seconds");
  }
  if (assessmentType === "mcq" && questionPool.length < questionsPerAttempt * 2) {
    toast("Recommendation: keep at least 2x pool size for better randomization.");
  }

  const examPayload = {
    title,
    assessment_type: assessmentType,
    instructions,
    about,
    tools,
    topics,
    duration_minutes: durationMinutes,
    timing_mode: timingMode,
    time_per_question_seconds: assessmentType === "mcq" && timingMode === "question" ? timePerQuestionSeconds : null,
    questions_per_attempt: assessmentType === "mcq" ? questionsPerAttempt : 0,
    pass_score: passScore,
    negative_marking: assessmentType === "mcq" && Boolean($("abNegativeMarking")?.checked),
    shuffle_questions: assessmentType === "mcq" && Boolean($("abShuffleQuestions")?.checked),
    shuffle_options: assessmentType === "mcq" && Boolean($("abShuffleOptions")?.checked),
    max_attempts: Math.min(3, Math.max(1, maxAttempts)),
    certificate_enabled: Boolean($("abCertificateEnabled")?.checked),
  };

  let examId = state.assessmentEditingExamId;
  try {
    if (examId) {
      await api("PUT", `/exams/${examId}`, examPayload);
      if (assessmentType === "mcq") {
        for (const q of questionPool) {
          if (q.question_id) continue;
          const out = await api("POST", `/exams/${examId}/questions`, q);
          q.question_id = out.question_id;
        }
      } else {
        await api("PUT", `/exams/${examId}/task`, taskPayload);
      }
    } else {
      const createdExam = await api("POST", "/exams", { course_id: courseId, ...examPayload });
      examId = createdExam.id;
      if (assessmentType === "mcq") {
        for (const q of questionPool) {
          const out = await api("POST", `/exams/${examId}/questions`, q);
          q.question_id = out.question_id;
        }
      } else {
        await api("PUT", `/exams/${examId}/task`, taskPayload);
      }
    }
  } catch (err) {
    const parsed = parseApiErrorMessage(err);
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail || {});
    throw new Error(`Assessment save failed at exam/questions step (status=${parsed.status || "n/a"}). ${detail || "Unknown error."}`);
  }
  try {
    if (assessmentType === "mcq") {
      await api("POST", `/exams/${examId}/rule`, {
        min_questions: questionPool.length,
        min_pass_score: passScore,
        max_easy_ratio: 0.7,
        min_syllabus_areas: 1,
        max_duplicate_ratio: 0.1,
        max_ambiguous_ratio: 0.1,
      });
    }
  } catch (err) {
    const parsed = parseApiErrorMessage(err);
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail || {});
    throw new Error(`Assessment save failed at exam rule step (status=${parsed.status || "n/a"}). ${detail || "Unknown error."}`);
  }
  if (publishNow) {
    try {
      await api("POST", `/exams/${examId}/publish`);
    } catch (err) {
      const parsed = parseApiErrorMessage(err);
      const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail || {});
      throw new Error(`Assessment publish failed (status=${parsed.status || "n/a"}). ${detail || "Unknown error."}`);
    }
  }
  return { id: examId };
}

function clearAssessmentPreviewTimer() {
  assessmentTimer.clearAssessmentPreviewTimer();
}

function isPrecheckFullyComplete(p) {
  const checks = p.precheckChecks || {};
  return [
    "cameraReady",
    "audioReady",
    "speakPromptDone",
    "holdStillDone",
  ].every((key) => Boolean(checks[key]));
}

async function runGuidedSpeechCheck(options = {}) {
  const p = state.assessmentPreview.proctor;
  const maxDurationMs = Math.max(9000, Number(options.maxDurationMs || 9000));
  const scriptText = String(options.scriptText || "");
  const baseMouth = Number(p.faceReference?.mouthOpenRatio || 0.02);
  const baseRms = Number(p.audioBaselineRms || 0.03);
  const started = Date.now();
  let voiceFrames = 0;
  let mouthFrames = 0;
  while (Date.now() - started < maxDurationMs) {
    const elapsed = Date.now() - started;
    renderPrecheckScriptProgress(scriptText, elapsed / maxDurationMs);
    const rms = detectAudioRms();
    if (rms > Math.max(0.03, baseRms * 1.45)) voiceFrames += 1;
    try {
      if (!p.faceModel || !isPlayableVideoElement(el.apProctorVideo)) throw new Error("Video stream not ready");
      const out = p.faceModel.detectForVideo(el.apProctorVideo, performance.now());
      const faces = out?.faceLandmarks || [];
      if (faces.length === 1) {
        const metrics = computeFaceMetrics(faces[0]);
        if (metrics) {
          p.lastFaceMetrics = metrics;
          const mouthNow = Number(metrics.mouthOpenRatio || baseMouth);
          if (mouthNow > baseMouth + 0.02) mouthFrames += 1;
        }
      }
    } catch {}
    if (voiceFrames >= 5 && mouthFrames >= 3) {
      renderPrecheckScriptProgress(scriptText, 1);
      return true;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

async function runMicrophoneClarityCheck(options = {}) {
  const p = state.assessmentPreview.proctor;
  const maxDurationMs = Math.max(5200, Number(options.maxDurationMs || 5200));
  const scriptText = String(options.scriptText || "");
  const warmupStarted = Date.now();
  const floorSamples = [];
  while (Date.now() - warmupStarted < 900) {
    floorSamples.push(detectAudioRms());
    await new Promise((r) => setTimeout(r, 90));
  }
  const avgFloor = floorSamples.length
    ? floorSamples.reduce((a, b) => a + b, 0) / floorSamples.length
    : 0;
  const baseRms = Math.max(0.008, Number(p.audioBaselineRms || 0), avgFloor);
  const activeThreshold = Math.max(0.014, baseRms * 1.45);
  const peakThreshold = Math.max(0.022, baseRms * 1.85);

  const started = Date.now();
  let voiceFrames = 0;
  let peak = 0;
  let strongFrames = 0;
  while (Date.now() - started < maxDurationMs) {
    const elapsed = Date.now() - started;
    renderPrecheckScriptProgress(scriptText, elapsed / maxDurationMs);
    const rms = detectAudioRms();
    peak = Math.max(peak, rms);
    if (rms > activeThreshold) voiceFrames += 1;
    if (rms > peakThreshold) strongFrames += 1;
    // Pass immediately once voice signal is clearly captured.
    if (voiceFrames >= 6 && strongFrames >= 2) {
      renderPrecheckScriptProgress(scriptText, 1);
      return true;
    }
    await new Promise((r) => setTimeout(r, 105));
  }
  renderPrecheckScriptProgress(scriptText, 1);
  return voiceFrames >= 6 && peak >= peakThreshold;
}

async function runHoldStillCheck() {
  const p = state.assessmentPreview.proctor;
  const baseRatio = Number(p.faceReference?.ratio || 0.5);
  const baseX = Number(p.faceReference?.faceCenterX || 0.5);
  const baseY = Number(p.faceReference?.faceCenterY || 0.5);
  const started = Date.now();
  let stableFrames = 0;
  while (Date.now() - started < 2800) {
    try {
      if (!p.faceModel || !isPlayableVideoElement(el.apProctorVideo)) throw new Error("Video stream not ready");
      const out = p.faceModel.detectForVideo(el.apProctorVideo, performance.now());
      const faces = out?.faceLandmarks || [];
      if (faces.length === 1) {
        const metrics = computeFaceMetrics(faces[0]);
        if (metrics) {
          p.lastFaceMetrics = metrics;
          const stable = Math.abs(Number(metrics.ratio || baseRatio) - baseRatio) <= 0.045
            && Math.abs(Number(metrics.faceCenterX || baseX) - baseX) <= 0.06
            && Math.abs(Number(metrics.faceCenterY || baseY) - baseY) <= 0.06;
          if (stable) stableFrames += 1;
          else stableFrames = Math.max(0, stableFrames - 1);
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  return stableFrames >= 12;
}

function pauseAssessmentTimer() {
  const preview = state.assessmentPreview;
  preview.warningPauseCount += 1;
  preview.timerPaused = true;
}

function resumeAssessmentTimer() {
  const preview = state.assessmentPreview;
  preview.warningPauseCount = Math.max(0, preview.warningPauseCount - 1);
  preview.timerPaused = preview.warningPauseCount > 0;
}

function openProctorWarningModal(message) {
  if (!el.proctorWarningModal || !el.proctorWarningBody || !el.proctorWarningAcknowledgeBtn || !el.proctorWarningCountdown) return;
  pauseAssessmentTimer();
  el.proctorWarningBody.textContent = message;
  el.proctorWarningAcknowledgeBtn.disabled = true;
  el.proctorWarningCountdown.textContent = "You can continue after 5 seconds.";
  el.proctorWarningModal.classList.remove("hidden");
  let remaining = 5;
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) {
      el.proctorWarningCountdown.textContent = "Click Understood to continue the assessment.";
      el.proctorWarningAcknowledgeBtn.disabled = false;
      return;
    }
    el.proctorWarningCountdown.textContent = `You can continue after ${remaining} second${remaining === 1 ? "" : "s"}.`;
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);
}

function closeProctorWarningModal() {
  el.proctorWarningModal?.classList.add("hidden");
  resumeAssessmentTimer();
}

function updateProctorBadge() {
  const p = state.assessmentPreview.proctor;
  if (el.apProctorBadge) {
    el.apProctorBadge.textContent = "Proctoring active";
    el.apProctorBadge.classList.toggle("proctor-warn", p.warnings > 0);
    el.apProctorBadge.classList.toggle("proctor-danger", p.warnings >= p.maxWarnings - 1);
  }
}

async function ensureFaceLandmarker() {
  if (!faceLandmarkerCachePromise) {
    faceLandmarkerCachePromise = (async () => {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
      );
      const faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 2,
      });
      return faceLandmarker;
    })();
  }
  return faceLandmarkerCachePromise;
}

async function ensureHandLandmarker() {
  if (!handLandmarkerCachePromise) {
    handLandmarkerCachePromise = (async () => {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
      );
      const handLandmarker = await vision.HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      return handLandmarker;
    })();
  }
  return handLandmarkerCachePromise;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.addEventListener("load", () => {
      s.dataset.loaded = "1";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(s);
  });
}

async function ensurePhoneDetector() {
  if (!phoneDetectorCachePromise) {
    phoneDetectorCachePromise = (async () => {
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
      if (!window.cocoSsd) throw new Error("coco-ssd not available");
      const model = await window.cocoSsd.load();
      return model;
    })();
  }
  return phoneDetectorCachePromise;
}

function stopProctoringMonitoring() {
  const p = state.assessmentPreview.proctor;
  if (p.monitorId) {
    clearInterval(p.monitorId);
    p.monitorId = null;
  }
  if (p.visibilityHandler) {
    document.removeEventListener("visibilitychange", p.visibilityHandler);
    p.visibilityHandler = null;
  }
  if (p.blurHandler) {
    window.removeEventListener("blur", p.blurHandler);
    p.blurHandler = null;
  }
  if (p.focusHandler) {
    window.removeEventListener("focus", p.focusHandler);
    p.focusHandler = null;
  }
  if (p.fullscreenHandler) {
    document.removeEventListener("fullscreenchange", p.fullscreenHandler);
    p.fullscreenHandler = null;
  }
}

function shutdownProctoringMedia() {
  const p = state.assessmentPreview.proctor;
  stopProctoringMonitoring();
  if (p.stream) {
    p.stream.getTracks().forEach((t) => t.stop());
    p.stream = null;
  }
  if (p.audioContext) {
    p.audioContext.close().catch(() => {});
    p.audioContext = null;
    p.analyser = null;
  }
  p.lastFrame = null;
  p.startingUp = false;
  if (el.apProctorVideo) {
    el.apProctorVideo.pause?.();
    el.apProctorVideo.srcObject = null;
  }
}

function pushProctorWarning(reason, eventType = "proctor_warning", severity = "warning", options = {}) {
  const p = state.assessmentPreview.proctor;
  const key = `${eventType}:${reason}`;
  const now = Date.now();
  const last = p.lastWarnAt[key] || 0;
  if (!options?.bypassCooldown && now - last < p.warnCooldownMs) return;
  p.lastWarnAt[key] = now;
  p.warnings = Math.min(Number(p.maxWarnings || 0), Number(p.warnings || 0) + 1);
  updateProctorBadge();
  logProctorEvent(severity, eventType, { warnings: p.warnings, reason }).catch(() => {});
  captureAndUploadProctorSnapshot("warning", reason).catch(() => {});
  if (el.apProctorHints) {
    el.apProctorHints.textContent = `Warning ${p.warnings}: ${reason}`;
  }
  openProctorWarningModal(reason);
}

async function startServerProctorSession() {
  if (state.assessmentPreview.proctor.sessionId) {
    return { session_id: state.assessmentPreview.proctor.sessionId };
  }
  const examId = state.assessmentPreview.exam?.exam_id || null;
  const attemptId = state.assessmentPreview.attemptId || null;
  const mode = state.assessmentPreview.mode === "student_attempt" ? "attempt" : "preview";
  const precheckReady = Boolean(state.assessmentPreview.proctor?.precheckReady);
  const environmentAttested = Boolean(state.assessmentPreview.proctor?.environmentAttested);
  const out = await api("POST", "/proctoring/sessions/start", {
    mode,
    exam_id: examId,
    attempt_id: attemptId,
    consent_camera: precheckReady,
    consent_microphone: precheckReady,
    consent_recording: environmentAttested,
  });
  state.assessmentPreview.proctor.sessionId = out.session_id;
  return out;
}

async function logProctorEvent(severity, eventType, details = {}) {
  const sessionId = state.assessmentPreview.proctor.sessionId;
  if (!sessionId) return;
  await api("POST", `/proctoring/sessions/${sessionId}/events`, {
    event_type: eventType,
    severity,
    confidence: null,
    details,
  });
}

async function captureAndUploadProctorSnapshot(eventType, reason) {
  const sessionId = state.assessmentPreview.proctor.sessionId;
  const video = el.apProctorVideo;
  if (!sessionId || !video || !video.videoWidth || !video.videoHeight) return false;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(640, video.videoWidth);
  canvas.height = Math.min(360, video.videoHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  if (!blob) return false;
  const fd = new FormData();
  fd.append("file", blob, `snapshot_${Date.now()}.jpg`);
  fd.append("evidence_type", "image");
  fd.append("event_id", "");
  const headers = await getHeaders(true);
  delete headers["Content-Type"];
  await fetch(`/proctoring/sessions/${sessionId}/evidence`, {
    method: "POST",
    headers,
    body: fd,
  });
  await logProctorEvent("info", "evidence_snapshot_uploaded", { eventType, reason });
  return true;
}

async function captureAndUploadBaselineClip() {
  const sessionId = state.assessmentPreview.proctor.sessionId;
  const p = state.assessmentPreview.proctor;
  if (!sessionId || !p.stream || typeof MediaRecorder === "undefined") return false;
  const chunks = [];
  let rec;
  try {
    rec = new MediaRecorder(p.stream, { mimeType: "video/webm" });
  } catch {
    return false;
  }
  return await new Promise((resolve) => {
    const done = async () => {
      try {
        const blob = new Blob(chunks, { type: "video/webm" });
        if (!blob.size) {
          resolve(false);
          return;
        }
        const fd = new FormData();
        fd.append("file", blob, `baseline_${Date.now()}.webm`);
        fd.append("evidence_type", "video");
        const headers = {};
        if (state.auth?.currentUser) {
          headers.Authorization = `Bearer ${await state.auth.currentUser.getIdToken()}`;
        }
        await fetch(`/proctoring/sessions/${sessionId}/evidence`, {
          method: "POST",
          headers,
          body: fd,
        });
        await logProctorEvent("info", "baseline_clip_uploaded", {});
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      done().catch(() => resolve(false));
    };
    rec.start(250);
    setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        resolve(false);
      }
    }, 2600);
  });
}

async function finalizeServerProctorSession(reason) {
  const sessionId = state.assessmentPreview.proctor.sessionId;
  if (!sessionId) return null;
  const out = await api("POST", `/proctoring/sessions/${sessionId}/finalize`, {
    ended_reason: reason,
  });
  state.assessmentPreview.proctor.finalized = out;
  return out;
}

async function ensureAssessmentFullscreen() {
  if (!el.assessmentPreviewScreen?.requestFullscreen) return;
  if (document.fullscreenElement === el.assessmentPreviewScreen) return;
  await el.assessmentPreviewScreen.requestFullscreen().catch(() => {});
}

async function captureProctorBrightness() {
  const video = el.apProctorVideo;
  if (!video || !video.videoWidth || !video.videoHeight) return 0;
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return total / (data.length / 4);
}

function detectFrameMovement() {
  const p = state.assessmentPreview.proctor;
  const video = el.apProctorVideo;
  if (!video || !video.videoWidth || !video.videoHeight) return;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!p.lastFrame) {
    p.lastFrame = frame;
    return;
  }
  let diff = 0;
  for (let i = 0; i < frame.length; i += 4) {
    const cur = (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
    const prev = (p.lastFrame[i] + p.lastFrame[i + 1] + p.lastFrame[i + 2]) / 3;
    diff += Math.abs(cur - prev);
  }
  const avgDiff = diff / (frame.length / 4);
  p.lastFrame = frame;
  const metrics = p.lastFaceMetrics;
  const ref = p.faceReference;
  const horizontalShift = metrics && ref
    ? Math.abs(Number(metrics.faceCenterX || 0) - Number(ref.faceCenterX || 0))
    : 0;
  const verticalShift = metrics && ref
    ? Math.abs(Number(metrics.faceCenterY || 0) - Number(ref.faceCenterY || 0))
    : 0;
  const scaleShift = metrics && ref && Number(ref.eyeDist || 0) > 0
    ? Math.abs(Number(metrics.eyeDist || 0) - Number(ref.eyeDist || 0)) / Number(ref.eyeDist || 1)
    : 0;
  const likelyNormalNod = verticalShift > 0.025 && verticalShift < 0.11 && horizontalShift < 0.035 && scaleShift < 0.16;
  const suspiciousMotion = avgDiff > 24 && !likelyNormalNod && (horizontalShift > 0.045 || scaleShift > 0.18 || p.sideHandFrames >= 1);
  if (suspiciousMotion) p.movementFrames += 1;
  else p.movementFrames = Math.max(0, p.movementFrames - 1);
  if (p.movementFrames >= 3) {
    pushProctorWarning("Unusual movement detected. Stay centered.", "unusual_movement");
    p.movementFrames = 0;
  }
}

function detectAudioAnomaly() {
  const p = state.assessmentPreview.proctor;
  if (!p.analyser) return false;
  const rms = detectAudioRms();
  const threshold = Math.max(0.045, (p.audioBaselineRms || 0.03) * 1.8);
  return rms > threshold;
}

function detectLoudSpeechAnomaly() {
  const p = state.assessmentPreview.proctor;
  if (!p.analyser) return false;
  const rms = detectAudioRms();
  const loudThreshold = Math.max(0.085, (p.audioBaselineRms || 0.03) * 2.8);
  return rms > loudThreshold;
}

function detectVoicePersistence() {
  const p = state.assessmentPreview.proctor;
  if (!p.analyser) return false;
  const rms = detectAudioRms();
  const talkThreshold = Math.max(0.035, (p.audioBaselineRms || 0.03) * 1.35);
  return rms > talkThreshold;
}

async function detectMobilePhoneInFrame() {
  const p = state.assessmentPreview.proctor;
  const video = el.apProctorVideo;
  if (!p.phoneModelReady || !video || !video.videoWidth || !video.videoHeight) return;
  let model = null;
  try {
    model = await ensurePhoneDetector();
  } catch {
    p.phoneModelReady = false;
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    const preds = await model.detect(canvas);
    const hasPhone = preds.some((x) => x.class === "cell phone" && Number(x.score || 0) >= 0.45);
    if (hasPhone) p.phoneFrames += 1;
    else p.phoneFrames = Math.max(0, p.phoneFrames - 1);
    if (p.phoneFrames >= 2) {
      p.phoneWarnings = Number(p.phoneWarnings || 0) + 1;
      pushProctorWarning(
        "Mobile phone detected. Keep phone away from camera.",
        "mobile_phone_detected",
        "critical",
        { bypassCooldown: true },
      );
      p.phoneFrames = 0;
      if (p.phoneWarnings >= Number(p.maxPhoneWarnings || 3)) {
        showAssessmentPreviewResult("mobile_phone_detected");
      }
    }
  } catch {}
}

function analyzeHandFrame() {
  const p = state.assessmentPreview.proctor;
  const video = el.apProctorVideo;
  if (!p.handModel || !video || !video.videoWidth || !video.videoHeight) return;
  let result;
  try {
    result = p.handModel.detectForVideo(video, performance.now());
  } catch {
    return;
  }
  const hands = result?.landmarks || [];
  if (!hands.length) {
    p.sideHandFrames = Math.max(0, p.sideHandFrames - 1);
    p.handNearFaceFrames = Math.max(0, p.handNearFaceFrames - 1);
    return;
  }

  let sideHandDetected = false;
  let handNearFaceDetected = false;
  const ref = p.faceReference;
  for (const hand of hands) {
    if (!Array.isArray(hand) || !hand.length) continue;
    const xs = hand.map((pt) => Number(pt.x || 0));
    const ys = hand.map((pt) => Number(pt.y || 0));
    const centerX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const centerY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const spreadX = maxX - minX;
    if ((centerX < 0.14 || centerX > 0.86 || minX < 0.06 || maxX > 0.94) && centerY > 0.2 && centerY < 0.86 && spreadX > 0.05) {
      sideHandDetected = true;
    }
    if (ref && Number.isFinite(Number(ref.faceCenterX)) && Number.isFinite(Number(ref.faceCenterY))) {
      const dx = centerX - Number(ref.faceCenterX);
      const dy = centerY - Number(ref.faceCenterY);
      const dist = Math.hypot(dx, dy);
      const faceScale = Math.max(0.09, Number(ref.eyeDist || 0.1) * 2.6);
      const nearFace = dist < faceScale && spreadX > 0.05;
      const lateralBias = Math.abs(dx) > faceScale * 0.42;
      const edgeBias = centerX < 0.24 || centerX > 0.76;
      const correlatedSuspicion = sumGazeSuspicionWindow(p) >= 1 || p.sideHandFrames >= 1;
      if (nearFace && (lateralBias || edgeBias || correlatedSuspicion)) {
        handNearFaceDetected = true;
      }
    }
  }

  if (sideHandDetected) p.sideHandFrames += 1;
  else p.sideHandFrames = Math.max(0, p.sideHandFrames - 1);
  if (handNearFaceDetected) p.handNearFaceFrames += 1;
  else p.handNearFaceFrames = Math.max(0, p.handNearFaceFrames - 1);

  if (p.sideHandFrames >= 5) {
    pushProctorWarning(
      "Repeated hand activity near the side of the laptop detected. Remove any nearby phone or device.",
      "side_hand_activity_detected",
      "critical",
    );
    p.sideHandFrames = 0;
  }
  if (p.handNearFaceFrames >= 6) {
    pushProctorWarning(
      "Hand repeatedly near face detected. Keep hands away from face and off any nearby device.",
      "hand_near_face_repeated",
      "critical",
    );
    p.handNearFaceFrames = 0;
  }
}

function analyzeFaceFrame() {
  const p = state.assessmentPreview.proctor;
  const video = el.apProctorVideo;
  if (!p.faceModel || !video || !video.videoWidth || !video.videoHeight) return;
  let result;
  try {
    result = p.faceModel.detectForVideo(video, performance.now());
  } catch {
    return;
  }
  const faces = result?.faceLandmarks || [];
  if (!faces.length) {
    p.faceAbsentFrames += 1;
  } else {
    p.faceAbsentFrames = 0;
  }
  if (p.faceAbsentFrames >= 3) {
    pushProctorWarning("Face not visible. Keep your face in frame.", "face_not_visible");
    p.faceAbsentFrames = 0;
  }

  if (faces.length > 1) {
    p.multiFaceFrames += 1;
  } else {
    p.multiFaceFrames = 0;
  }
  if (p.multiFaceFrames >= 2) {
    pushProctorWarning("Multiple faces detected. Only one person is allowed.", "multiple_faces_detected", "critical");
    p.multiFaceFrames = 0;
  }

  if (faces.length) {
    const lm = faces[0];
    const metrics = computeFaceMetrics(lm);
    if (metrics) {
      p.lastFaceMetrics = metrics;
      tickGazeThreeLayerModel(p, metrics, Date.now());
      if (p.faceReference) {
        const d0 = Math.abs((metrics.noseLeft || 0) - (p.faceReference.noseLeft || 0));
        const d1 = Math.abs((metrics.noseRight || 0) - (p.faceReference.noseRight || 0));
        const d2 = Math.abs((metrics.eyeDist || 0) - (p.faceReference.eyeDist || 0));
        const mismatch = d0 + d1 + d2 > 0.42;
        if (mismatch) p.faceMismatchFrames += 1;
        else p.faceMismatchFrames = Math.max(0, p.faceMismatchFrames - 1);
        if (p.faceMismatchFrames >= 4) {
          pushProctorWarning(
            "Face mismatch detected. Ensure only registered candidate is visible.",
            "face_identity_mismatch",
            "critical",
          );
          p.faceMismatchFrames = 0;
        }
        const refEyeDist = Number(p.faceReference.eyeDist || 0);
        const tooFar = refEyeDist > 0 && metrics.eyeDist < refEyeDist * 0.72;
        if (tooFar) p.faceTooFarFrames += 1;
        else p.faceTooFarFrames = Math.max(0, p.faceTooFarFrames - 1);
        if (p.faceTooFarFrames >= 4) {
          pushProctorWarning(
            "You moved too far from the laptop screen. Stay close and keep your eyes on the exam screen.",
            "moved_far_from_screen",
          );
          p.faceTooFarFrames = 0;
        }
      }
    }
  } else {
    p.lastFaceMetrics = null;
    p.screenGazeLastResult = null;
    refreshScreenGazeDebugBox(p);
  }
}

async function runFaceCalibration() {
  const p = state.assessmentPreview.proctor;
  if (!p.faceModel || !isPlayableVideoElement(el.apProctorVideo)) return false;
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < 4200) {
    try {
      const out = p.faceModel.detectForVideo(el.apProctorVideo, performance.now());
      const faces = out?.faceLandmarks || [];
      if (faces.length !== 1) {
        await new Promise((r) => setTimeout(r, 180));
        continue;
      }
      const m = computeFaceMetrics(faces[0]);
      if (m) samples.push(m);
    } catch {}
    await new Promise((r) => setTimeout(r, 130));
  }
  // Fallback for intermittent landmark capture on basic laptop webcams:
  // if we captured at least one valid frame recently, use it as calibration reference.
  if (!samples.length && p.lastFaceMetrics) {
    samples.push(p.lastFaceMetrics);
  }
  if (!samples.length) return false;
  const avg = (key) => samples.reduce((acc, cur) => acc + (Number(cur[key]) || 0), 0) / samples.length;
  p.faceReference = {
    eyeDist: avg("eyeDist"),
    noseLeft: avg("noseLeft"),
    noseRight: avg("noseRight"),
    ratio: avg("ratio"),
    faceCenterX: avg("faceCenterX"),
    faceCenterY: avg("faceCenterY"),
    leftEyeOpenRatio: avg("leftEyeOpenRatio"),
    rightEyeOpenRatio: avg("rightEyeOpenRatio"),
    leftGazeX: avg("leftGazeX"),
    rightGazeX: avg("rightGazeX"),
    leftGazeY: avg("leftGazeY"),
    rightGazeY: avg("rightGazeY"),
    mouthOpenRatio: avg("mouthOpenRatio"),
  };
  p.behaviorSignature = buildBehaviorSignature(p.faceReference, p.audioBaselineRms);
  p.calibrated = true;
  refreshScreenGazeDebugBox(p);
  return true;
}

async function collectLivePrecheckQualitySamples(durationMs = 1800) {
  const p = state.assessmentPreview.proctor;
  const samples = {
    brightness: [],
    audio: [],
    faceCount: 0,
    singleFaceCount: 0,
    stableFaceMetricCount: 0,
    largeFaceCount: 0,
  };
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const brightness = await captureProctorBrightness().catch(() => 0);
    if (brightness > 0) samples.brightness.push(brightness);
    const rms = detectAudioRms();
    if (Number.isFinite(rms)) samples.audio.push(rms);
    if (p.faceModel && isPlayableVideoElement(el.apProctorVideo)) {
      try {
        const out = p.faceModel.detectForVideo(el.apProctorVideo, performance.now());
        const faces = out?.faceLandmarks || [];
        samples.faceCount += 1;
        if (faces.length === 1) {
          samples.singleFaceCount += 1;
          const metrics = computeFaceMetrics(faces[0]);
          if (metrics) {
            samples.stableFaceMetricCount += 1;
            // Relax baseline face-size threshold for common laptop webcams.
            if (Number(metrics.eyeDist || 0) >= 0.043) samples.largeFaceCount += 1;
          }
        }
      } catch {
        // ignore per-frame model errors during precheck sampling
      }
    }
    await new Promise((r) => setTimeout(r, 140));
  }
  return samples;
}

function summarizeLivePrecheckQuality(samples) {
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const peak = (arr) => arr.length ? Math.max(...arr) : 0;
  const brightnessAvg = avg(samples.brightness);
  const audioAvg = avg(samples.audio);
  const audioPeak = peak(samples.audio);
  const singleFaceRatio = samples.faceCount > 0 ? samples.singleFaceCount / samples.faceCount : 0;
  const clearFaceRatio = samples.singleFaceCount > 0 ? samples.largeFaceCount / samples.singleFaceCount : 0;
  // Some laptop webcams intermittently miss face landmarks despite valid video feed.
  // Treat low sampling coverage as "inconclusive" instead of immediate failure.
  const faceSamplingWeak = Number(samples.faceCount || 0) < 4;
  const checks = {
    lightingOk: brightnessAvg >= 42,
    faceVisibleOk: faceSamplingWeak ? true : (singleFaceRatio >= 0.56 && samples.stableFaceMetricCount >= 3),
    faceSizeOk: faceSamplingWeak ? true : clearFaceRatio >= 0.42,
    audioSignalOk: audioPeak >= 0.006,
    audioNoiseOk: audioAvg <= 0.11,
  };
  return {
    brightnessAvg,
    audioAvg,
    audioPeak,
    singleFaceRatio,
    clearFaceRatio,
    faceSamplingWeak,
    checks,
  };
}

function getLivePrecheckFailureMessage(summary) {
  const c = summary.checks;
  if (!c.lightingOk) return "Lighting is too low. Brighten your face and screen area before starting.";
  if (!c.faceVisibleOk) return "Face visibility is weak. Keep only one face centered and clearly visible to the camera.";
  if (!c.faceSizeOk) return "Move slightly closer to the laptop so your eyes and face are captured clearly.";
  if (!c.audioSignalOk) return "Microphone signal is too weak. Check microphone permission and speak once near the laptop.";
  if (!c.audioNoiseOk) return "Background noise is too high. Move to a quieter room before starting.";
  return "";
}

function renderLivePrecheckQualitySummary(summary) {
  const checks = summary.checks;
  const tag = (ok, label) => `${ok ? "PASS" : "FAIL"} ${label}`;
  if (el.apProctorHints) {
    el.apProctorHints.textContent = [
      tag(checks.lightingOk, "lighting"),
      tag(checks.faceVisibleOk && checks.faceSizeOk, "camera clarity"),
      tag(checks.audioSignalOk && checks.audioNoiseOk, "audio clarity"),
    ].join(" | ");
  }
}

function startProctoringMonitoring() {
  const p = state.assessmentPreview.proctor;
  scheduleNextAttentionChallenge(45000, 75000);
  p.visibilityHandler = () => {
    if (document.hidden) pushProctorWarning("Tab switching detected. Stay on the test screen.");
  };
  p.blurHandler = () => pushProctorWarning("Window focus lost. Switching is not allowed.");
  p.focusHandler = () => {
    // requestFullscreen must be user-gesture initiated; do not invoke from focus event.
  };
  p.fullscreenHandler = () => {
    if (el.assessmentPreviewScreen?.classList.contains("hidden")) return;
    if (!document.fullscreenElement) {
      pushProctorWarning("Exited fullscreen. Fullscreen is required.");
    }
  };
  document.addEventListener("visibilitychange", p.visibilityHandler);
  window.addEventListener("blur", p.blurHandler);
  window.addEventListener("focus", p.focusHandler);
  document.addEventListener("fullscreenchange", p.fullscreenHandler);
  p.monitorId = setInterval(async () => {
    p.monitorTick += 1;
    const brightness = await captureProctorBrightness();
    if (brightness > 0 && brightness < 40) {
      pushProctorWarning("Low lighting detected. Improve lighting.", "low_lighting");
    }
    analyzeFaceFrame();
    maybeRunAttentionChallenge();
    analyzeHandFrame();
    detectFrameMovement();
    if (p.monitorTick % 2 === 0) {
      await detectMobilePhoneInFrame();
    }
    const loud = detectAudioAnomaly();
    const persistentVoice = detectVoicePersistence();
    if (loud || persistentVoice) p.speechFrames += 1;
    else p.speechFrames = Math.max(0, p.speechFrames - 1);
    if (p.speechFrames >= 2) {
      pushProctorWarning("Continuous external voice/noise detected.", "external_voice_detected", "critical");
      p.speechFrames = 0;
    }
    const loudSpeech = detectLoudSpeechAnomaly();
    if (loudSpeech) p.loudVoiceFrames += 1;
    else p.loudVoiceFrames = Math.max(0, p.loudVoiceFrames - 1);
    if (p.loudVoiceFrames >= 2) {
      pushProctorWarning(
        "Loud self-speaking detected. Reading or speaking loudly during the test is not allowed.",
        "loud_voice_detected",
        "critical",
      );
      p.loudVoiceFrames = 0;
    }
    const candidateSpeech = detectCandidateSpeech();
    if (candidateSpeech) p.candidateSpeechFrames += 1;
    else p.candidateSpeechFrames = Math.max(0, p.candidateSpeechFrames - 1);
    if (p.candidateSpeechFrames >= 2) {
      pushProctorWarning(
        "Reading aloud or self-speaking detected. Candidates must remain silent during the test.",
        "reading_aloud_detected",
        "critical",
      );
      p.candidateSpeechFrames = 0;
    }
    const backgroundVoice = detectBackgroundVoice();
    if (backgroundVoice) p.backgroundVoiceFrames += 1;
    else p.backgroundVoiceFrames = Math.max(0, p.backgroundVoiceFrames - 1);
    if (p.backgroundVoiceFrames >= 2) {
      pushProctorWarning(
        "Voice detected near the candidate without matching mouth movement. Possible nearby external speaker.",
        "background_voice_detected",
        "critical",
      );
      p.backgroundVoiceFrames = 0;
    }
    const drift = evaluateBehaviorDrift();
    if (drift.score >= 1.9 && drift.reasons.length >= 2) p.behaviorDriftFrames += 1;
    else p.behaviorDriftFrames = Math.max(0, p.behaviorDriftFrames - 1);
    if (p.behaviorDriftFrames >= 3) {
      pushProctorWarning(
        "Behavior pattern drift detected. Your gaze, posture, and interaction pattern no longer match the verified exam baseline.",
        "behavior_signature_drift",
        "critical",
      );
      logProctorEvent("critical", "behavior_signature_drift_detail", {
        reasons: drift.reasons,
        score: Number(drift.score.toFixed(3)),
      }).catch(() => {});
      p.behaviorDriftFrames = 0;
    }
  }, 500);
}

async function runProctoringPrecheck(retryCount = 0) {
  const startedAtMs = Date.now();
  const p = state.assessmentPreview.proctor;
  const isMobileDevice = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
  p.precheckChecks = createDefaultPrecheckChecklist();
  p.precheckReady = false;
  p.precheckInProgress = true;
  p.precheckUnlockAtMs = 0;
  p.readAloudReady = true;
  showPrecheckChecksPage();
  if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "";
  renderPrecheckChecklist("");
  updateAssessmentStartEligibility();
  if (isMobileDevice) {
    p.precheckInProgress = false;
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Assessments are blocked on mobile devices. Use a desktop/laptop.";
    if (el.apProctorHints) el.apProctorHints.textContent = "Mobile device usage is not permitted for proctored exams.";
    setPrecheckInstruction(
      "Desktop/laptop is required for proctored assessments.",
      "",
      "Mobile phones and tablets are blocked for strict proctoring.",
    );
    if (el.apStartTestBtn) el.apStartTestBtn.disabled = true;
    return;
  }
  shutdownProctoringMedia();
  p.warnings = 0;
  p.faceAbsentFrames = 0;
  p.faceAwayFrames = 0;
  p.faceMismatchFrames = 0;
  p.gazeAwayFrames = 0;
  p.faceTooFarFrames = 0;
  p.multiFaceFrames = 0;
  p.speechFrames = 0;
  p.loudVoiceFrames = 0;
  p.candidateSpeechFrames = 0;
  p.backgroundVoiceFrames = 0;
  p.sideHandFrames = 0;
  p.handNearFaceFrames = 0;
  p.lookAwaySinceMs = 0;
  resetGazeSuspicionSessionState(p);
  p.faceReference = null;
  p.behaviorSignature = null;
  p.behaviorDriftFrames = 0;
  p.challengeActive = false;
  p.challengeTarget = "";
  p.challengeStartMs = 0;
  p.challengeDeadlineMs = 0;
  p.challengeCooldownUntil = 0;
  p.challengeNextAtMs = 0;
  p.challengePasses = 0;
  p.challengeFailures = 0;
  p.environmentAttested = Boolean(el.apEnvironmentAttest?.checked);
  p.precheckBypassed = false;
  p.readAloudReady = true;
  p.precheckReady = false;
  p.calibrated = false;
  p.audioBaselineRms = 0.03;
  p.baselineEvidenceReady = false;
  p.monitorTick = 0;
  p.phoneFrames = 0;
  p.phoneWarnings = 0;
  p.phoneModelReady = false;
  p.handModel = null;
  p.handModelReady = false;
  p.lastWarnAt = {};
  updateProctorBadge();
  clearAttentionChallengeOverlay();
  if (el.apProctorVideo) el.apProctorVideo.srcObject = null;
  if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "";
  if (el.apProctorHints) el.apProctorHints.textContent = "Keep face centered, follow the instruction panel, and complete all checks.";
  setPrecheckInstruction(
    "Allow camera and microphone access to begin checks.",
    "cameraReady",
    "Video check will validate face clarity, lighting, and single-candidate presence.",
  );
  try {
    const stepDwellMs = 360;
    const waitStepDwell = () => new Promise((resolve) => setTimeout(resolve, stepDwellMs));
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { min: 960, ideal: 1280, max: 1920 },
        height: { min: 540, ideal: 720, max: 1080 },
        frameRate: { min: 24, ideal: 30, max: 30 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    p.stream = stream;
    if (el.apProctorVideo) {
      el.apProctorVideo.srcObject = stream;
      el.apProctorVideo.style.transform = "scaleX(1)";
      el.apProctorVideo.style.webkitTransform = "scaleX(1)";
      await el.apProctorVideo.play().catch(() => {});
    }
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      p.audioContext = audioContext;
      p.analyser = analyser;
    } catch {}
    try {
      p.faceModel = await ensureFaceLandmarker();
      p.faceModelError = "";
    } catch {
      p.faceModel = null;
      p.faceModelError = "Face model unavailable";
    }
    await new Promise((r) => setTimeout(r, 750));
    setPrecheckInstruction(
      "Step 1/4: Stay centered while camera quality is checked.",
      "cameraReady",
      "Instruction: Keep shoulders visible, face in center, and no one else in frame.",
    );
    let qualitySamples = await collectLivePrecheckQualitySamples(1700);
    let quality = summarizeLivePrecheckQuality(qualitySamples);
    renderLivePrecheckQualitySummary(quality);
    if (!quality.checks.lightingOk || !quality.checks.faceVisibleOk || !quality.checks.faceSizeOk) {
      await new Promise((r) => setTimeout(r, 900));
      qualitySamples = await collectLivePrecheckQualitySamples(1700);
      quality = summarizeLivePrecheckQuality(qualitySamples);
      renderLivePrecheckQualitySummary(quality);
    }
    if (!quality.checks.lightingOk || !quality.checks.faceVisibleOk || !quality.checks.faceSizeOk) {
      throw new Error(getLivePrecheckFailureMessage(quality) || "Camera clarity check failed.");
    }
    p.precheckChecks.cameraReady = true;
    renderPrecheckChecklist("audioReady");
    await waitStepDwell();

    setPrecheckInstruction(
      "Step 2/4: Stay quiet for a moment while baseline audio is measured.",
      "audioReady",
      "Instruction: Keep silent and avoid background speech/noise during this baseline scan.",
    );
    const baselineRmsSamples = [];
    const baselineAudioStarted = Date.now();
    while (Date.now() - baselineAudioStarted < 1200) {
      baselineRmsSamples.push(detectAudioRms());
      await new Promise((r) => setTimeout(r, 120));
    }
    if (baselineRmsSamples.length) {
      p.audioBaselineRms = baselineRmsSamples.reduce((a, b) => a + b, 0) / baselineRmsSamples.length;
    }
    setPrecheckInstruction(
      "Step 2/4: Microphone check - speak clearly for 2-3 seconds.",
      "audioReady",
      "Say this line clearly: My microphone is clear.",
      "My microphone is clear.",
    );
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Microphone check starts in 3 seconds...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Microphone check starts in 2 seconds...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Microphone check starts in 1 second...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Speak now: My microphone is clear. You have up to 5 minutes.";
    renderPrecheckScriptProgress("My microphone is clear.", 0);
    let micOk = await runMicrophoneClarityCheck({
      maxDurationMs: 300000,
      scriptText: "My microphone is clear.",
    });
    if (!micOk) {
      micOk = await runRulesReadAloudVerification(p.audioBaselineRms).catch(() => false);
    }
    if (!micOk) {
      throw new Error("Microphone clarity check failed. Speak clearly for 2-3 seconds and retry.");
    }
    p.precheckChecks.audioReady = true;
    renderPrecheckChecklist("speakPromptDone");
    await waitStepDwell();

    const calibrated = await runFaceCalibration();
    if (!calibrated) throw new Error("Face calibration failed. Keep one face centered and retry.");

    setPrecheckInstruction(
      "Step 3/4: Read clearly for 3 seconds: \"I am ready for this proctored assessment.\"",
      "speakPromptDone",
      "Voice check instruction: Read in normal volume while looking at the camera.",
      "I am ready for this proctored assessment.",
    );
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Read-aloud check starts in 3 seconds...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Read-aloud check starts in 2 seconds...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Read-aloud check starts in 1 second...";
    await new Promise((r) => setTimeout(r, 900));
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Read now: I am ready for this proctored assessment. You have up to 5 minutes.";
    renderPrecheckScriptProgress("I am ready for this proctored assessment.", 0);
    const speechOk = await runGuidedSpeechCheck({
      maxDurationMs: 300000,
      scriptText: "I am ready for this proctored assessment.",
    });
    if (!speechOk) throw new Error("Speech verification failed. Speak clearly and retry.");
    p.precheckChecks.speakPromptDone = true;
    renderPrecheckChecklist("holdStillDone");
    await waitStepDwell();

    setPrecheckInstruction(
      "Step 4/4: Hold still and look at screen for 3 seconds.",
      "holdStillDone",
      "Stability check: keep eyes on screen and avoid head movement for 3 seconds.",
    );
    const stillOk = await runHoldStillCheck();
    if (!stillOk) throw new Error("Final stability check failed. Please re-run checks.");
    p.precheckChecks.holdStillDone = true;
    p.precheckReady = isPrecheckFullyComplete(p);
    p.precheckUnlockAtMs = Date.now() + 850;
    renderPrecheckChecklist("");
    setTimeout(() => updateAssessmentStartEligibility(), 900);
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "";
    if (el.apProctorHints) {
      el.apProctorHints.textContent = "All strict checks passed. Keep the same posture and environment during the assessment.";
    }
    setPrecheckInstruction(
      "All required checks are complete. Continue to the instructions page.",
      "",
      "",
    );
  } catch (err) {
    const elapsedMs = Date.now() - startedAtMs;
    if (retryCount < 1 && elapsedMs < 3500) {
      if (el.apProctorHints) el.apProctorHints.textContent = "Camera/microphone initializing. Retrying checks once...";
      setPrecheckInstruction(
        "Initializing devices. Retrying checks...",
        "",
        "",
      );
      return runProctoringPrecheck(retryCount + 1);
    }
    // Temporary production bypass requested: do not block the exam on pre-check failure.
    p.precheckReady = true;
    p.precheckBypassed = true;
    p.precheckChecks = {
      cameraReady: true,
      audioReady: true,
      speakPromptDone: true,
      holdStillDone: true,
    };
    p.environmentAttested = true;
    if (el.apEnvironmentAttest) el.apEnvironmentAttest.checked = true;
    p.precheckUnlockAtMs = Date.now();
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Pre-check bypass enabled temporarily. You can continue.";
    if (el.apProctorHints) el.apProctorHints.textContent = `Bypassed pre-check: ${err?.message || "technical check error"}`;
    setPrecheckInstruction(
      "Pre-check bypassed temporarily. Continue to instructions.",
      "",
      "",
    );
    renderPrecheckChecklist("");
    return;
  } finally {
    p.precheckInProgress = false;
    shutdownProctoringMedia();
    updateAssessmentStartEligibility();
  }
}

async function initializeProctoringForAssessmentStart() {
  const p = state.assessmentPreview.proctor;
  if (el.apPrecheckStatus) {
    el.apPrecheckStatus.textContent =
      "Starting camera/microphone and running lighting, face-clarity, and audio checks. Hold still for about 3 seconds...";
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  p.stream = stream;
  if (el.apProctorVideo) {
    el.apProctorVideo.srcObject = stream;
    // Keep proctor preview non-mirrored to match natural camera orientation.
    el.apProctorVideo.style.transform = "scaleX(1)";
    el.apProctorVideo.style.webkitTransform = "scaleX(1)";
    await el.apProctorVideo.play().catch(() => {});
  }
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    p.audioContext = audioContext;
    p.analyser = analyser;
  } catch {}
  try {
    p.faceModel = await ensureFaceLandmarker();
    p.faceModelError = "";
  } catch {
    p.faceModel = null;
    p.faceModelError = "Face model unavailable";
  }
  try {
    await ensurePhoneDetector();
    p.phoneModelReady = true;
  } catch {
    p.phoneModelReady = false;
  }
  try {
    p.handModel = await ensureHandLandmarker();
    p.handModelReady = true;
  } catch {
    p.handModel = null;
    p.handModelReady = false;
  }
  await new Promise((r) => setTimeout(r, 700));
  const baselineRmsSamples = [];
  const baselineAudioStarted = Date.now();
  while (Date.now() - baselineAudioStarted < 1200) {
    baselineRmsSamples.push(detectAudioRms());
    await new Promise((r) => setTimeout(r, 120));
  }
  if (baselineRmsSamples.length) {
    p.audioBaselineRms = baselineRmsSamples.reduce((a, b) => a + b, 0) / baselineRmsSamples.length;
  }
  const precheckSamples = await collectLivePrecheckQualitySamples(1800);
  const precheckSummary = summarizeLivePrecheckQuality(precheckSamples);
  renderLivePrecheckQualitySummary(precheckSummary);
  const calibrated = await runFaceCalibration();
  const brightness = await captureProctorBrightness();
  let faceOk = true;
  if (p.faceModel) {
    try {
      if (!isPlayableVideoElement(el.apProctorVideo)) throw new Error("Video stream not ready");
      const out = p.faceModel.detectForVideo(el.apProctorVideo, performance.now());
      const faceCount = out?.faceLandmarks?.length || 0;
      faceOk = faceCount === 1;
    } catch {
      faceOk = false;
    }
  }
  const lightOk = brightness >= 40;
  const calibrationOk = !p.faceModel || calibrated;
  const qualityFailure = getLivePrecheckFailureMessage(precheckSummary);
  if (!(lightOk && faceOk && calibrationOk) || qualityFailure) {
    if (qualityFailure) throw new Error(qualityFailure);
    if (!lightOk) throw new Error("Lighting is too low. Improve lighting and try again.");
    if (!faceOk) throw new Error("Face check failed. Keep only one face visible and centered.");
    throw new Error("Calibration failed. Keep still and look at screen.");
  }
  const baselineVideoOk = await captureAndUploadBaselineClip().catch(() => false);
  const baselinePhotoOk = await captureAndUploadProctorSnapshot("baseline", "candidate_calibrated").then(() => true).catch(() => false);
  p.baselineEvidenceReady = Boolean(baselineVideoOk && baselinePhotoOk);
  if (!p.baselineEvidenceReady) throw new Error("Baseline capture failed. Try again.");
  if (el.apPrecheckStatus) {
    el.apPrecheckStatus.textContent = "Pre-check passed: lighting, face visibility, and audio clarity are sufficient.";
  }
}

async function startAssessmentAfterPrecheck() {
  const p = state.assessmentPreview.proctor;
  if (p.startingUp) return;
  const precheckUnlocked = Boolean(p.precheckReady) && !p.precheckInProgress && Date.now() >= Number(p.precheckUnlockAtMs || 0);
  if (!p.environmentAttested && !p.precheckBypassed) {
    toast("Assessment cannot start while screen sharing or remote desktop tools may be active. Confirm the local-only environment first.", "error");
    return;
  }
  if (!precheckUnlocked) {
    toast("Pre-check not qualified yet. Re-run checks and wait until all checks pass.", "error");
    showPrecheckChecksPage();
    updateAssessmentStartEligibility();
    return;
  }
  p.startingUp = true;
  if (el.apStartTestBtn) el.apStartTestBtn.disabled = true;
  try {
    if (!(p.stream && p.baselineEvidenceReady && p.sessionId)) {
      if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Starting assessment... (1/3) Securing fullscreen";
      await ensureAssessmentFullscreen();
      if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Starting assessment... (2/3) Preparing secure session";
      await startServerProctorSession();
      if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Starting assessment... (3/3) Initializing proctor checks";
      await initializeProctoringForAssessmentStart();
    }
  } catch (err) {
    shutdownProctoringMedia();
    await finalizeServerProctorSession("start_failed").catch(() => {});
    p.sessionId = null;
    if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = err?.message || "Camera/microphone access is required for proctoring.";
    if (el.apProctorHints) el.apProctorHints.textContent = "Allow permissions and try starting the assessment again.";
    updateAssessmentStartEligibility();
    toast(err?.message || "Failed to start proctoring", "error");
    return;
  } finally {
    p.startingUp = false;
  }
  if (el.apPrecheckStatus) el.apPrecheckStatus.textContent = "Proctoring active. Assessment started.";
  if (el.apProctorHints) el.apProctorHints.textContent = "Keep face visible, stay in frame, avoid other voices, and do not switch tabs.";
  if (el.apPrecheckPanel) el.apPrecheckPanel.classList.add("hidden");
  if (el.apQuestionPanel) el.apQuestionPanel.classList.remove("hidden");
  if (el.apResultPanel) el.apResultPanel.classList.add("hidden");
  clearAttentionChallengeOverlay();
  renderAssessmentPreviewQuestion();
  startAssessmentPreviewTimer();
  startProctoringMonitoring();
  logProctorEvent("info", "assessment_started", {}).catch(() => {});
}

function confirmQuitAssessment() {
  const inProgress = !el.apQuestionPanel?.classList.contains("hidden") && el.apResultPanel?.classList.contains("hidden");
  if (!inProgress) {
    closeAssessmentPreview();
    return;
  }
  const quit = confirm("Do you want to quit the test?");
  if (!quit) return;
  showAssessmentPreviewResult("quit");
}

function closeAssessmentPreview() {
  clearAssessmentPreviewTimer();
  shutdownProctoringMedia();
  finalizeServerProctorSession("closed").catch(() => {});
  if (document.fullscreenElement === el.assessmentPreviewScreen && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  state.assessmentPreview = {
    mode: "preview",
    attemptId: null,
    exam: null,
    questions: [],
    index: 0,
    answers: {},
    latestResult: null,
    trainingFeedbackChoice: "",
    timerId: null,
    remainingSec: 0,
    timerPaused: false,
    questionRemainingByIndex: {},
    questionTimedOutByIndex: {},
    questionTimeTransitionInFlight: false,
    warningPauseCount: 0,
    proctor: defaultProctorState(),
  };
  clearAttentionChallengeOverlay();
  closeProctorWarningModal();
  renderTrainingFeedbackPanel(null);
  el.assessmentPreviewScreen?.classList.add("hidden");
}

function readCurrentPreviewAnswer() {
  return assessmentPreviewProctorUi.readCurrentPreviewAnswer();
}

async function onAssessmentQuestionTimerElapsed() {
  return assessmentPreviewProctorUi.onAssessmentQuestionTimerElapsed();
}

function renderAssessmentPreviewQuestion() {
  return assessmentPreviewProctorUi.renderAssessmentPreviewQuestion();
}

function setTrainingFeedbackChoice(choice) {
  return assessmentPreviewProctorUi.setTrainingFeedbackChoice(choice);
}

function trainingReviewEligible() {
  return assessmentPreviewProctorUi.trainingReviewEligible();
}

function renderTrainingFeedbackPanel(result = null) {
  return assessmentPreviewProctorUi.renderTrainingFeedbackPanel(result);
}

async function saveTrainingFeedback() {
  return assessmentPreviewProctorUi.saveTrainingFeedback();
}

function showAssessmentPreviewResult(reason = "completed") {
  clearAssessmentPreviewTimer();
  shutdownProctoringMedia();
  clearAttentionChallengeOverlay();
  const preview = state.assessmentPreview;
  if (preview.mode === "student_attempt") {
    if (el.apPrecheckPanel) el.apPrecheckPanel.classList.add("hidden");
    if (el.apQuestionPanel) el.apQuestionPanel.classList.add("hidden");
    if (el.apResultPanel) el.apResultPanel.classList.remove("hidden");
    (async () => {
      if (el.apResultSummary) el.apResultSummary.textContent = "Analyzing proctoring patterns and finalizing result...";
      const finalized = await finalizeServerProctorSession(reason).catch(() => null);
      const result = await api("POST", `/student/attempts/${preview.attemptId}/submit`);
      preview.latestResult = result;
      preview.trainingFeedbackChoice = result.training_feedback_status || "";
      const aiEval = finalized?.ai_evaluation || null;
      if (el.apResultSummary) {
        const hardFail = Boolean(result.proctor_hard_fail);
        const fairnessVerdict = result.proctor_hard_fail
          ? "UNFAIR"
          : result.proctor_review_required
            ? "REVIEW REQUIRED"
            : ["critical", "manual_review"].includes(String(result.proctor_decision || "").toLowerCase())
              ? "UNFAIR"
              : "FAIR";
        el.apResultSummary.innerHTML = `
          <div><strong>${hardFail ? "FAIL (Proctoring Violation)" : result.passed ? "PASS" : "FAIL"}</strong></div>
          <div style="margin-top:8px;">Percentage: ${Number(result.percentage || 0).toFixed(2)}%</div>
          <div>Correct: ${result.correct_count ?? "-"}</div>
          <div>Wrong: ${result.wrong_count ?? "-"}</div>
          <div>Proctor: ${(result.proctor_decision || aiEval?.decision || "clear").toUpperCase()}</div>
          <div>Assessment fairness: ${fairnessVerdict}</div>
          ${result.certificate?.certificate_id ? `
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid #dbe4f0;">
              <div><strong>Certificate Issued</strong></div>
              <div class="meta">Certificate ID: ${result.certificate.certificate_id}</div>
              <div class="actions" style="margin-top:8px;">
                ${result.certificate.download_url ? `<a class="btn small" href="${result.certificate.download_url}" target="_blank" rel="noreferrer">Download Certificate</a>` : ""}
              </div>
            </div>
          ` : ""}
          ${hardFail && result.proctor_hard_fail_reason ? `<div style="margin-top:8px;color:#b91c1c;"><strong>${result.proctor_hard_fail_reason}</strong></div>` : ""}
        `;
      }
      if (el.apWarningsSummary) {
        const prob = result.proctor_probability ?? aiEval?.final_probability;
        const ded = Number(result.proctor_deduction_pct || 0);
        const mode = result.proctor_deduction_mode || aiEval?.deduction_mode || "none";
        const probText = typeof prob === "number" ? `${(prob * 100).toFixed(1)}%` : "N/A";
        el.apWarningsSummary.textContent = `Warnings: ${preview.proctor.warnings} | Risk: ${probText} | Deduction: -${ded.toFixed(2)}% (${mode})${result.proctor_review_required ? " | Manual review required" : ""}`;
      }
      renderTrainingFeedbackPanel(result);
      logProctorEvent("info", "assessment_result_generated", {
        reason,
        pass: Boolean(result.passed),
        final_percentage: result.percentage,
        warnings: preview.proctor.warnings,
        proctor_decision: result.proctor_decision,
        proctor_probability: result.proctor_probability,
        proctor_deduction_pct: result.proctor_deduction_pct,
      }).catch(() => {});
    })().catch((err) => {
      if (el.apResultSummary) {
        el.apResultSummary.textContent = err?.message || "Failed to submit assessment.";
      }
    });
    return;
  }
  (async () => {
    await finalizeServerProctorSession(reason).catch(() => {});
    const exam = preview.exam;
    let correct = 0;
    let wrong = 0;
    let totalMarks = 0;
    let awarded = 0;
    for (const q of preview.questions) {
      const correctIds = (q.options || []).filter((o) => o.is_correct).map((o) => o.option_id).sort((a, b) => a - b);
      const selected = (preview.answers[q.question_id] || []).slice().sort((a, b) => a - b);
      totalMarks += Number(q.marks || 0);
      const isCorrect = selected.length === correctIds.length && selected.every((v, i) => v === correctIds[i]);
      if (isCorrect) {
        correct += 1;
        awarded += Number(q.marks || 0);
      } else {
        wrong += 1;
        if (exam?.negative_marking) awarded -= Math.abs(Number(q.negative_marks || 0));
      }
    }
    const percentage = totalMarks > 0 ? Math.max(0, (awarded / totalMarks) * 100) : 0;
    const warnings = preview.proctor.warnings;
    const penalty = warnings * Number(preview.proctor.penaltyPerWarningPct || 0);
    const finalPercentage = Math.max(0, percentage - penalty);
    const pass = finalPercentage >= Number(exam?.pass_score || 60);
    if (el.apPrecheckPanel) el.apPrecheckPanel.classList.add("hidden");
    if (el.apQuestionPanel) el.apQuestionPanel.classList.add("hidden");
    if (el.apResultPanel) el.apResultPanel.classList.remove("hidden");
    if (el.apResultSummary) {
      const fairnessVerdict = warnings >= 5 ? "REVIEW REQUIRED" : "FAIR";
      el.apResultSummary.innerHTML = `
      <div><strong>${pass ? "PASS" : "FAIL"}</strong></div>
      <div style="margin-top:8px;">Percentage: ${finalPercentage.toFixed(2)}%</div>
      <div>Correct: ${correct}</div>
      <div>Wrong: ${wrong}</div>
      <div>Assessment fairness: ${fairnessVerdict}</div>
    `;
    }
    if (el.apWarningsSummary) {
      el.apWarningsSummary.textContent = `Proctor warnings: ${warnings} | Penalty: -${penalty.toFixed(2)}%`;
    }
    preview.latestResult = {
      passed: pass,
      percentage: finalPercentage,
      training_feedback_status: null,
      training_feedback_comment: "",
      training_feedback_count: 0,
    };
    preview.trainingFeedbackChoice = "";
    const sid = preview.proctor?.sessionId;
    if (sid) {
      try {
        const fb = await api("GET", `/proctoring/sessions/${sid}/training-feedback/latest`);
        if (fb?.training_feedback_status) {
          preview.latestResult = {
            ...preview.latestResult,
            training_feedback_status: fb.training_feedback_status,
            training_feedback_comment: fb.training_feedback_comment || "",
            training_feedback_count: fb.training_feedback_count ?? 0,
          };
          preview.trainingFeedbackChoice = fb.training_feedback_status;
        }
      } catch {
        /* ignore missing prior labels */
      }
    }
    renderTrainingFeedbackPanel(preview.latestResult);
    logProctorEvent("info", "assessment_result_generated", {
      reason,
      pass,
      final_percentage: finalPercentage,
      warnings,
      penalty,
    }).catch(() => {});
  })().catch((err) => {
    if (el.apResultSummary) el.apResultSummary.textContent = err?.message || "Failed to show assessment result.";
  });
}

function startAssessmentPreviewTimer() {
  assessmentTimer.startAssessmentPreviewTimer();
}

async function openAssessmentPreview(examId) {
  const exam = state.providerAssessments.find((x) => Number(x.exam_id) === Number(examId));
  if (!exam) throw new Error("Assessment not found");
  let questions = await api("GET", `/exams/${examId}/questions`);
  if (!questions?.length) {
    let recovered = null;
    try {
      const raw = localStorage.getItem(ASSESSMENT_BUILDER_CACHE_KEY);
      if (raw) {
        const payload = JSON.parse(raw);
        const sameExam = Number(payload?.editingExamId || 0) === Number(examId);
        if (sameExam && Array.isArray(payload?.questions) && payload.questions.length > 0) {
          recovered = payload.questions.map((q, idx) => ({
            question_id: Number(q.question_id || (idx + 1)),
            question_text: String(q.question_text || ""),
            question_type: String(q.question_type || "mcq_single_correct"),
            marks: Number(q.marks || 1),
            negative_marks: Number(q.negative_marks || 0),
            options: Array.isArray(q.options) ? q.options.map((o, oIdx) => ({
              option_id: Number(o.option_id || (oIdx + 1)),
              option_text: String(o.option_text || ""),
              is_correct: Boolean(o.is_correct),
              position: Number(o.position || (oIdx + 1)),
            })) : [],
          }));
        }
      }
    } catch {}
    if (recovered?.length) {
      questions = recovered;
      toast("Using recovered local questions for preview. Save draft/publish to persist.");
    } else {
      throw new Error("No questions available for preview. Open Edit Draft and save questions first.");
    }
  }

  const mapped = questions.map((q) => ({
    question_id: q.question_id,
    question_text: q.question_text,
    question_type: q.question_type,
    marks: q.marks,
    negative_marks: q.negative_marks,
    options: (q.options || []).map((o) => ({ ...o })),
  }));
  if (exam.shuffle_questions) mapped.sort(() => Math.random() - 0.5);
  if (exam.questions_per_attempt > 0 && mapped.length > exam.questions_per_attempt) {
    mapped.length = exam.questions_per_attempt;
  }
  if (exam.shuffle_options) {
    mapped.forEach((q) => q.options.sort(() => Math.random() - 0.5));
  }

  state.assessmentPreview = {
    mode: "preview",
    attemptId: null,
    exam,
    questions: mapped,
    index: 0,
    answers: {},
    latestResult: null,
    trainingFeedbackChoice: "",
    timerId: null,
    remainingSec: 0,
    timerPaused: false,
    questionRemainingByIndex: {},
    questionTimedOutByIndex: {},
    questionTimeTransitionInFlight: false,
    warningPauseCount: 0,
    proctor: defaultProctorState(),
  };
  if (el.apEnvironmentAttest) el.apEnvironmentAttest.checked = false;
  if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "";
  showPrecheckChecksPage();
  updateAssessmentStartEligibility();
  if (el.apMeta) el.apMeta.textContent = `${exam.title} | ${exam.course_title}`;
  if (el.apPrecheckPanel) el.apPrecheckPanel.classList.remove("hidden");
  if (el.apQuestionPanel) el.apQuestionPanel.classList.add("hidden");
  if (el.apResultPanel) el.apResultPanel.classList.add("hidden");
  renderTrainingFeedbackPanel(null);
  el.assessmentPreviewScreen?.classList.remove("hidden");
  ensureScreenGazeModelWarm(state.assessmentPreview.proctor);
  refreshScreenGazeDebugBox(state.assessmentPreview.proctor);
  await runProctoringPrecheck();
  try {
    await ensureAssessmentFullscreen();
    await startServerProctorSession();
    await initializeProctoringForAssessmentStart();
    if (el.apPrecheckStatus) {
      el.apPrecheckStatus.textContent = "Camera and microphone are active. Complete checks, then click Next.";
    }
    if (el.apProctorHints) {
      el.apProctorHints.textContent = "Fullscreen is active. Keep face visible, stay centered, and confirm the environment before starting.";
    }
    await logProctorEvent("info", "preview_opened", { exam_id: examId }).catch(() => {});
  } catch (err) {
    shutdownProctoringMedia();
    await finalizeServerProctorSession("preview_open_failed").catch(() => {});
    state.assessmentPreview.proctor.sessionId = null;
    if (el.apPrecheckStatus) {
      el.apPrecheckStatus.textContent = err?.message || "Could not start fullscreen camera/microphone preview.";
    }
    if (el.apProctorHints) {
      el.apProctorHints.textContent = "Allow fullscreen and camera/microphone permissions, then try again.";
    }
    toast(err?.message || "Failed to start preview proctoring", "error");
  }
}

function openCourseViewer(courseId) {
  const course = state.providerCourses.find((c) => Number(c.id) === Number(courseId));
  if (!course) return toast("Course not found", "error");
  const lesson = findPrimaryLesson(course);
  const liveLessons = findLiveLessons(course);
  const host = el.providerCourseViewer;
  const studentViewer = el.studentCourseViewer;
  if (!host || !studentViewer) return toast("Viewer is unavailable", "error");
  if (!state.studentViewerOriginalParent) {
    state.studentViewerOriginalParent = studentViewer.parentElement;
    state.studentViewerOriginalNextSibling = studentViewer.nextSibling;
  }
  Array.from(host.children || []).forEach((child) => {
    if (child !== studentViewer) child.classList.add("hidden");
  });
  if (studentViewer.parentElement !== host) {
    host.appendChild(studentViewer);
  }
  state.providerUsingStudentViewer = true;
  $("providerCoursesHeader")?.classList.add("hidden");
  $("providerCoursesList")?.classList.add("hidden");
  $("providerDraftsPage")?.classList.add("hidden");
  $("courseWizard")?.classList.add("hidden");
  host.classList.remove("hidden");
  studentViewer.classList.remove("hidden");
  if ($("scvCloseBtn")) $("scvCloseBtn").textContent = "Back to My Courses";
  if (el.scvTitle) el.scvTitle.textContent = `${course.title} - Class Viewer`;
  if (el.scvMeta) el.scvMeta.textContent = `${course.category || "General"} | Provider Preview`;
  if (el.scvAssessmentStatus) el.scvAssessmentStatus.textContent = "Provider preview mode";
  if (el.scvAssessmentPanel) {
    el.scvAssessmentPanel.innerHTML = `<span id="scvAssessmentStatus" class="meta">Provider preview mode</span>`;
  }
  const scvVideo = $("scvVideo");
  const scvFrame = $("scvStreamFrame");
  setStudentViewerMode("legacy");
  stopStudentStreamHeartbeat();
  if (scvFrame) scvFrame.src = "";
  if (scvVideo && lesson?.recorded_video_url) {
    scvVideo.src = lesson.recorded_video_url;
    scvVideo.load();
  } else if (scvVideo) {
    scvVideo.removeAttribute("src");
    scvVideo.load();
  }
  state.studentViewerTopics = [...(lesson?.topics || [])];
  renderList(
    el.scvTopicList,
    [...(lesson?.topics || [])].sort((a, b) => Number(a.time_seconds || 0) - Number(b.time_seconds || 0)),
    (t) => `
      <div class="topic-item">
        ${t.thumbnail_data_url ? `<img src="${t.thumbnail_data_url}" alt="" style="width:100%;border-radius:8px;border:1px solid #e5e7eb; margin-bottom:6px;" />` : ""}
        <div><strong>${t.title}</strong></div>
        <div class="meta">${formatSecondsToClock(Number(t.time_seconds || 0))}</div>
        <div class="actions"><button class="btn small" data-provider-scv-seek="${Number(t.time_seconds || 0)}">Go</button></div>
      </div>
    `,
    lesson ? "No topics available for this lesson." : "No recorded-video topics available.",
  );
  const resources = Array.isArray(lesson?.resources) ? lesson.resources : [];
  renderList(
    el.scvResourceList,
    resources,
    (r) => `
      <div>
        <div><strong>${escapeHtmlAttr(r.title || "Resource")}</strong></div>
        <div class="actions"><a class="btn small" href="${escapeHtmlAttr(r.url || "#")}" target="_blank" rel="noopener noreferrer">Open</a></div>
      </div>
    `,
    "No resources added.",
  );
  document.querySelectorAll("[data-provider-scv-seek]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!scvVideo) return;
      scvVideo.currentTime = Number(btn.dataset.providerScvSeek || 0);
      scvVideo.play().catch(() => {});
    });
  });
  const timeline = $("scvTimelineMarkers");
  const tooltip = $("scvMarkerTooltip");
  const applyMarkers = () => {
    renderTimelineMarkers(
      timeline,
      tooltip,
      lesson?.topics || [],
      Number(scvVideo?.duration || 0),
      (seconds) => {
        if (!scvVideo) return;
        scvVideo.currentTime = seconds;
        scvVideo.play().catch(() => {});
      },
    );
  };
  if (lesson?.recorded_video_url) {
    scvVideo?.addEventListener("loadedmetadata", applyMarkers, { once: true });
    applyMarkers();
  } else if (timeline) {
    renderTimelineMarkers(timeline, tooltip, [], 0, () => {});
  }
}

function closeProviderUnifiedViewer() {
  const host = el.providerCourseViewer;
  const studentViewer = el.studentCourseViewer;
  if (host) {
    host.classList.add("hidden");
    Array.from(host.children || []).forEach((child) => {
      if (child !== studentViewer) child.classList.remove("hidden");
    });
  }
  if (studentViewer) {
    studentViewer.classList.add("hidden");
    if (state.studentViewerOriginalParent) {
      if (state.studentViewerOriginalNextSibling && state.studentViewerOriginalNextSibling.parentNode === state.studentViewerOriginalParent) {
        state.studentViewerOriginalParent.insertBefore(studentViewer, state.studentViewerOriginalNextSibling);
      } else {
        state.studentViewerOriginalParent.appendChild(studentViewer);
      }
    }
  }
  state.providerUsingStudentViewer = false;
  $("providerCoursesHeader")?.classList.remove("hidden");
  $("providerCoursesList")?.classList.remove("hidden");
}

async function openStudentCourseViewer(courseId) {
  const detail = await api("GET", `/student/courses/${courseId}/detail`);
  if ($("scvCloseBtn")) $("scvCloseBtn").textContent = "Back to Enrolled Courses";
  activateStudentSubView("course");
  stopStudentStreamHeartbeat();
  setStudentViewerMode("legacy");
  state.studentActiveCourseId = Number(courseId);
  state.studentVideoCompletionSent[Number(courseId)] = false;
  const lesson = findPrimaryLesson(detail);

  let streamReadyVideo = null;
  try {
    const streamPayload = await fetchStudentStreamPayload(courseId);
    streamReadyVideo = streamReadyVideoFromLessons(streamPayload?.lessons || []);
  } catch (err) {
    const parsed = parseApiErrorMessage(err);
    if (parsed.status && parsed.status !== 403 && parsed.status !== 404) {
      toast("Stream lessons are currently unavailable. Falling back to standard playback.", "error");
    }
  }

  const useStreamPlayback = Boolean(streamReadyVideo);
  if (!lesson?.recorded_video_url && !useStreamPlayback) {
    throw new Error("No recorded lesson available for this course.");
  }

  const video = $("scvVideo");
  const hasRecordedLesson = Boolean(lesson?.recorded_video_url);
  const hasPlayableLesson = hasRecordedLesson || useStreamPlayback;
  if (video && hasRecordedLesson && !useStreamPlayback) {
    video.src = lesson.recorded_video_url;
    video.load();
  } else if (video) {
    video.pause?.();
    video.removeAttribute("src");
    video.load();
  }
  if (el.scvTitle) el.scvTitle.textContent = `${detail.title} - Course Viewer`;
  if (el.scvMeta) el.scvMeta.textContent = `${detail.category || "General"} | ${detail.description || ""}`.trim();
  const progressPct = Number(detail.progress_pct || 0);
  ensureStudentPlaybackPolicy(courseId, progressPct);
  if (el.scvProgressBar) el.scvProgressBar.style.width = `${Math.max(0, Math.min(100, progressPct))}%`;
  if (el.scvProgressText) el.scvProgressText.textContent = `${progressPct.toFixed(0)}%`;
  if (el.scvCourseRatingSummary) {
    el.scvCourseRatingSummary.textContent = formatCourseRating(detail.average_rating, detail.rating_count);
  }
  const myFeedback = detail.my_feedback || {};
  if (el.scvRateValue) el.scvRateValue.value = String(myFeedback.valuable_time_rating || 5);
  if (el.scvRateContent) el.scvRateContent.value = String(myFeedback.content_quality_rating || 5);
  if (el.scvRateClarity) el.scvRateClarity.value = String(myFeedback.instructor_clarity_rating || 5);
  if (el.scvRatePractical) el.scvRatePractical.value = String(myFeedback.practical_usefulness_rating || 5);
  if (el.scvRatingComment) el.scvRatingComment.value = String(myFeedback.comment || "");
  const canRateCourse = Boolean(detail.assessment_completed);
  if (el.scvSaveRatingBtn) el.scvSaveRatingBtn.disabled = !canRateCourse;
  if (el.scvRatingStatus) {
    if (!canRateCourse) {
      el.scvRatingStatus.textContent = "Complete at least one assessment attempt to enable rating.";
    } else if (myFeedback.feedback_id) {
      el.scvRatingStatus.textContent = `Your latest rating is saved (${Number(myFeedback.overall_rating || 0).toFixed(1)}/5).`;
    } else {
      el.scvRatingStatus.textContent = "";
    }
  }
  renderList(
    el.scvTopicList,
    [...(lesson?.topics || [])].sort((a, b) => a.time_seconds - b.time_seconds),
    (t) => `
      <div class="topic-item" data-topic-item="${t.time_seconds}">
        ${t.thumbnail_data_url ? `<img src="${t.thumbnail_data_url}" alt="" style="width:100%;border-radius:8px;border:1px solid #e5e7eb; margin-bottom:6px;" />` : ""}
        <div><strong>${t.title}</strong></div>
        <div class="meta">${formatSecondsToClock(t.time_seconds)}</div>
        <div class="actions"><button class="btn small" data-scv-seek="${t.time_seconds}" ${useStreamPlayback ? "disabled" : ""}>Go</button></div>
      </div>
    `,
    hasPlayableLesson ? "No topics available for this lesson." : "No recorded lesson topics available.",
  );
  const resources = lesson?.resources || [];
  renderList(
    el.scvResourceList,
    resources,
    (r) => `<div><a href="${r.url}" target="_blank" rel="noreferrer">${r.title || r.url}</a></div><div class="meta">${r.resource_type || "attachment"}</div>`,
    hasPlayableLesson ? "No resources attached." : "No lesson resources attached.",
  );
  state.studentViewerTopics = [...(lesson?.topics || [])];
  document.querySelectorAll("[data-scv-seek]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (useStreamPlayback) {
        toast("Topic jump is disabled for secure Stream playback.", "error");
        return;
      }
      if (!video) return;
      const target = Number(btn.dataset.scvSeek || 0);
      if (!canStudentSeekTo(target, Number(video.currentTime || 0))) {
        maybeShowStudentSeekLockHint();
        return;
      }
      video.currentTime = target;
      video.play().catch(() => {});
    });
  });
  const videoShell = $("scvVideoShell");
  const timeline = $("scvTimelineMarkers");
  const tooltip = $("scvMarkerTooltip");
  if (videoShell) videoShell.classList.toggle("hidden", !hasPlayableLesson);
  videoShell?.classList.remove("minimized");
  if (tooltip) tooltip.classList.add("hidden");
  refreshStudentSeekUi();
  el.studentCourseViewer?.classList.remove("hidden");
  await refreshStudentAssessmentPanel(courseId, {
    examEligible: Boolean(detail.exam_eligible),
    assessmentAvailable: Boolean(detail.assessment_available),
    publishedAssessments: Number(detail.published_assessments || 0),
    hasRecordedLesson: hasPlayableLesson,
    progressPct: Number(detail.progress_pct || 0),
  });
  const applyMarkers = () => {
    renderTimelineMarkers(
      timeline,
      tooltip,
      lesson?.topics || [],
      Number(video?.duration || 0),
      (seconds) => {
        if (useStreamPlayback) return;
        if (!video) return;
        if (!canStudentSeekTo(Number(seconds || 0), Number(video.currentTime || 0))) {
          maybeShowStudentSeekLockHint();
          return;
        }
        video.currentTime = seconds;
        video.play().catch(() => {});
      },
    );
  };
  if (useStreamPlayback) {
    renderTimelineMarkers(timeline, tooltip, [], 0, () => {});
    try {
      await startStudentStreamPlayback(courseId, streamReadyVideo);
    } catch (err) {
      const parsed = parseApiErrorMessage(err);
      const detailPayload = parsed.detail;
      if (detailPayload?.credits_required) {
        throw new Error(detailPayload?.message || "Maximum watch allowance reached. Buy credits to continue.");
      }
      throw new Error(
        (typeof detailPayload === "string" && detailPayload)
        || detailPayload?.message
        || err?.message
        || "Unable to start Stream playback.",
      );
    }
  } else if (hasRecordedLesson) {
    video?.addEventListener("loadedmetadata", applyMarkers, { once: true });
    applyMarkers();
  } else if (timeline) {
    renderTimelineMarkers(timeline, tooltip, [], 0, () => {});
  }
}

async function refreshStudentAssessmentPanel(courseId, options = {}) {
  if (!el.scvAssessmentPanel) return;
  let examEligible = Boolean(options.examEligible);
  let assessmentAvailable = Boolean(options.assessmentAvailable);
  let publishedAssessments = Number(options.publishedAssessments || 0);
  const hasRecordedLesson = Boolean(options.hasRecordedLesson);
  const progressPct = Number(options.progressPct || 0);

  if (!examEligible && progressPct >= 90) {
    try {
      await api("POST", `/student/courses/${courseId}/complete`);
      examEligible = true;
      if (el.scvProgressBar) el.scvProgressBar.style.width = `${Math.max(90, Math.min(100, progressPct))}%`;
      if (el.scvProgressText) el.scvProgressText.textContent = `${Math.max(90, Math.min(100, progressPct)).toFixed(0)}%`;
    } catch {}
  }

  if (!examEligible) {
    const canManualUnlock = progressPct >= 90 || !hasRecordedLesson;
    el.scvAssessmentPanel.innerHTML = `
      <span id="scvAssessmentStatus" class="meta">${
        hasRecordedLesson
          ? "Watch at least 90% of the video to unlock assessment."
          : "Complete this course to unlock assessment."
      }</span>
      ${canManualUnlock ? '<button class="btn small" id="scvUnlockAssessmentBtn">Unlock Assessment</button>' : ""}
    `;
    $("scvUnlockAssessmentBtn")?.addEventListener("click", async () => {
      try {
        await api("POST", `/student/courses/${courseId}/complete`);
        const displayPct = Math.max(90, Math.min(100, progressPct));
        if (el.scvProgressBar) el.scvProgressBar.style.width = `${displayPct}%`;
        if (el.scvProgressText) el.scvProgressText.textContent = `${displayPct.toFixed(0)}%`;
        await refreshStudentAssessmentPanel(courseId, {
          examEligible: true,
          hasRecordedLesson,
          progressPct: displayPct,
        });
        refreshStudentDashboard().catch(() => {});
        toast("Assessment unlocked");
      } catch (err) {
        toast(err?.message || "Failed to unlock assessment", "error");
      }
    });
    return;
  }
  const out = await api("POST", `/student/courses/${courseId}/assessment-intent?ready=true`);
  const exams = out.exams || [];
  if (out?.assessment_status) assessmentAvailable = out.assessment_status === "available";
  if (Number.isFinite(Number(out?.published_assessments))) {
    publishedAssessments = Number(out.published_assessments || 0);
  }
  if (!exams.length) {
    el.scvAssessmentPanel.innerHTML = "";
    return;
  }
  el.scvAssessmentPanel.innerHTML = exams
    .map((e) => `<button class="btn primary" data-student-start-exam="${e.exam_id}">Start Assessment: ${e.title}</button>`)
    .join("");
  document.querySelectorAll("[data-student-start-exam]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await openStudentAssessmentAttempt(Number(btn.dataset.studentStartExam));
      } catch (err) {
        toast(err?.message || "Failed to start assessment", "error");
      }
    });
  });
}

async function openStudentAssessmentAttempt(examId) {
  const start = await api("POST", `/student/exams/${examId}/attempts/start`);
  const paper = await api("GET", `/student/attempts/${start.attempt_id}/paper`);
  const mapped = (paper.questions || []).map((q) => ({
    question_id: q.question_id,
    question_text: q.question_text,
    question_type: q.question_type,
    marks: q.marks,
    negative_marks: q.negative_marks,
    options: (q.options || []).map((o) => ({ ...o })),
  }));
  state.assessmentPreview = {
    mode: "student_attempt",
    attemptId: start.attempt_id,
    exam: {
      exam_id: paper.exam_id,
      title: paper.title,
      course_title: "Assessment",
      timing_mode: paper.timing_mode,
      duration_minutes: paper.duration_minutes,
      time_per_question_seconds: paper.time_per_question_seconds,
      pass_score: paper.pass_score,
      negative_marking: paper.negative_marking,
      shuffle_questions: false,
      shuffle_options: false,
    },
    questions: mapped,
    index: 0,
    answers: {},
    latestResult: null,
    trainingFeedbackChoice: "",
    timerId: null,
    remainingSec: 0,
    timerPaused: false,
    questionRemainingByIndex: {},
    questionTimedOutByIndex: {},
    questionTimeTransitionInFlight: false,
    warningPauseCount: 0,
    proctor: defaultProctorState(),
  };
  if (el.apEnvironmentAttest) el.apEnvironmentAttest.checked = false;
  if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "";
  showPrecheckChecksPage();
  updateAssessmentStartEligibility();
  if (el.apMeta) el.apMeta.textContent = `${paper.title}`;
  if (el.apPrecheckPanel) el.apPrecheckPanel.classList.remove("hidden");
  if (el.apQuestionPanel) el.apQuestionPanel.classList.add("hidden");
  if (el.apResultPanel) el.apResultPanel.classList.add("hidden");
  renderTrainingFeedbackPanel(null);
  el.assessmentPreviewScreen?.classList.remove("hidden");
  ensureScreenGazeModelWarm(state.assessmentPreview.proctor);
  refreshScreenGazeDebugBox(state.assessmentPreview.proctor);
  await runProctoringPrecheck();
}

async function persistCurrentStudentAttemptAnswer() {
  const preview = state.assessmentPreview;
  if (preview.mode !== "student_attempt" || !preview.attemptId) return;
  const current = preview.questions[preview.index];
  if (!current) return;
  const selected = preview.answers[current.question_id] || [];
  await api("POST", `/student/attempts/${preview.attemptId}/answers`, {
    question_id: current.question_id,
    selected_option_ids: selected,
    text_answer: null,
  });
}

function renderProviderAssessmentsList() {
  const q = String(el.providerAssessmentsSearch?.value || "").trim().toLowerCase();
  const rows = q
    ? state.providerAssessments.filter((a) => {
      const blob = `${a.title || ""} ${a.exam_id || ""} ${a.status || ""} ${a.assessment_type || ""}`.toLowerCase();
      return blob.includes(q);
    })
    : state.providerAssessments;
  renderList(
    el.providerAssessmentsList,
    rows,
    (a) => renderAssessmentCard({ ...a, internal_id: `ASM-${String(a.exam_id || "").padStart(6, "0")}` }, { source: "custom" }),
    "No assessments yet.",
  );
  document.querySelectorAll("[data-assessment-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCustomAssessmentDetail(Number(btn.dataset.assessmentDetail || 0));
    });
  });
}

function assessmentTypeLabel(value) {
  const map = {
    mcq: "MCQ",
    coding: "Coding",
    spreadsheet: "Spreadsheet",
    tax_simulator: "Tax simulator",
    case_study: "Case study",
  };
  return map[String(value || "mcq")] || "Assessment";
}

function assessmentStudentQuestionCount(a) {
  const type = String(a?.assessment_type || "mcq");
  if (type !== "mcq") return Number(a?.total_marks || a?.task?.marks || 0);
  const n = Number(a?.questions_per_attempt || a?.question_count || 0);
  return Number.isFinite(n) ? n : 0;
}

function assessmentIconSvg(kind) {
  const icons = {
    type: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h10"/></svg>`,
    questions: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h8"/><path d="M8 12h5"/><path d="M6 3h12a2 2 0 0 1 2 2v14l-4-2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>`,
    issued: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"/><path d="m4 8 8 5 8-5"/></svg>`,
    taken: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6"/><path d="M4 20h16"/></svg>`,
    pass: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z"/><path d="M9 12l2 2 4-5"/></svg>`,
  };
  return icons[kind] || icons.type;
}

function assessmentTimingText(a) {
  return String(a?.timing_mode || "assessment") === "question"
    ? `${Number(a?.time_per_question_seconds || 0)}s/question`
    : `${Number(a?.duration_minutes || 0)} mins`;
}

function renderAssessmentCard(a, { source = "catalog" } = {}) {
  const selected = Number(state.selectedCatalogExamId || 0) === Number(a.exam_id || 0)
    && (source !== "custom" || state.selectedAssessmentSource === "custom");
  const status = String(a.status || (source === "catalog" ? "published" : "draft"));
  const type = String(a.assessment_type || "mcq");
  const count = assessmentStudentQuestionCount(a);
  const countLabel = type === "mcq" ? `${count} ${count === 1 ? "question" : "questions"}` : `${count} marks`;
  const about = String(a.about || a.instructions || "").trim();
  return `
    <article class="assessment-card ${selected ? "selected-catalog-card" : ""}">
      <div class="assessment-card-top">
        <div class="assessment-card-title-wrap">
          <div class="assessment-card-kicker">ID ${escapeHtmlAttr(a.internal_id || `ASM-${String(a.exam_id || "").padStart(6, "0")}`)}</div>
          <h3>${escapeHtmlAttr(a.title || `Assessment #${a.exam_id}`)}</h3>
          ${about ? `<p>${escapeHtmlAttr(about)}</p>` : ""}
        </div>
        <div class="assessment-card-score">${Number(a.pass_score || 70)}%</div>
      </div>
      <div class="assessment-card-chips">
        <span>${assessmentIconSvg("type")}${escapeHtmlAttr(assessmentTypeLabel(type))}</span>
        <span>${assessmentIconSvg("questions")}${escapeHtmlAttr(countLabel)}</span>
        <span class="dark">${assessmentIconSvg("clock")}${escapeHtmlAttr(assessmentTimingText(a))}</span>
        <span>${assessmentIconSvg("issued")}Issued ${Number(a.issued_count || 0)}</span>
        <span>${assessmentIconSvg("taken")}Taken ${Number(a.taken_count || 0)}</span>
      </div>
      <div class="assessment-card-footer">
        <span class="status-pill ${status === "published" ? "status-resolved" : "status-open"}">${escapeHtmlAttr(status)}</span>
        <button class="btn small assessment-view-btn" data-${source === "custom" ? "assessment-detail" : "catalog-select"}="${a.exam_id}">View</button>
      </div>
    </article>
  `;
}

async function openStudentAvailableCourseDetail(courseId) {
  const cid = Number(courseId || 0);
  if (!cid) return;
  const detail = await api("GET", `/student/courses/${cid}/detail`);
  state.studentAvailableDetailCourseId = cid;
  renderStudentAvailableCourseScreen(detail, el);
  const introUrl = String(detail?.intro_video_url || "").trim();
  if (el.studentAvailableCoursePreviewVideo) {
    const player = el.studentAvailableCoursePreviewVideo;
    try { player.pause(); } catch {}
    player.controls = false;
    player.muted = true;
    player.removeAttribute("autoplay");
    player.style.pointerEvents = "none";
    player.src = "";
    player.load();
  }
  if (el.studentAvailableIntroVideo) {
    const intro = el.studentAvailableIntroVideo;
    try { intro.pause(); } catch {}
    intro.removeAttribute("autoplay");
    intro.muted = false;
    intro.src = introUrl || "";
    intro.load();
  }
  if (el.studentAvailableIntroMeta) {
    el.studentAvailableIntroMeta.textContent = introUrl
      ? "Intro video is available before enrollment."
      : "No intro video available for this course.";
  }
  activateStudentSubView("available-course");
}

function setProviderFeedbackTab(tab) {
  const nextTab = tab === "complaints" ? "complaints" : "feedback";
  const prevTab = state.providerFeedbackTab;
  state.providerFeedbackTab = nextTab;
  document.querySelectorAll("[data-provider-fc-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-provider-fc-tab") === state.providerFeedbackTab);
  });
  el.providerFeedbackTiles?.classList.toggle("hidden", state.providerFeedbackTab !== "feedback");
  el.providerComplaintTiles?.classList.toggle("hidden", state.providerFeedbackTab !== "complaints");
  if (prevTab !== nextTab) {
    state.providerFeedbackDetailMode = "";
    state.providerComplaintsDetailStatus = "";
    el.providerFeedbackHub?.classList.remove("hidden");
    el.providerFeedbackDetailPage?.classList.add("hidden");
    el.providerComplaintsDetailPage?.classList.add("hidden");
    return;
  }
  if (!state.providerFeedbackDetailMode && !state.providerComplaintsDetailStatus) {
    el.providerFeedbackHub?.classList.remove("hidden");
    el.providerFeedbackDetailPage?.classList.add("hidden");
    el.providerComplaintsDetailPage?.classList.add("hidden");
  }
}

function openProviderFeedbackDetail(mode) {
  state.providerFeedbackDetailMode = mode === "old" ? "old" : "new";
  state.providerComplaintsDetailStatus = "";
  el.providerFeedbackHub?.classList.add("hidden");
  el.providerFeedbackDetailPage?.classList.remove("hidden");
  el.providerComplaintsDetailPage?.classList.add("hidden");
}

function openProviderComplaintsDetail(status) {
  const normalized = ["new", "pending", "closed"].includes(String(status)) ? String(status) : "new";
  state.providerComplaintsDetailStatus = normalized;
  state.providerFeedbackDetailMode = "";
  el.providerFeedbackHub?.classList.add("hidden");
  el.providerFeedbackDetailPage?.classList.add("hidden");
  el.providerComplaintsDetailPage?.classList.remove("hidden");
}

function closeProviderFeedbackDetails() {
  state.providerFeedbackDetailMode = "";
  state.providerComplaintsDetailStatus = "";
  el.providerFeedbackHub?.classList.remove("hidden");
  el.providerFeedbackDetailPage?.classList.add("hidden");
  el.providerComplaintsDetailPage?.classList.add("hidden");
}

function renderProviderFeedbackHub() {
  const ratings = Array.isArray(state.providerFeedbackRatings) ? state.providerFeedbackRatings : [];
  const complaints = Array.isArray(state.providerComplaints) ? state.providerComplaints : [];
  const newFeedback = ratings.filter((r) => !r.provider_seen_at);
  const oldFeedback = ratings.filter((r) => r.provider_seen_at);
  const avg = ratings.length
    ? (ratings.reduce((sum, r) => sum + Number(r.overall_rating || 0), 0) / ratings.length)
    : 0;
  if (el.providerFeedbackNewCount) el.providerFeedbackNewCount.textContent = String(newFeedback.length);
  if (el.providerFeedbackAvgBadge) el.providerFeedbackAvgBadge.textContent = avg.toFixed(1);
  if (el.providerComplaintNewCount) el.providerComplaintNewCount.textContent = String(complaints.filter((c) => (c.provider_status || "new") === "new").length);
  if (el.providerComplaintPendingCount) el.providerComplaintPendingCount.textContent = String(complaints.filter((c) => c.provider_status === "pending").length);
  if (el.providerComplaintClosedCount) el.providerComplaintClosedCount.textContent = String(complaints.filter((c) => c.provider_status === "closed").length);
}

function renderProviderFeedbackDetail() {
  const mode = state.providerFeedbackDetailMode === "old" ? "old" : "new";
  if (el.providerFeedbackDetailTitle) {
    el.providerFeedbackDetailTitle.textContent = mode === "new" ? "New Feedback" : "Old Feedback";
  }
  const items = (state.providerFeedbackRatings || []).filter((r) => (mode === "new" ? !r.provider_seen_at : Boolean(r.provider_seen_at)));
  renderList(
    el.providerFeedbackDetailList,
    items,
    (r) => `
      <div><strong>${escapeHtmlAttr(r.course_title || "Course")}</strong> - ${escapeHtmlAttr(r.student_name || "Student")}</div>
      <div class="meta">Overall: ${Number(r.overall_rating || 0).toFixed(1)}/5 | Valuable: ${r.valuable_time_rating}/5 | Content: ${r.content_quality_rating}/5 | Clarity: ${r.instructor_clarity_rating}/5 | Practical: ${r.practical_usefulness_rating}/5</div>
      <div style="margin-top:4px;">${escapeHtmlAttr(r.comment || "No comment")}</div>
      <div class="meta">${formatTime(r.created_at)}</div>
      <div class="meta">Reply: ${escapeHtmlAttr(r.provider_reply || "No reply yet")}</div>
      <div class="actions">
        <button class="btn small" data-provider-feedback-reply="${r.feedback_id}">Reply</button>
        ${mode === "new" ? `<button class="btn small" data-provider-feedback-mark-old="${r.feedback_id}">Mark Seen</button>` : ""}
      </div>
    `,
    mode === "new" ? "No new feedback." : "No old feedback yet.",
  );
  document.querySelectorAll("[data-provider-feedback-reply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const feedbackId = Number(btn.getAttribute("data-provider-feedback-reply") || 0);
      if (!feedbackId) return;
      const reply = prompt("Reply to student");
      if (!reply) return;
      try {
        await api("POST", `/provider/workspace/feedback/ratings/${feedbackId}/reply`, { reply });
        toast("Reply sent");
        await refreshProviderFeedback();
      } catch (err) {
        toast(err?.message || "Failed to reply", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-feedback-mark-old]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const feedbackId = Number(btn.getAttribute("data-provider-feedback-mark-old") || 0);
      if (!feedbackId) return;
      try {
        await api("POST", `/provider/workspace/feedback/ratings/${feedbackId}/seen`, { seen: true });
        await refreshProviderFeedback();
      } catch (err) {
        toast(err?.message || "Failed to mark feedback as seen", "error");
      }
    });
  });
}

async function refreshProviderAssessments() {
  const list = await api("GET", "/provider/workspace/assessments");
  state.providerAssessments = Array.isArray(list) ? list : [];
  renderProviderAssessmentsList();
}

async function refreshAssessmentCatalogIssueOptions() {
  try {
    const params = new URLSearchParams();
    const q = String(el.assessmentCatalogSearch?.value || state.assessmentCatalogQuery || "").trim();
    const duration = String(el.assessmentCatalogDuration?.value || state.assessmentCatalogDuration || "all");
    const sort = String(el.assessmentCatalogSort?.value || state.assessmentCatalogSort || "latest");
    state.assessmentCatalogQuery = q;
    state.assessmentCatalogDuration = duration;
    state.assessmentCatalogSort = sort;
    if (q) params.set("q", q);
    params.set("duration", duration);
    params.set("sort", sort);
    const rows = await api("GET", `/exams/catalog/published?${params.toString()}`);
    const items = Array.isArray(rows) ? rows : [];
    state.assessmentCatalog = items;
    if (state.selectedCatalogExamId && !items.some((x) => Number(x.exam_id) === Number(state.selectedCatalogExamId))) {
      state.selectedCatalogExamId = null;
      renderSelectedCatalogDetail();
    }
    renderAssessmentCatalogList();
  } catch {
    state.assessmentCatalog = [];
    renderAssessmentCatalogList();
  }
}

function renderAssessmentCatalogList() {
  if (!el.assessmentCatalogList) return;
  const rows = Array.isArray(state.assessmentCatalog) ? state.assessmentCatalog : [];
  renderList(
    el.assessmentCatalogList,
    rows,
    (a) => renderAssessmentCard({ ...a, status: "published" }, { source: "catalog" }),
    "No published assessments available.",
  );
  document.querySelectorAll("[data-catalog-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const examId = Number(btn.getAttribute("data-catalog-select") || 0);
      state.selectedCatalogExamId = examId || null;
      openAssessmentCatalogDetail(examId);
    });
  });
}

function openAssessmentCatalogDetail(examId) {
  const selected = Number(examId || 0);
  if (!selected) return;
  state.selectedCatalogExamId = selected;
  state.selectedAssessmentSource = "catalog";
  if (el.issueCandidateName) el.issueCandidateName.value = "";
  if (el.issueCandidateEmail) el.issueCandidateEmail.value = "";
  if (el.issueAssessmentStatus) el.issueAssessmentStatus.textContent = "";
  activateProviderSubView("assessment-detail");
}

function openCustomAssessmentDetail(examId) {
  const selected = Number(examId || 0);
  if (!selected) return;
  state.selectedCatalogExamId = selected;
  state.selectedAssessmentSource = "custom";
  if (el.issueCandidateName) el.issueCandidateName.value = "";
  if (el.issueCandidateEmail) el.issueCandidateEmail.value = "";
  if (el.issueAssessmentStatus) el.issueAssessmentStatus.textContent = "";
  activateProviderSubView("assessment-detail");
}

function getSelectedAssessmentDetailItem() {
  const selected = Number(state.selectedCatalogExamId || 0);
  if (!selected) return null;
  const providerItem = (state.providerAssessments || []).find((x) => Number(x.exam_id) === selected);
  if (state.selectedAssessmentSource === "custom" && providerItem) {
    return { ...providerItem, internal_id: `ASM-${String(providerItem.exam_id || "").padStart(6, "0")}` };
  }
  return (state.assessmentCatalog || []).find((x) => Number(x.exam_id) === selected)
    || (providerItem ? { ...providerItem, internal_id: `ASM-${String(providerItem.exam_id || "").padStart(6, "0")}` } : null);
}

function bindAssessmentDetailActions(item) {
  $("assessmentDetailPreviewBtn")?.addEventListener("click", async () => {
    try {
      await openAssessmentPreview(Number(item.exam_id || 0));
    } catch (err) {
      toast(err?.message || "Failed to open assessment preview", "error");
    }
  });
  $("assessmentDetailEditBtn")?.addEventListener("click", async () => {
    try {
      await openAssessmentBuilderForEdit(item);
    } catch {
      toast("Failed to open draft for editing", "error");
    }
  });
  $("assessmentDetailPublishBtn")?.addEventListener("click", async () => {
    try {
      await api("POST", `/exams/${item.exam_id}/publish`);
      toast("Assessment published");
      await refreshProviderAssessments();
      await refreshAssessmentCatalogIssueOptions();
      renderSelectedCatalogDetail();
    } catch (err) {
      const parsed = parseApiErrorMessage(err);
      const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail || {});
      toast(`Failed to publish assessment${detail ? `: ${detail}` : ""}`, "error");
    }
  });
  $("assessmentDetailDeleteBtn")?.addEventListener("click", async () => {
    const ok = confirm("Delete this draft assessment?");
    if (!ok) return;
    try {
      await api("DELETE", `/exams/${item.exam_id}`);
      toast("Draft deleted");
      state.selectedCatalogExamId = null;
      await refreshProviderAssessments();
      activateProviderSubView("assessments");
    } catch (err) {
      toast(err?.message || "Failed to delete draft", "error");
    }
  });
}

function renderSelectedCatalogDetail() {
  if (!el.assessmentCatalogDetail) return;
  const item = getSelectedAssessmentDetailItem();
  if (!item) {
    el.assessmentCatalogDetail.textContent = "Select an assessment from the list above.";
    if (el.assessmentDetailTitle) el.assessmentDetailTitle.textContent = "Assessment Details";
    if (el.assessmentDetailPassBadge) el.assessmentDetailPassBadge.textContent = "70%";
    if (el.assessmentDetailActions) el.assessmentDetailActions.innerHTML = "";
    if (el.issueAssessmentBtn) el.issueAssessmentBtn.disabled = true;
    return;
  }
  const status = String(item.status || "published").toLowerCase();
  const timing = String(item.timing_mode || "assessment") === "question"
    ? `${Number(item.time_per_question_seconds || 0)} seconds per question`
    : `${Number(item.duration_minutes || 0)} minutes total`;
  const contentSummary = String(item.assessment_type || "mcq") === "mcq"
    ? `${assessmentStudentQuestionCount(item)} ${assessmentStudentQuestionCount(item) === 1 ? "question" : "questions"}`
    : `${assessmentTypeLabel(item.assessment_type)} | ${Number(item.total_marks || item.task?.marks || 0)} marks`;
  const tools = Array.isArray(item.tools) && item.tools.length ? item.tools : ["Standard browser"];
  const topics = Array.isArray(item.topics) && item.topics.length ? item.topics : ["General assessment"];
  const about = String(item.about || item.instructions || "Assessment details are not available yet.").trim();
  if (el.assessmentDetailTitle) el.assessmentDetailTitle.textContent = item.title || `Assessment #${item.exam_id}`;
  if (el.assessmentDetailPassBadge) el.assessmentDetailPassBadge.textContent = `${Number(item.pass_score || 70)}%`;
  el.assessmentCatalogDetail.innerHTML = `
    <div class="assessment-detail-summary">
      <div class="assessment-detail-id">Internal ID ${escapeHtmlAttr(item.internal_id || `ASM-${String(item.exam_id || "").padStart(6, "0")}`)}</div>
      <p>${escapeHtmlAttr(about)}</p>
      <div class="assessment-detail-metrics">
        <span>${assessmentIconSvg("type")} ${escapeHtmlAttr(assessmentTypeLabel(item.assessment_type))}</span>
        <span>${assessmentIconSvg("questions")} ${escapeHtmlAttr(contentSummary)}</span>
        <span>${assessmentIconSvg("clock")} ${escapeHtmlAttr(timing)}</span>
        <span>${assessmentIconSvg("pass")} Pass mark ${Number(item.pass_score || 70)}%</span>
      </div>
      <div class="assessment-detail-sections">
        <div>
          <h4>Tools used</h4>
          <ul>${tools.map((x) => `<li>${escapeHtmlAttr(x)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Topics included</h4>
          <ul>${topics.map((x) => `<li>${escapeHtmlAttr(x)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>Instructions</h4>
          <p>${escapeHtmlAttr(item.instructions || "Follow the assessment instructions shown before starting.")}</p>
        </div>
      </div>
    </div>
  `;
  if (el.assessmentDetailActions) {
    el.assessmentDetailActions.innerHTML = `
      ${String(item.assessment_type || "mcq") === "mcq" ? `<button class="btn small" id="assessmentDetailPreviewBtn">Preview</button>` : ""}
      ${
        status === "published"
          ? ""
          : `<button class="btn small" id="assessmentDetailEditBtn">Edit Draft</button>
             <button class="btn small" id="assessmentDetailPublishBtn">Publish</button>
             <button class="btn small danger" id="assessmentDetailDeleteBtn">Delete Draft</button>`
      }
    `;
    bindAssessmentDetailActions(item);
  }
  if (el.issueAssessmentBtn) el.issueAssessmentBtn.disabled = status !== "published";
  if (el.issueAssessmentStatus && status !== "published") {
    el.issueAssessmentStatus.textContent = "Publish this assessment before issuing it to a candidate.";
  } else if (el.issueAssessmentStatus && el.issueAssessmentStatus.textContent.startsWith("Publish this assessment")) {
    el.issueAssessmentStatus.textContent = "";
  }
}

async function refreshIssuedAssessments() {
  try {
    const rows = await api("GET", "/exams/issued/by-me");
    const arr = Array.isArray(rows) ? rows : [];
    if (el.issuedAssessmentsList) {
      const selected = Number(state.selectedCatalogExamId || 0);
      const displayRows = selected ? arr.filter((r) => Number(r.exam_id) === selected) : arr;
      renderList(
        el.issuedAssessmentsList,
        displayRows,
        (r) => `
          <div><strong>${escapeHtmlAttr(r.assessment_title || `Assessment #${r.exam_id}`)}</strong> <span class="meta">(${escapeHtmlAttr(r.internal_id || `ASM-${String(r.exam_id || "").padStart(6, "0")}`)})</span></div>
          <div class="meta">Candidate: ${escapeHtmlAttr(r.candidate_name || "-")} (${escapeHtmlAttr(r.candidate_email || "-")})</div>
          <div class="meta">Status: ${escapeHtmlAttr(r.status || "issued")} | Score: ${r.score_pct == null ? "-" : Number(r.score_pct).toFixed(2) + "%"} | Result: ${r.passed == null ? "-" : (r.passed ? "PASS" : "FAIL")} | Expires: ${r.access_expires_at ? formatTime(r.access_expires_at) : "-"}</div>
        `,
        selected ? "No candidates issued for this assessment yet." : "No issued assessments yet.",
      );
    }
    const issuedCount = arr.length;
    const takenRows = arr.filter((x) => String(x.status || "") === "completed" && Number.isFinite(Number(x.score_pct)));
    const takenCount = takenRows.length;
    const avg = takenCount ? (takenRows.reduce((s, x) => s + Number(x.score_pct || 0), 0) / takenCount) : 0;
    if (el.issuedCountStat) el.issuedCountStat.textContent = String(issuedCount);
    if (el.takenCountStat) el.takenCountStat.textContent = String(takenCount);
    if (el.avgScoreStat) el.avgScoreStat.textContent = `${avg.toFixed(2)}%`;
  } catch {
    renderList(el.issuedAssessmentsList, [], () => "", "Failed to load issued assessments.");
  }
}

async function issuedApi(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.issuedCandidateToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data?.detail || `Request failed (${res.status})`);
  }
  return data;
}

function exitIssuedAssessmentServer() {
  clearIssuedAssessmentTimer();
  state.issuedCandidateToken = "";
  state.issuedCandidateAssessment = null;
  state.issuedAssessmentSubmitted = false;
  try {
    window.close();
  } catch {
    // Browser may block closing tabs that were not opened by script.
  }
  window.location.replace("about:blank");
}

function renderIssuedCandidateAssessment(data) {
  state.issuedCandidateAssessment = data;
  state.issuedAssessmentSubmitted = false;
  state.issuedAssessmentStartedAt = Date.now();
  startIssuedAssessmentTimer(data);
  if (el.issuedAssessmentTitle) el.issuedAssessmentTitle.textContent = data.assessment_title || "Issued Assessment";
  renderIssuedAssessmentMeta();
  if (!el.issuedAssessmentQuestions) return;
  const type = String(data.assessment_type || "mcq");
  if (type !== "mcq") {
    renderIssuedTaskAssessment(data);
    return;
  }
  const q = Array.isArray(data.questions) ? data.questions : [];
  el.issuedAssessmentQuestions.innerHTML = q.map((item, idx) => `
    <div class="item">
      <div><strong>Q${idx + 1}.</strong> ${escapeHtmlAttr(item.question_text || "")}</div>
      <div class="row wrap gap-sm" style="margin-top:8px;">
        ${(item.options || []).map((o) => `
          <label class="meta" style="display:block; min-width:220px;">
            <input type="checkbox" data-issued-qid="${item.question_id}" value="${o.id}" />
            ${escapeHtmlAttr(o.text || "")}
          </label>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function renderIssuedAssessmentMeta() {
  const data = state.issuedCandidateAssessment || {};
  if (!el.issuedAssessmentMeta) return;
  const duration = Number(data.duration_minutes || 0);
  const pass = Number(data.pass_score || 70);
  const type = String(data.assessment_type || "mcq").replace(/_/g, " ");
  const elapsed = Math.max(0, Math.floor((Date.now() - Number(state.issuedAssessmentStartedAt || Date.now())) / 1000));
  const total = Math.max(0, duration * 60);
  const remaining = total > 0 ? Math.max(0, total - elapsed) : 0;
  el.issuedAssessmentMeta.textContent = `Type: ${type} | Duration: ${duration || 0} mins | Time left: ${formatSecondsToClock(remaining)} | Pass: ${pass}%`;
}

function clearIssuedAssessmentTimer() {
  if (state.issuedAssessmentTimerId) {
    window.clearInterval(state.issuedAssessmentTimerId);
    state.issuedAssessmentTimerId = null;
  }
}

function startIssuedAssessmentTimer(data) {
  clearIssuedAssessmentTimer();
  const total = Math.max(0, Number(data?.duration_minutes || 0) * 60);
  if (!total) return;
  state.issuedAssessmentTimerId = window.setInterval(() => {
    renderIssuedAssessmentMeta();
    const elapsed = Math.max(0, Math.floor((Date.now() - Number(state.issuedAssessmentStartedAt || Date.now())) / 1000));
    if (elapsed >= total && !state.issuedAssessmentSubmitted) {
      submitIssuedCandidateAssessment({ autoSubmit: true }).catch((err) => {
        if (el.issuedAssessmentStatus) el.issuedAssessmentStatus.textContent = err?.message || "Auto-submit failed";
      });
    }
  }, 1000);
}

function issuedTaskSummary(task) {
  const title = escapeHtmlAttr(task?.title || "Assessment task");
  const desc = escapeHtmlAttr(task?.description || "");
  const inst = escapeHtmlAttr(task?.instructions || "");
  return `
    <div class="issued-task-summary">
      <h3>${title}</h3>
      ${desc ? `<p>${desc}</p>` : ""}
      ${inst ? `<div class="notice compact">${inst}</div>` : ""}
    </div>
  `;
}

function renderIssuedTaskAssessment(data) {
  const task = data.task || {};
  const type = String(data.assessment_type || "");
  const meta = task.metadata || {};
  if (type === "coding") {
    const languages = Array.isArray(meta.allowed_languages) && meta.allowed_languages.length ? meta.allowed_languages : ["javascript", "python"];
    el.issuedAssessmentQuestions.innerHTML = `
      ${issuedTaskSummary(task)}
      <div class="issued-workbench two-col">
        <section class="panel-card">
          <h4>Problem</h4>
          <pre class="issued-pre">${escapeHtmlAttr(task.description || "")}</pre>
          <h4>Visible test cases</h4>
          <pre class="issued-pre">${escapeHtmlAttr(JSON.stringify(meta.visible_test_cases || [], null, 2))}</pre>
        </section>
        <section class="panel-card">
          <label class="field-label">Language</label>
          <select id="issuedCodingLanguage" class="filter">${languages.map((x) => `<option value="${escapeHtmlAttr(x)}">${escapeHtmlAttr(x)}</option>`).join("")}</select>
          <label class="field-label">Code</label>
          <textarea id="issuedCodingCode" class="assessment-task-textarea code" spellcheck="false">${escapeHtmlAttr(meta.starter_code || "")}</textarea>
          <div class="actions"><button type="button" class="btn small" id="issuedRunCodingTestsBtn">Run visible tests</button></div>
          <div id="issuedCodingTestResults" class="meta">Visible tests not run yet.</div>
        </section>
      </div>
    `;
    $("issuedRunCodingTestsBtn")?.addEventListener("click", () => runIssuedMockCodingTests(task));
    return;
  }
  if (type === "spreadsheet") {
    el.issuedAssessmentQuestions.innerHTML = `
      ${issuedTaskSummary(task)}
      <div class="issued-workbench two-col">
        <section class="panel-card">
          <h4>Initial spreadsheet data</h4>
          <pre class="issued-pre">${escapeHtmlAttr(JSON.stringify(meta.initial_spreadsheet_data || {}, null, 2))}</pre>
          <div class="meta">Enter final sheet JSON after completing the task.</div>
        </section>
        <section class="panel-card">
          <label class="field-label">Final sheet JSON</label>
          <textarea id="issuedSpreadsheetJson" class="assessment-task-textarea code" spellcheck="false">${escapeHtmlAttr(JSON.stringify(meta.initial_spreadsheet_data || {}, null, 2))}</textarea>
        </section>
      </div>
    `;
    return;
  }
  if (type === "tax_simulator") {
    el.issuedAssessmentQuestions.innerHTML = `
      ${issuedTaskSummary(task)}
      <div class="issued-workbench tax-grid">
        <section class="panel-card">
          <h4>Client scenario</h4>
          <p>${escapeHtmlAttr(meta.client_scenario || task.description || "")}</p>
          <h4>Documents</h4>
          <ul>${(meta.client_documents || []).map((x) => `<li>${escapeHtmlAttr(x)}</li>`).join("") || "<li>No documents listed.</li>"}</ul>
        </section>
        <section class="panel-card">
          <h4>Simulated forms</h4>
          <div class="meta">${(meta.required_simulated_forms || []).map(escapeHtmlAttr).join(", ") || "Use relevant generic finance forms."}</div>
          <label class="field-label">Entered form values JSON</label>
          <textarea id="issuedTaxValues" class="assessment-task-textarea code" spellcheck="false">{}</textarea>
        </section>
        <section class="panel-card">
          <label class="field-label">Red flags identified</label>
          <textarea id="issuedTaxRedFlags" class="assessment-task-textarea"></textarea>
          <label class="field-label">Notes and reasoning</label>
          <textarea id="issuedTaxNotes" class="assessment-task-textarea"></textarea>
        </section>
      </div>
    `;
    return;
  }
  el.issuedAssessmentQuestions.innerHTML = `
    ${issuedTaskSummary(task)}
    <div class="issued-workbench two-col">
      <section class="panel-card">
        <h4>Case prompt</h4>
        <p>${escapeHtmlAttr(meta.case_prompt || task.description || "")}</p>
        <div class="meta">Allowed files: ${(meta.allowed_file_types || []).map(escapeHtmlAttr).join(", ") || "as instructed"} | Max size: ${escapeHtmlAttr(meta.max_file_size_mb || 10)} MB</div>
      </section>
      <section class="panel-card">
        <label class="field-label">Uploaded file link or filename</label>
        <input id="issuedCaseFileUrl" class="filter" placeholder="Paste uploaded file URL or filename" />
        <label class="field-label">Written answer</label>
        <textarea id="issuedCaseAnswer" class="assessment-task-textarea"></textarea>
      </section>
    </div>
  `;
}

function runIssuedMockCodingTests(task) {
  const code = String($("issuedCodingCode")?.value || "");
  const tests = Array.isArray(task?.metadata?.visible_test_cases) ? task.metadata.visible_test_cases : [];
  const passed = tests.map((t) => {
    const expected = String(t?.expected_output ?? t?.expected ?? "");
    return {
      name: t?.name || t?.input || "visible test",
      passed: expected ? code.includes(expected) : Boolean(code.trim()),
    };
  });
  const ok = passed.filter((x) => x.passed).length;
  const node = $("issuedCodingTestResults");
  if (node) node.textContent = `Mock visible tests: ${ok}/${passed.length || 1} passed.`;
}

function parseIssuedJsonTextarea(id, fallback = {}) {
  const raw = String($(id)?.value || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Enter valid JSON before submitting.");
  }
}

function collectIssuedSubmissionData() {
  const data = state.issuedCandidateAssessment || {};
  const type = String(data.assessment_type || "mcq");
  if (type === "coding") {
    return {
      language: $("issuedCodingLanguage")?.value || "",
      code: $("issuedCodingCode")?.value || "",
      test_case_results: [],
      execution_logs: "Mock browser-side run only.",
    };
  }
  if (type === "spreadsheet") {
    return {
      final_sheet_json: parseIssuedJsonTextarea("issuedSpreadsheetJson", {}),
      formula_results: {},
    };
  }
  if (type === "tax_simulator") {
    return {
      selected_forms: data.task?.metadata?.required_simulated_forms || [],
      entered_form_values: parseIssuedJsonTextarea("issuedTaxValues", {}),
      identified_red_flags: String($("issuedTaxRedFlags")?.value || "").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean),
      notes: $("issuedTaxNotes")?.value || "",
      reasoning: $("issuedTaxNotes")?.value || "",
    };
  }
  if (type === "case_study") {
    return {
      uploaded_file_url: $("issuedCaseFileUrl")?.value || "",
      written_answer: $("issuedCaseAnswer")?.value || "",
    };
  }
  return {};
}

async function submitIssuedCandidateAssessment(options = {}) {
  const data = state.issuedCandidateAssessment;
  if (!data) throw new Error("No issued assessment loaded");
  if (state.issuedAssessmentSubmitted) return;
  const type = String(data.assessment_type || "mcq");
  const timeTaken = Math.max(0, Math.floor((Date.now() - Number(state.issuedAssessmentStartedAt || Date.now())) / 1000));
  const answers = {};
  if (type === "mcq") {
    if (!Array.isArray(data.questions)) throw new Error("No issued assessment questions loaded");
    data.questions.forEach((q) => {
      const checked = Array.from(document.querySelectorAll(`input[data-issued-qid="${q.question_id}"]:checked`));
      answers[String(q.question_id)] = checked.map((n) => Number(n.value));
    });
  }
  const body = {
    answers,
    submitted_data: type === "mcq" ? {} : collectIssuedSubmissionData(),
    time_taken_seconds: timeTaken,
    proctoring_events: [],
  };
  state.issuedAssessmentSubmitted = true;
  clearIssuedAssessmentTimer();
  let out;
  try {
    out = await issuedApi("POST", "/exams/issued/submit", body);
  } catch (err) {
    state.issuedAssessmentSubmitted = false;
    startIssuedAssessmentTimer(data);
    throw err;
  }
  if (el.issuedAssessmentStatus) {
    if (out.manual_review) {
      el.issuedAssessmentStatus.textContent = options.autoSubmit ? "Time expired. Submitted for manual review." : "Submitted for manual review.";
    } else {
      el.issuedAssessmentStatus.textContent = `Submitted. Score ${Number(out.score_pct || 0).toFixed(2)}% | ${out.passed ? "PASS" : "FAIL"}`;
    }
  }
}

function renderProviderComplaintsDetail() {
  const map = { new: "new", pending: "pending", closed: "closed" };
  const selected = map[state.providerComplaintsDetailStatus] || "new";
  if (el.providerComplaintsDetailTitle) {
    el.providerComplaintsDetailTitle.textContent = `${selected[0].toUpperCase()}${selected.slice(1)} Complaints`;
  }
  const items = (state.providerComplaints || []).filter((c) => (c.provider_status || "new") === selected);
  renderList(
    el.providerComplaintsDetailList,
    items,
    (c) => `
      <div><strong>${escapeHtmlAttr(c.course_title || "Course")}</strong> - ${escapeHtmlAttr(c.student_name || "Student")}</div>
      <div style="margin-top:4px;">${escapeHtmlAttr(c.message || "")}</div>
      <div class="meta">${formatTime(c.created_at)} | Status: ${escapeHtmlAttr(c.provider_status || "new")}</div>
      <div class="meta">Reply: ${escapeHtmlAttr(c.provider_reply || "No response yet")}</div>
      <div class="actions">
        ${selected === "new" ? `<button class="btn small" data-provider-complaint-pending="${c.comment_id}">Mark Pending</button>` : ""}
        ${selected !== "closed" ? `<button class="btn small danger" data-provider-complaint-close="${c.comment_id}">Close</button>` : ""}
        <button class="btn small" data-provider-complaint-reply="${c.comment_id}">Respond</button>
      </div>
    `,
    `No ${selected} complaints.`,
  );

  document.querySelectorAll("[data-provider-complaint-pending]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-provider-complaint-pending") || 0);
      if (!id) return;
      try {
        await api("POST", `/provider/workspace/feedback/comments/${id}/status`, { status: "pending" });
        await refreshProviderFeedback();
      } catch (err) {
        toast(err?.message || "Failed to update complaint", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-complaint-close]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-provider-complaint-close") || 0);
      if (!id) return;
      try {
        await api("POST", `/provider/workspace/feedback/comments/${id}/status`, { status: "closed" });
        await refreshProviderFeedback();
      } catch (err) {
        toast(err?.message || "Failed to close complaint", "error");
      }
    });
  });
  document.querySelectorAll("[data-provider-complaint-reply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-provider-complaint-reply") || 0);
      if (!id) return;
      const reply = prompt("Respond to complaint");
      if (!reply) return;
      try {
        await api("POST", `/provider/workspace/feedback/comments/${id}/reply`, { reply });
        if (selected === "new") {
          await api("POST", `/provider/workspace/feedback/comments/${id}/status`, { status: "pending" });
        }
        await refreshProviderFeedback();
      } catch (err) {
        toast(err?.message || "Failed to respond", "error");
      }
    });
  });
}

async function refreshProviderFeedback() {
  const [comments, ratings] = await Promise.all([
    api("GET", "/provider/workspace/feedback/comments"),
    api("GET", "/provider/workspace/feedback/ratings"),
  ]);
  state.providerComplaints = Array.isArray(comments) ? comments : [];
  state.providerFeedbackRatings = Array.isArray(ratings) ? ratings : [];

  renderProviderFeedbackHub();
  if (state.providerFeedbackDetailMode) {
    renderProviderFeedbackDetail();
  } else if (state.providerComplaintsDetailStatus) {
    renderProviderComplaintsDetail();
  }
}

async function refreshProviderNotifications() {
  const notes = await api("GET", "/provider/workspace/notifications");
  renderList(
    el.providerNotificationsList,
    notes,
    (n) => `
      <div><strong>${n.event_type}</strong> ${n.is_read ? "" : "<span class='status-pill status-open'>new</span>"}</div>
      <div style='margin-top:4px;'>${n.message}</div>
      <div class='meta'>${formatTime(n.created_at)}</div>
      ${n.is_read ? "" : `<div class='actions'><button class='btn small' data-note-read='${n.id}'>Mark read</button></div>`}
    `,
    "No notifications.",
  );
  document.querySelectorAll("[data-note-read]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api("POST", `/provider/workspace/notifications/${btn.dataset.noteRead}/read`);
        await refreshProviderNotifications();
      } catch {
        toast("Failed to update notification", "error");
      }
    });
  });
}

async function refreshProviderCertifications() {
  const list = await api("GET", "/provider/workspace/certifications");
  renderList(
    el.providerCertsList,
    list,
    (c) => `
      <div><strong>${c.certificate_id}</strong> - ${c.course_name}</div>
      <div class='meta'>Student: ${c.student_name} | Issued: ${formatTime(c.issued_at)}</div>
      <div class='actions'>
        ${c.download_url ? `<a class='btn small' href='${c.download_url}' target='_blank'>Download/Share</a>` : "<span class='meta'>PDF preparing...</span>"}
      </div>
    `,
    "No certificates issued yet.",
  );
}

async function addModuleAction() {
  const courseId = Number($("moduleCourseId")?.value || 0);
  if (!courseId) throw new Error("Course ID is required");
  await api("POST", `/courses/${courseId}/modules`, {
    title: $("moduleTitle")?.value?.trim(),
    position: Number($("modulePosition")?.value || 1),
    syllabus_text: "",
  });
}

async function addLessonAction() {
  const moduleId = Number($("lessonModuleId")?.value || 0);
  if (!moduleId) throw new Error("Module ID is required");
  const lessonType = $("lessonType")?.value || "recorded_video";
  await api("POST", `/courses/modules/${moduleId}/lessons`, {
    title: $("lessonTitle")?.value?.trim(),
    lesson_type: lessonType,
    recorded_video_url: lessonType === "recorded_video" ? ($("lessonVideoUrl")?.value?.trim() || null) : null,
    live_class_url: lessonType === "live_class_link" ? ($("lessonLiveUrl")?.value?.trim() || null) : null,
    position: Number($("lessonPosition")?.value || 1),
  });
}

async function addResourceAction() {
  const lessonId = Number($("resourceLessonId")?.value || 0);
  if (!lessonId) throw new Error("Lesson ID is required");
  await api("POST", `/courses/lessons/${lessonId}/resources`, {
    title: $("resourceTitle")?.value?.trim(),
    url: $("resourceUrl")?.value?.trim(),
    resource_type: $("resourceType")?.value?.trim() || "attachment",
  });
}

async function publishCourseAction() {
  const courseId = Number($("publishCourseId")?.value || 0);
  if (!courseId) throw new Error("Course ID is required");
  await api("POST", `/courses/${courseId}/publish`);
}

async function createCourseFromWizard() {
  renderCoursePublishProgress(2, "Publishing your course");
  const title = $("cwCourseTitle")?.value?.trim();
  const level = $("cwCourseLevel")?.value || "Beginner";
  const category = $("cwCourseCategory")?.value?.trim() || "General";
  const suitableAgeRanges = getWizardSuitableAgeRanges();
  const description = $("cwCourseDescription")?.value?.trim() || "";
  const introVideoUrl = $("cwIntroVideoUrl")?.value?.trim() || "";
  let thumbnail = $("cwCourseThumbnail")?.value?.trim() || null;
  const videoUrl = $("cwVideoUrl")?.value?.trim();
  const localVideoFile = $("cwVideoFile")?.files?.[0] || null;
  const includesExam = Boolean($("cwIncludesExam")?.checked);
  const priceBreakdown = coursePricingBreakdownFromBase($("cwBasePriceAmount")?.value || 0);

  if (!title) throw new Error("Course name is required");
  if (!Number.isFinite(priceBreakdown.base) || priceBreakdown.base <= 0) throw new Error("Price is required and must be greater than 0.");
  if (!introVideoUrl) throw new Error("Intro video URL is mandatory.");
  if (!videoUrl && !localVideoFile) throw new Error("Video URL or local video file is required");
  if (!thumbnail) throw new Error("Thumbnail is required for recorded classes.");
  if (state.wizardVideoUploadPromise) {
    renderCoursePublishProgress(48, "Publishing your course");
    await state.wizardVideoUploadPromise;
  }
  renderCoursePublishProgress(52, "Publishing your course");
  let safeRecordedVideoUrl = videoUrl || $("cwVideoUrl")?.value?.trim() || "";

  const course = await api("POST", "/courses", {
    title,
    description: `${description}\n\nLevel: ${level}`.trim(),
    category,
    suitable_age_ranges: suitableAgeRanges,
    thumbnail_url: thumbnail,
    intro_video_url: introVideoUrl,
    preview_video_url: introVideoUrl,
    includes_certification_exam: includesExam,
    base_price_amount: priceBreakdown.base,
  });
  if (!safeRecordedVideoUrl && localVideoFile) {
    safeRecordedVideoUrl = await uploadLocalVideoInChunks(localVideoFile, { progressStart: 56, progressEnd: 86, courseId: course.id });
  } else {
    renderCoursePublishProgress(86, "Publishing your course");
  }
  if (!safeRecordedVideoUrl) throw new Error("Video upload failed. Please try again.");
  renderCoursePublishProgress(88, "Publishing your course");
  const module = await api("POST", `/courses/${course.id}/modules`, {
    title: `${title} - Core Module`,
    position: 1,
    syllabus_text: "",
  });
  renderCoursePublishProgress(90, "Publishing your course");
  const lesson = await api("POST", `/courses/modules/${module.id}/lessons`, {
    title: `${title} - Main Class`,
    lesson_type: "recorded_video",
    recorded_video_url: safeRecordedVideoUrl,
    live_class_url: null,
    position: 1,
  });
  renderCoursePublishProgress(94, "Publishing your course");
  for (const topic of state.draftTopics) {
    await api("POST", `/provider/workspace/content/lessons/${lesson.id}/topics`, {
      title: topic.title,
      time_seconds: topic.time_seconds,
      thumbnail_data_url: topic.thumbnail_data_url || null,
    });
  }
  renderCoursePublishProgress(97, "Publishing your course");
  await api("POST", `/courses/${course.id}/publish`);
  renderCoursePublishProgress(100, "Published");
  if (state.activeDraftId) {
    await api("DELETE", `/provider/workspace/courses/drafts/${state.activeDraftId}`);
    state.activeDraftId = null;
  }
  return { courseId: course.id, moduleId: module.id, lessonId: lesson.id, topicsAdded: state.draftTopics.length };
}

async function loadSessionContext() {
  stopAdminPolling();
  const context = await api("GET", "/auth/me/context");
  if (context?.setup_required) {
    state.context = null;
    setSessionBadge("Account setup required");
    setUserUidBadge("");
    el.logoutBtns.forEach((b) => {
      b.disabled = false;
    });
    openAccountSetupForCurrentUser();
    if (el.signupName && context.full_name) el.signupName.value = context.full_name;
    if (el.signupEmail && context.email) el.signupEmail.value = context.email;
    return null;
  }
  state.context = context;
  setSessionBadge(`${context.full_name} (${context.role})`);
  setUserUidBadge(context.public_uid || "");
  el.logoutBtns.forEach((b) => {
    b.disabled = false;
  });

  if (ASSESSMENT_ONLY_MODE && ["admin", "provider"].includes(String(context.role || ""))) {
    showView("provider");
    activateProviderSubView("home");
    await Promise.allSettled([
      refreshProviderHome(),
      refreshProviderAssessments(),
      refreshAssessmentCatalogIssueOptions(),
    ]);
    return context;
  }

  if (context.role === "admin") {
    showView("admin");
    activateAdminSubView("home");
    await Promise.all([
      refreshAnalytics(),
      refreshModerationData(),
      refreshAdminUsers(),
      refreshBilling(),
      refreshAdminBadges(),
    ]);
    state.adminPollingId = setInterval(async () => {
      try {
        await Promise.all([
          refreshModerationData(),
          refreshAdminUsers(),
          refreshAdminBadges(),
        ]);
      } catch (err) {
        const status = apiErrorStatus(err);
        if (status === 401 || status === 403) {
          stopAdminPolling();
          if (status === 403) {
            toast("Admin access denied for this account. Re-login with an approved admin account.", "error");
          }
        }
        log("admin_poll_error", String(err));
      }
    }, 10000);
    return context;
  }

  if (context.role === "provider") {
    showView("provider");
    activateProviderSubView("home");
    await Promise.all([
      refreshProviderHome(),
      refreshProviderAssessments(),
      refreshProviderFeedback(),
      refreshProviderCertifications(),
      refreshProviderLiveClasses(),
    ]);
    await refreshProviderContent();
    await refreshProviderDrafts();
    return context;
  }

  if (context.role === "student") {
    showView("student");
    activateStudentSubView("home");
    await Promise.all([refreshStudentDashboard(), refreshStudentCertifications(), refreshStudentLiveClasses()]);
    return context;
  }

  showView("non-admin");
  renderNonAdminRoleFix(context);
  const statusText = context.approval_status === "approved"
    ? "Approved"
    : context.approval_status === "pending"
      ? "Pending approval"
      : `Invalid profile (${context.rejection_reason || "rejected"})`;
  if (el.nonAdminText) el.nonAdminText.textContent = `Logged in as ${context.role}. Status: ${statusText}.`;
  return context;
}

async function enterLocalDummyWorkspace(email, role = "provider") {
  const normalizedRole = ["admin", "provider", "student"].includes(role) ? role : "provider";
  const fullName = normalizedRole === "provider" ? "Assessment Provider" : normalizedRole === "student" ? "Assessment Student" : "Local Admin";
  const loginOut = await api("POST", "/auth/login", {
    email: email || `${normalizedRole}.assessment@example.com`,
    password: "local-dev",
  }, false);
  state.localAccessToken = String(loginOut?.access_token || "local-dev-token");
  state.localDummyRole = normalizedRole;
  state.localDummyEmail = email || `${normalizedRole}.assessment@example.com`;
  state.localDummyName = fullName;
  state.context = {
    id: 1,
    email: state.localDummyEmail,
    full_name: fullName,
    role: normalizedRole,
    public_uid: `LOCAL-${normalizedRole.toUpperCase()}`,
    approval_status: "approved",
  };
  setSessionBadge(`${state.context.full_name} (${state.context.role})`);
  setUserUidBadge(state.context.public_uid);
  el.logoutBtns.forEach((b) => {
    b.disabled = false;
  });
  if (normalizedRole === "provider" || normalizedRole === "admin") {
    showView("provider");
    activateProviderSubView("assessments");
    await Promise.allSettled([
      refreshProviderHome(),
      refreshProviderAssessments(),
      refreshAssessmentCatalogIssueOptions(),
    ]);
    return state.context;
  }
  showView("student");
  activateStudentSubView("assessments");
  await Promise.allSettled([refreshStudentDashboard(), refreshStudentCertifications()]);
  return state.context;
}

async function initFirebase() {
  setAuthActionState(false);
  const cfg = await api("GET", "/config/firebase", null, false);
  state.authMode = String(cfg.auth_mode || "").toLowerCase();
  if (state.authMode === "dummy") {
    state.auth = null;
    setAuthActionState(true);
    return;
  }
  const app = initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
    measurementId: cfg.measurementId,
  });
  state.auth = getAuth(app);
  await setPersistence(state.auth, browserLocalPersistence);
  setAuthActionState(true);
  onAuthStateChanged(state.auth, async (user) => {
    state.context = null;
    if (state.authRoleSetupInFlight) return;
    if (state.authLoginFallbackTimer) {
      clearTimeout(state.authLoginFallbackTimer);
      state.authLoginFallbackTimer = null;
    }
    if (!user) {
      state.authLoginInFlight = false;
      hideAuthProgress();
      setSessionBadge("Not signed in");
      setUserUidBadge("");
      el.logoutBtns.forEach((b) => {
        b.disabled = true;
      });
      showView("auth");
      showAuthMode("login");
      return;
    }
    try {
      showAuthProgress(
        "Loading your workspace",
        "Fetching profile, permissions, and dashboard data...",
      );
      const context = await loadSessionContext();
      if (state.authLoginInFlight && context) toast("Login successful");
      if (state.authLoginInFlight && !context) toast("Complete account setup by choosing Student or Provider.", "error");
      state.authLoginInFlight = false;
      hideAuthProgress();
      if (!context) return;
    } catch (err) {
      state.authLoginInFlight = false;
      hideAuthProgress();
      log("session_error", String(err));
      if (isRoleRegistrationRequiredError(err)) {
        openAccountSetupForCurrentUser();
        toast("Complete account setup by choosing Student or Provider.", "error");
        return;
      }
      toast(formatAuthError(err, "Session load failed"), "error");
      showView("auth");
      showAuthMode("login");
    }
  });
}

function handleKeyboardShortcuts(event) {
  if (!el.assessmentPreviewScreen?.classList.contains("hidden")) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      $("apPrevBtn")?.click();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const submitVisible = !$("apSubmitBtn")?.classList.contains("hidden");
      if (submitVisible) $("apSubmitBtn")?.click();
      else $("apNextBtn")?.click();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      confirmQuitAssessment();
      return;
    }
  }
  const tag = event.target?.tagName?.toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return;
  if (!state.context) return;
  if (state.context.role === "admin") {
    if (event.key === "1") activateAdminSubView("home");
    if (event.key === "2") activateAdminSubView("reports");
    if (event.key === "3") activateAdminSubView("users");
    if (event.key === "4") activateAdminSubView("billing");
  }
  if (state.context.role === "provider") {
    if (event.key === "1") activateProviderSubView("home");
    if (event.key === "2") activateProviderSubView("courses");
    if (event.key === "3") activateProviderSubView("assessments");
    if (event.key === "4") activateProviderSubView("feedback");
    if (event.key === "5") activateProviderSubView("live");
    if (event.key === "6") activateProviderSubView("certifications");
  }
  if (state.context.role === "student") {
    if (event.key === "1") activateStudentSubView("home");
    if (event.key === "2") activateStudentSubView("available");
    if (event.key === "3") activateStudentSubView("enrolled");
    if (event.key === "4") activateStudentSubView("assessments");
    if (event.key === "5") activateStudentSubView("live");
    if (event.key === "6") activateStudentSubView("certifications");
  }
}

const providerCodingWorkspace = {
  files: [
    {
      id: "main-js",
      name: "main.js",
      language: "javascript",
      value: [
        "function reconcileLedger(entries) {",
        "  return entries.reduce((total, entry) => total + entry.debit - entry.credit, 0);",
        "}",
        "",
        "const entries = [",
        "  { debit: 1200, credit: 0 },",
        "  { debit: 0, credit: 450 },",
        "  { debit: 300, credit: 0 },",
        "];",
        "",
        "console.log('Ledger balance:', reconcileLedger(entries));",
      ].join("\n"),
    },
    {
      id: "site-html",
      name: "index.html",
      language: "javascript",
      value: [
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"UTF-8\" />",
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
        "  <title>Preview Test</title>",
        "  <link rel=\"stylesheet\" href=\"styles.css\" />",
        "</head>",
        "<body>",
        "  <main class=\"hero\">",
        "    <p class=\"eyebrow\">Classagon Preview</p>",
        "    <h1>Static preview is working.</h1>",
        "    <p class=\"lede\">This page is rendered from the Coding Env preview host.</p>",
        "    <button id=\"demoButton\" class=\"cta\">Click me</button>",
        "    <div id=\"demoStatus\" class=\"status\">Waiting for interaction.</div>",
        "  </main>",
        "  <script src=\"app.js\"></script>",
        "</body>",
        "</html>",
      ].join("\n"),
    },
    {
      id: "site-css",
      name: "styles.css",
      language: "javascript",
      value: [
        ":root {",
        "  color-scheme: light;",
        "  --bg: #f3f7ff;",
        "  --card: #ffffff;",
        "  --ink: #10203a;",
        "  --accent: #0f766e;",
        "  --accent-2: #2563eb;",
        "}",
        "body {",
        "  margin: 0;",
        "  font-family: 'Segoe UI', sans-serif;",
        "  background: radial-gradient(circle at top left, #c7f9f1, transparent 30%), var(--bg);",
        "  color: var(--ink);",
        "}",
        ".hero {",
        "  min-height: 100vh;",
        "  display: grid;",
        "  place-content: center;",
        "  gap: 14px;",
        "  padding: 32px;",
        "  text-align: center;",
        "}",
        ".eyebrow {",
        "  margin: 0;",
        "  text-transform: uppercase;",
        "  letter-spacing: .18em;",
        "  font-size: .78rem;",
        "  font-weight: 800;",
        "  color: var(--accent);",
        "}",
        "h1 {",
        "  margin: 0;",
        "  font-size: clamp(2rem, 5vw, 4rem);",
        "}",
        ".lede {",
        "  margin: 0 auto;",
        "  max-width: 42ch;",
        "  font-size: 1.05rem;",
        "}",
        ".cta {",
        "  justify-self: center;",
        "  border: 0;",
        "  border-radius: 999px;",
        "  padding: 12px 20px;",
        "  font-size: 1rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  background: linear-gradient(135deg, var(--accent), var(--accent-2));",
        "  cursor: pointer;",
        "}",
        ".status {",
        "  justify-self: center;",
        "  min-width: 280px;",
        "  padding: 12px 16px;",
        "  border-radius: 16px;",
        "  background: var(--card);",
        "  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.12);",
        "}",
      ].join("\n"),
    },
    {
      id: "site-js",
      name: "app.js",
      language: "javascript",
      value: [
        "const button = document.getElementById('demoButton');",
        "const status = document.getElementById('demoStatus');",
        "",
        "if (button && status) {",
        "  button.addEventListener('click', () => {",
        "    status.textContent = 'Button click captured at ' + new Date().toLocaleTimeString();",
        "  });",
        "}",
      ].join("\n"),
    },
    {
      id: "analysis-py",
      name: "analysis.py",
      language: "python",
      value: [
        "def normalize_invoice(amount):",
        "    return round(float(amount), 2)",
        "",
        "print('Normalized:', normalize_invoice('1299.456'))",
      ].join("\n"),
    },
  ],
  activeFileId: "main-js",
  output: "Ready. Press Run or Ctrl+Enter.",
  running: false,
  dialog: {
    mode: "",
    fileId: "",
    value: "",
    error: "",
    kind: "file",
    parentFolder: "",
  },
  previewUrl: "about:blank",
  previewDraft: "",
  previewDocumentHtml: "",
  folders: [],
};

const CODING_LANGUAGE_LABELS = {
  javascript: "JavaScript",
  python: "Python",
  typescript: "TypeScript",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
};

function inferCodingLanguage(fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "py") return "python";
  if (ext === "ts") return "typescript";
  if (ext === "sql") return "sql";
  return "javascript";
}

function getProviderCodingActiveFile() {
  return providerCodingWorkspace.files.find((file) => file.id === providerCodingWorkspace.activeFileId)
    || providerCodingWorkspace.files[0];
}

function getProviderCodingRootFiles() {
  return providerCodingWorkspace.files.filter((file) => !String(file.name || "").includes("/"));
}

function getProviderCodingFolderFiles(folderName) {
  const prefix = `${folderName}/`;
  return providerCodingWorkspace.files.filter((file) => String(file.name || "").startsWith(prefix));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProviderCodingPreviewDocument(entryPath, baseUrl) {
  const fileMap = new Map(providerCodingWorkspace.files.map((file) => [String(file.name || ""), String(file.value || "")]));
  let html = String(fileMap.get(entryPath) || "");
  if (!html) return "";
  const normalizedBase = String(baseUrl || "").replace(/[^/]*$/, "");
  if (normalizedBase && /<head[\s>]/i.test(html) && !/<base[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${escapeHtmlAttr(normalizedBase)}" />`);
  }
  for (const [path, content] of fileMap.entries()) {
    const escapedPath = escapeRegExp(path);
    if (/\.css$/i.test(path)) {
      const linkPattern = new RegExp(`<link([^>]*href=["'])${escapedPath}(["'][^>]*)>`, "gi");
      html = html.replace(linkPattern, `<style data-inline-source="${escapeHtmlAttr(path)}">\n${content}\n</style>`);
    }
    if (/\.js$/i.test(path)) {
      const scriptPattern = new RegExp(`<script([^>]*src=["'])${escapedPath}(["'][^>]*)><\\/script>`, "gi");
      html = html.replace(scriptPattern, `<script data-inline-source="${escapeHtmlAttr(path)}">\n${content}\n<\\/script>`);
    }
  }
  return html;
}

function ensureProviderCodingScreen() {
  let screen = $("providerCodingWorkspaceScreen");
  if (screen) return screen;
  screen = document.createElement("section");
  screen.id = "providerCodingWorkspaceScreen";
  screen.className = "coding-workspace-screen hidden";
  document.body.appendChild(screen);
  screen.addEventListener("click", handleProviderCodingWorkspaceClick);
  screen.addEventListener("pointerdown", handleProviderCodingWorkspacePointerDown);
  screen.addEventListener("input", handleProviderCodingWorkspaceInput);
  screen.addEventListener("change", handleProviderCodingWorkspaceChange);
  screen.addEventListener("keydown", handleProviderCodingWorkspaceKeydown);
  screen.addEventListener("scroll", handleProviderCodingWorkspaceScroll, true);
  return screen;
}

function renderProviderCodingWorkspace() {
  const screen = ensureProviderCodingScreen();
  const activeFile = getProviderCodingActiveFile();
  const canRun = ["javascript", "python"].includes(activeFile.language);
  const runIsPreview = activeFile.language === "html";
  const runLabel = runIsPreview ? "Preview" : "Run";
  const runIcon = providerCodingWorkspace.running ? "hourglass_top" : (runIsPreview ? "web_asset" : "play_arrow");
  const dialogOpen = Boolean(providerCodingWorkspace.dialog.mode);
  screen.innerHTML = `
    <div class="coding-shell">
      <header class="coding-topbar">
        <div class="coding-title-strip">
          <span class="material-symbols-rounded" aria-hidden="true">code_blocks</span>
          <strong>${escapeHtmlAttr(activeFile.name)}</strong>
          <small>${escapeHtmlAttr(CODING_LANGUAGE_LABELS[activeFile.language] || activeFile.language)}</small>
        </div>
        <div class="coding-actions">
          <button class="coding-icon-btn" type="button" data-coding-action="new" title="New file" aria-label="New file"><span class="material-symbols-rounded" aria-hidden="true">note_add</span></button>
          <button class="coding-icon-btn" type="button" data-coding-action="reset" title="Reset workspace" aria-label="Reset workspace"><span class="material-symbols-rounded" aria-hidden="true">restart_alt</span></button>
          <button class="coding-icon-btn coding-run-btn" type="button" data-coding-action="run" title="${runLabel}" aria-label="${runLabel}" ${providerCodingWorkspace.running ? "disabled" : ""}><span class="material-symbols-rounded" aria-hidden="true">${runIcon}</span></button>
          <button class="coding-icon-btn" type="button" data-coding-action="close" title="Close" aria-label="Close"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
        </div>
      </header>
      <div class="coding-workbench">
        <aside class="coding-file-rail">
          <div class="coding-rail-title">Files</div>
          <div class="coding-file-list">
            ${getProviderCodingRootFiles().map((file) => `
              <div class="coding-file-row ${file.id === activeFile.id ? "active" : ""}">
                <button type="button" class="coding-file-pill" data-coding-action="select-file" data-coding-file-id="${escapeHtmlAttr(file.id)}">
                  <span>${escapeHtmlAttr(file.name)}</span>
                  <small>${escapeHtmlAttr(CODING_LANGUAGE_LABELS[file.language] || file.language)}</small>
                </button>
                <div class="coding-file-actions">
                  <button type="button" data-coding-action="rename-file" data-coding-file-id="${escapeHtmlAttr(file.id)}" title="Rename ${escapeHtmlAttr(file.name)}" aria-label="Rename ${escapeHtmlAttr(file.name)}"><span class="material-symbols-rounded" aria-hidden="true">edit</span></button>
                  <button type="button" data-coding-action="delete-file" data-coding-file-id="${escapeHtmlAttr(file.id)}" title="Delete ${escapeHtmlAttr(file.name)}" aria-label="Delete ${escapeHtmlAttr(file.name)}"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button>
                </div>
              </div>
            `).join("")}
            ${providerCodingWorkspace.folders.map((folder) => `
              <div class="coding-folder-block">
                <div class="coding-folder-row">
                  <div class="coding-folder-title"><span class="material-symbols-rounded" aria-hidden="true">folder</span><span>${escapeHtmlAttr(folder)}</span></div>
                  <div class="coding-file-actions">
                    <button type="button" data-coding-action="rename-folder" data-coding-folder-name="${escapeHtmlAttr(folder)}" title="Rename ${escapeHtmlAttr(folder)}" aria-label="Rename ${escapeHtmlAttr(folder)}"><span class="material-symbols-rounded" aria-hidden="true">edit</span></button>
                    <button type="button" data-coding-action="delete-folder" data-coding-folder-name="${escapeHtmlAttr(folder)}" title="Delete ${escapeHtmlAttr(folder)}" aria-label="Delete ${escapeHtmlAttr(folder)}"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button>
                  </div>
                </div>
                ${getProviderCodingFolderFiles(folder).map((file) => `
                  <div class="coding-file-row ${file.id === activeFile.id ? "active" : ""}">
                    <button type="button" class="coding-file-pill coding-file-pill-nested" data-coding-action="select-file" data-coding-file-id="${escapeHtmlAttr(file.id)}">
                      <span>${escapeHtmlAttr(String(file.name).slice(folder.length + 1))}</span>
                      <small>${escapeHtmlAttr(CODING_LANGUAGE_LABELS[file.language] || file.language)}</small>
                    </button>
                    <div class="coding-file-actions">
                      <button type="button" data-coding-action="rename-file" data-coding-file-id="${escapeHtmlAttr(file.id)}" title="Rename ${escapeHtmlAttr(file.name)}" aria-label="Rename ${escapeHtmlAttr(file.name)}"><span class="material-symbols-rounded" aria-hidden="true">edit</span></button>
                      <button type="button" data-coding-action="delete-file" data-coding-file-id="${escapeHtmlAttr(file.id)}" title="Delete ${escapeHtmlAttr(file.name)}" aria-label="Delete ${escapeHtmlAttr(file.name)}"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button>
                    </div>
                  </div>
                `).join("")}
              </div>
            `).join("")}
          </div>
          <div class="coding-help-card">
            <strong>Shortcuts</strong>
            <span>Ctrl + Enter: Run</span>
            <span>Ctrl + N: New file</span>
          </div>
        </aside>
        <section class="coding-editor-stage">
          <div class="coding-editor-toolbar">
            <div>
              <strong>${escapeHtmlAttr(activeFile.name)}</strong>
              <span>${canRun ? "Backend runner active" : "Edit-only template"}</span>
            </div>
            <div class="coding-toolbar-right">
              <select id="providerCodingLanguage" class="coding-language-select" aria-label="Language">
                ${Object.entries(CODING_LANGUAGE_LABELS).map(([value, label]) => `
                  <option value="${escapeHtmlAttr(value)}" ${activeFile.language === value ? "selected" : ""}>${escapeHtmlAttr(label)}</option>
                `).join("")}
              </select>
            </div>
          </div>
          <div class="coding-stage-grid">
            <div class="coding-editor-wrap">
              <pre id="providerCodingLineNumbers" class="coding-line-numbers" aria-hidden="true"></pre>
              <textarea id="providerCodingEditor" class="coding-editor" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Editor content"></textarea>
            </div>
            <aside class="coding-preview-pane">
              <div class="coding-preview-toolbar">
                <span class="material-symbols-rounded" aria-hidden="true">language</span>
                <div class="coding-preview-label">${providerCodingWorkspace.previewUrl !== "about:blank" ? "Preview ready" : "Preview not ready"}</div>
                <button class="coding-preview-host-btn" type="button" data-coding-action="publish-preview" title="Preview" aria-label="Preview">Preview</button>
              </div>
              ${providerCodingWorkspace.previewDocumentHtml
                ? `<iframe id="providerCodingPreviewFrame" class="coding-preview-frame" srcdoc="${escapeHtmlAttr(providerCodingWorkspace.previewDocumentHtml)}" title="Local preview browser"></iframe>`
                : `<iframe id="providerCodingPreviewFrame" class="coding-preview-frame" src="${escapeHtmlAttr(providerCodingWorkspace.previewUrl)}" title="Local preview browser"></iframe>`
              }
            </aside>
          </div>
          <section class="coding-console">
            <div class="coding-console-head">
              <strong>Console</strong>
              <span>${escapeHtmlAttr(activeFile.language)}</span>
            </div>
            <pre id="providerCodingOutput">${escapeHtmlAttr(providerCodingWorkspace.output)}</pre>
          </section>
        </section>
      </div>
      ${dialogOpen ? `
        <div class="coding-dialog-backdrop" data-coding-action="dismiss-dialog">
          <div class="coding-dialog-card" role="dialog" aria-modal="true" aria-labelledby="codingDialogTitle">
            <div class="coding-dialog-head">
              <strong id="codingDialogTitle">${providerCodingWorkspace.dialog.mode === "rename" ? "Rename file" : providerCodingWorkspace.dialog.mode === "delete" ? "Delete file" : providerCodingWorkspace.dialog.mode === "rename-folder" ? "Rename folder" : providerCodingWorkspace.dialog.mode === "delete-folder" ? "Delete folder" : "New item"}</strong>
              <button class="coding-icon-btn" type="button" data-coding-action="dismiss-dialog" title="Close dialog" aria-label="Close dialog"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
            </div>
            ${providerCodingWorkspace.dialog.mode === "delete" || providerCodingWorkspace.dialog.mode === "delete-folder" ? `
              <div class="coding-dialog-body">
                <p>Delete <strong>${escapeHtmlAttr(providerCodingWorkspace.dialog.value)}</strong>?</p>
                <span class="coding-dialog-error">${escapeHtmlAttr(providerCodingWorkspace.dialog.error)}</span>
              </div>
            ` : `
              <div class="coding-dialog-body">
                ${providerCodingWorkspace.dialog.mode === "new" ? `
                  <label class="coding-dialog-label" for="providerCodingDialogKind">Create</label>
                  <select id="providerCodingDialogKind" class="coding-dialog-select">
                    <option value="file" ${providerCodingWorkspace.dialog.kind === "file" ? "selected" : ""}>File</option>
                    <option value="folder" ${providerCodingWorkspace.dialog.kind === "folder" ? "selected" : ""}>Folder</option>
                  </select>
                  ${providerCodingWorkspace.dialog.kind === "file" ? `
                    <label class="coding-dialog-label" for="providerCodingDialogParent">Folder</label>
                    <select id="providerCodingDialogParent" class="coding-dialog-select">
                      <option value="">Root</option>
                      ${providerCodingWorkspace.folders.map((folder) => `<option value="${escapeHtmlAttr(folder)}" ${providerCodingWorkspace.dialog.parentFolder === folder ? "selected" : ""}>${escapeHtmlAttr(folder)}</option>`).join("")}
                    </select>
                  ` : ""}
                ` : ""}
                <label class="coding-dialog-label" for="providerCodingDialogInput">File name</label>
                <input id="providerCodingDialogInput" class="coding-dialog-input" type="text" value="${escapeHtmlAttr(providerCodingWorkspace.dialog.value)}" placeholder="${providerCodingWorkspace.dialog.kind === "folder" ? "src" : "main.py"}" />
                <span class="coding-dialog-error">${escapeHtmlAttr(providerCodingWorkspace.dialog.error)}</span>
              </div>
            `}
            <div class="coding-dialog-actions">
              <button class="coding-dialog-btn" type="button" data-coding-action="dismiss-dialog">Cancel</button>
              <button class="coding-dialog-btn primary" type="button" data-coding-action="submit-dialog">${providerCodingWorkspace.dialog.mode === "delete" ? "Delete" : "Save"}</button>
            </div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
  const editor = $("providerCodingEditor");
  if (editor) {
    editor.value = activeFile.value;
    editor.focus();
    refreshProviderCodingLineNumbers();
  }
  const dialogInput = $("providerCodingDialogInput");
  if (dialogInput) dialogInput.focus();
  screen.querySelectorAll(".coding-file-pill[data-coding-file-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextId = String(button.getAttribute("data-coding-file-id") || "");
      if (!nextId || nextId === providerCodingWorkspace.activeFileId) return;
      providerCodingWorkspace.activeFileId = nextId;
      renderProviderCodingWorkspace();
    });
  });
}

function openProviderCodingWorkspace() {
  const screen = ensureProviderCodingScreen();
  screen.classList.remove("hidden");
  document.body.classList.add("coding-workspace-open");
  renderProviderCodingWorkspace();
}

function closeProviderCodingWorkspace() {
  $("providerCodingWorkspaceScreen")?.classList.add("hidden");
  document.body.classList.remove("coding-workspace-open");
}

const PROVIDER_EXCEL_WORKSPACE_VERSION = "20260706b";
const PROVIDER_CODING_WORKSPACE_VERSION = "20260706a";

function providerExcelWorkspaceUrl() {
  return `/assessment?tool=excel&embedded=1&v=${encodeURIComponent(PROVIDER_EXCEL_WORKSPACE_VERSION)}`;
}

function providerCodingWorkspaceUrl() {
  return `/assessment?tool=coding&embedded=1&v=${encodeURIComponent(PROVIDER_CODING_WORKSPACE_VERSION)}`;
}

function ensureProviderExcelWorkspace() {
  let screen = $("providerExcelWorkspaceScreen");
  if (screen) return screen;
  screen = document.createElement("section");
  screen.id = "providerExcelWorkspaceScreen";
  screen.className = "excel-workspace-screen hidden";
  screen.innerHTML = `
    <div class="excel-workspace-shell">
      <header class="excel-workspace-topbar">
        <div class="excel-workspace-title">
          <span class="material-symbols-rounded" aria-hidden="true">table_view</span>
          <strong>Excel Assessment</strong>
          <small>Custom workspace</small>
        </div>
        <div class="excel-workspace-actions">
          <button class="excel-workspace-btn" type="button" data-excel-workspace-action="refresh" title="Refresh" aria-label="Refresh">
            <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
          </button>
          <button class="excel-workspace-btn" type="button" data-excel-workspace-action="close" title="Close" aria-label="Close">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      </header>
      <div class="excel-workspace-frame-wrap">
        <iframe
          id="providerExcelWorkspaceFrame"
          class="excel-workspace-frame"
          title="Excel assessment workspace"
          src="${escapeHtmlAttr(providerExcelWorkspaceUrl())}"
          loading="eager"
        ></iframe>
      </div>
    </div>
  `;
  screen.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest("[data-excel-workspace-action]")?.getAttribute("data-excel-workspace-action") || "";
    if (action === "close") {
      closeProviderExcelWorkspace();
      return;
    }
    if (action === "refresh") {
      const frame = $("providerExcelWorkspaceFrame");
      try {
        frame?.contentWindow?.location?.reload();
      } catch {
        if (frame) frame.src = frame.src;
      }
    }
  });
  document.body.appendChild(screen);
  return screen;
}

function openProviderExcelWorkspace() {
  const screen = ensureProviderExcelWorkspace();
  const frame = $("providerExcelWorkspaceFrame");
  const nextUrl = providerExcelWorkspaceUrl();
  if (frame && frame.getAttribute("src") !== nextUrl) {
    frame.setAttribute("src", nextUrl);
  } else {
    try {
      frame?.contentWindow?.location?.replace(nextUrl);
    } catch {
      if (frame) frame.src = nextUrl;
    }
  }
  screen.classList.remove("hidden");
  document.body.classList.add("excel-workspace-open");
}

function closeProviderExcelWorkspace() {
  $("providerExcelWorkspaceScreen")?.classList.add("hidden");
  document.body.classList.remove("excel-workspace-open");
}

function refreshProviderCodingLineNumbers() {
  const editor = $("providerCodingEditor");
  const gutter = $("providerCodingLineNumbers");
  if (!editor || !gutter) return;
  const count = Math.max(1, String(editor.value || "").split("\n").length);
  gutter.textContent = Array.from({ length: count }, (_, idx) => String(idx + 1)).join("\n");
  gutter.scrollTop = editor.scrollTop;
}

function openProviderCodingDialog(mode, fileId = "") {
  const targetFile = providerCodingWorkspace.files.find((file) => file.id === fileId) || getProviderCodingActiveFile();
  providerCodingWorkspace.dialog = {
    mode,
    fileId: fileId || targetFile?.id || "",
    value: mode === "rename" || mode === "delete" ? String(targetFile?.name || "") : "main.py",
    error: "",
    kind: "file",
    parentFolder: "",
  };
  renderProviderCodingWorkspace();
}

function closeProviderCodingDialog() {
  providerCodingWorkspace.dialog = {
    mode: "",
    fileId: "",
    value: "",
    error: "",
    kind: "file",
    parentFolder: "",
  };
  renderProviderCodingWorkspace();
}

function commitProviderCodingFileCreate() {
  const name = String(providerCodingWorkspace.dialog.value || "").trim();
  if (!name) {
    providerCodingWorkspace.dialog.error = "File name is required.";
    renderProviderCodingWorkspace();
    return;
  }
  if (providerCodingWorkspace.dialog.kind === "folder") {
    if (providerCodingWorkspace.folders.includes(name)) {
      providerCodingWorkspace.dialog.error = "Folder already exists.";
      renderProviderCodingWorkspace();
      return;
    }
    providerCodingWorkspace.folders.push(name);
    providerCodingWorkspace.output = `Created folder ${name}.`;
    providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
    renderProviderCodingWorkspace();
    return;
  }
  const filePath = providerCodingWorkspace.dialog.parentFolder ? `${providerCodingWorkspace.dialog.parentFolder}/${name}` : name;
  if (providerCodingWorkspace.files.some((file) => file.name === filePath)) {
    providerCodingWorkspace.dialog.error = "File already exists.";
    renderProviderCodingWorkspace();
    return;
  }
  const language = inferCodingLanguage(filePath);
  const file = {
    id: `file-${Date.now()}`,
    name: filePath,
    language,
    value: language === "python" ? "print('New Python file')" : "console.log('New coding task file');",
  };
  providerCodingWorkspace.files.push(file);
  providerCodingWorkspace.activeFileId = file.id;
  providerCodingWorkspace.output = `Created ${filePath}.`;
  providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
  renderProviderCodingWorkspace();
}

function commitProviderCodingFileRename() {
  const file = providerCodingWorkspace.files.find((item) => item.id === providerCodingWorkspace.dialog.fileId) || getProviderCodingActiveFile();
  const name = String(providerCodingWorkspace.dialog.value || "").trim();
  if (!name) {
    providerCodingWorkspace.dialog.error = "File name is required.";
    renderProviderCodingWorkspace();
    return;
  }
  file.name = name;
  file.language = inferCodingLanguage(name);
  providerCodingWorkspace.activeFileId = file.id;
  providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
  renderProviderCodingWorkspace();
}

function commitProviderCodingFileDelete() {
  if (providerCodingWorkspace.files.length <= 1) {
    providerCodingWorkspace.output = "Keep at least one file in the workspace.";
    providerCodingWorkspace.dialog.error = "Keep at least one file in the workspace.";
    renderProviderCodingWorkspace();
    return;
  }
  const file = providerCodingWorkspace.files.find((item) => item.id === providerCodingWorkspace.dialog.fileId) || getProviderCodingActiveFile();
  providerCodingWorkspace.files = providerCodingWorkspace.files.filter((item) => item.id !== file.id);
  providerCodingWorkspace.activeFileId = providerCodingWorkspace.files[0].id;
  providerCodingWorkspace.output = `Deleted ${file.name}.`;
  providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
  renderProviderCodingWorkspace();
}

function renameProviderCodingFolder(folderName) {
  const nextName = String(providerCodingWorkspace.dialog.value || "").trim();
  if (!nextName) {
    providerCodingWorkspace.dialog.error = "Folder name is required.";
    renderProviderCodingWorkspace();
    return;
  }
  if (providerCodingWorkspace.folders.includes(nextName)) {
    providerCodingWorkspace.dialog.error = "Folder already exists.";
    renderProviderCodingWorkspace();
    return;
  }
  providerCodingWorkspace.folders = providerCodingWorkspace.folders.map((folder) => (folder === folderName ? nextName : folder));
  providerCodingWorkspace.files.forEach((file) => {
    if (String(file.name).startsWith(`${folderName}/`)) {
      file.name = `${nextName}/${String(file.name).slice(folderName.length + 1)}`;
    }
  });
  providerCodingWorkspace.output = `Renamed folder ${folderName} to ${nextName}.`;
  providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
  renderProviderCodingWorkspace();
}

function deleteProviderCodingFolder(folderName) {
  const folderFiles = getProviderCodingFolderFiles(folderName);
  if (folderFiles.length) {
    providerCodingWorkspace.files = providerCodingWorkspace.files.filter((file) => !String(file.name).startsWith(`${folderName}/`));
    providerCodingWorkspace.activeFileId = providerCodingWorkspace.files[0]?.id || "";
  }
  providerCodingWorkspace.folders = providerCodingWorkspace.folders.filter((folder) => folder !== folderName);
  providerCodingWorkspace.output = `Deleted folder ${folderName}.`;
  providerCodingWorkspace.dialog = { mode: "", fileId: "", value: "", error: "", kind: "file", parentFolder: "" };
  renderProviderCodingWorkspace();
}

async function publishProviderCodingPreview() {
  const htmlFiles = providerCodingWorkspace.files.filter((file) => /\.html?$/i.test(String(file.name)));
  if (!htmlFiles.length) {
    providerCodingWorkspace.output = "Create an HTML file such as index.html to use the built-in preview host.";
    renderProviderCodingWorkspace();
    return;
  }
  const payload = {
    entry_path: htmlFiles[0].name,
    files: providerCodingWorkspace.files.map((file) => ({
      path: file.name,
      content: file.value,
    })),
  };
  const out = await api("POST", "/tools/coding/preview/sync", payload, Boolean(state.auth?.currentUser));
  const previewUrl = String(out.preview_url || "").trim();
  providerCodingWorkspace.previewUrl = previewUrl
    ? new URL(previewUrl, window.location.origin).toString()
    : providerCodingWorkspace.previewUrl;
  providerCodingWorkspace.previewDraft = providerCodingWorkspace.previewUrl;
  providerCodingWorkspace.previewDocumentHtml = buildProviderCodingPreviewDocument(htmlFiles[0].name, providerCodingWorkspace.previewUrl);
  providerCodingWorkspace.output = `Preview published from ${htmlFiles[0].name}.`;
  renderProviderCodingWorkspace();
}

function resetProviderCodingWorkspace() {
  providerCodingWorkspace.files = [
    {
      id: "main-js",
      name: "main.js",
      language: "javascript",
      value: [
        "function reconcileLedger(entries) {",
        "  return entries.reduce((total, entry) => total + entry.debit - entry.credit, 0);",
        "}",
        "",
        "const entries = [",
        "  { debit: 1200, credit: 0 },",
        "  { debit: 0, credit: 450 },",
        "  { debit: 300, credit: 0 },",
        "];",
        "",
        "console.log('Ledger balance:', reconcileLedger(entries));",
      ].join("\n"),
    },
    {
      id: "site-html",
      name: "index.html",
      language: "javascript",
      value: [
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"UTF-8\" />",
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
        "  <title>Preview Test</title>",
        "  <link rel=\"stylesheet\" href=\"styles.css\" />",
        "</head>",
        "<body>",
        "  <main class=\"hero\">",
        "    <p class=\"eyebrow\">Classagon Preview</p>",
        "    <h1>Static preview is working.</h1>",
        "    <p class=\"lede\">This page is rendered from the Coding Env preview host.</p>",
        "    <button id=\"demoButton\" class=\"cta\">Click me</button>",
        "    <div id=\"demoStatus\" class=\"status\">Waiting for interaction.</div>",
        "  </main>",
        "  <script src=\"app.js\"></script>",
        "</body>",
        "</html>",
      ].join("\n"),
    },
    {
      id: "site-css",
      name: "styles.css",
      language: "javascript",
      value: [
        ":root {",
        "  color-scheme: light;",
        "  --bg: #f3f7ff;",
        "  --card: #ffffff;",
        "  --ink: #10203a;",
        "  --accent: #0f766e;",
        "  --accent-2: #2563eb;",
        "}",
        "body {",
        "  margin: 0;",
        "  font-family: 'Segoe UI', sans-serif;",
        "  background: radial-gradient(circle at top left, #c7f9f1, transparent 30%), var(--bg);",
        "  color: var(--ink);",
        "}",
        ".hero {",
        "  min-height: 100vh;",
        "  display: grid;",
        "  place-content: center;",
        "  gap: 14px;",
        "  padding: 32px;",
        "  text-align: center;",
        "}",
        ".eyebrow {",
        "  margin: 0;",
        "  text-transform: uppercase;",
        "  letter-spacing: .18em;",
        "  font-size: .78rem;",
        "  font-weight: 800;",
        "  color: var(--accent);",
        "}",
        "h1 {",
        "  margin: 0;",
        "  font-size: clamp(2rem, 5vw, 4rem);",
        "}",
        ".lede {",
        "  margin: 0 auto;",
        "  max-width: 42ch;",
        "  font-size: 1.05rem;",
        "}",
        ".cta {",
        "  justify-self: center;",
        "  border: 0;",
        "  border-radius: 999px;",
        "  padding: 12px 20px;",
        "  font-size: 1rem;",
        "  font-weight: 700;",
        "  color: #fff;",
        "  background: linear-gradient(135deg, var(--accent), var(--accent-2));",
        "  cursor: pointer;",
        "}",
        ".status {",
        "  justify-self: center;",
        "  min-width: 280px;",
        "  padding: 12px 16px;",
        "  border-radius: 16px;",
        "  background: var(--card);",
        "  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.12);",
        "}",
      ].join("\n"),
    },
    {
      id: "site-js",
      name: "app.js",
      language: "javascript",
      value: [
        "const button = document.getElementById('demoButton');",
        "const status = document.getElementById('demoStatus');",
        "",
        "if (button && status) {",
        "  button.addEventListener('click', () => {",
        "    status.textContent = 'Button click captured at ' + new Date().toLocaleTimeString();",
        "  });",
        "}",
      ].join("\n"),
    },
    {
      id: "analysis-py",
      name: "analysis.py",
      language: "python",
      value: [
        "def normalize_invoice(amount):",
        "    return round(float(amount), 2)",
        "",
        "print('Normalized:', normalize_invoice('1299.456'))",
      ].join("\n"),
    },
  ];
  providerCodingWorkspace.activeFileId = "main-js";
  providerCodingWorkspace.output = "Workspace reset.";
  renderProviderCodingWorkspace();
}

async function runProviderCodingFile() {
  const file = getProviderCodingActiveFile();
  if (file.language === "html") {
    providerCodingWorkspace.output = `Previewing ${file.name}...`;
    renderProviderCodingWorkspace();
    try {
      await publishProviderCodingPreview();
    } catch (err) {
      providerCodingWorkspace.output = err?.message || "Preview publishing failed.";
      renderProviderCodingWorkspace();
    }
    return;
  }
  if (!["javascript", "python"].includes(file.language)) {
    providerCodingWorkspace.output = `${CODING_LANGUAGE_LABELS[file.language] || file.language} is edit-only for now. JavaScript and Python execution are active.`;
    renderProviderCodingWorkspace();
    return;
  }
  providerCodingWorkspace.running = true;
  providerCodingWorkspace.output = `Running ${file.name}...`;
  renderProviderCodingWorkspace();
  try {
    const out = await api("POST", "/tools/coding/run", { language: file.language, code: file.value }, Boolean(state.auth?.currentUser));
    const lines = [
      ...String(out.stdout || "").split(/\r?\n/),
      ...String(out.stderr || "").split(/\r?\n/),
    ].filter(Boolean);
    providerCodingWorkspace.output = lines.length ? lines.join("\n") : `Process exited with code ${out.exit_code ?? "unknown"}.`;
  } catch (err) {
    providerCodingWorkspace.output = err?.message || "Runner request failed.";
  } finally {
    providerCodingWorkspace.running = false;
    renderProviderCodingWorkspace();
  }
}

function handleProviderCodingWorkspaceClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const actionBtn = target.closest("[data-coding-action]");
  if (!actionBtn || typeof actionBtn.getAttribute !== "function") return;
  const action = String(actionBtn.getAttribute("data-coding-action") || "");
  if (action === "select-file") {
    providerCodingWorkspace.activeFileId = String(actionBtn.getAttribute("data-coding-file-id") || "");
    renderProviderCodingWorkspace();
  }
  if (action === "rename-file") {
    openProviderCodingDialog("rename", String(actionBtn.getAttribute("data-coding-file-id") || providerCodingWorkspace.activeFileId));
  }
  if (action === "delete-file") {
    openProviderCodingDialog("delete", String(actionBtn.getAttribute("data-coding-file-id") || providerCodingWorkspace.activeFileId));
  }
  if (action === "rename-folder") {
    providerCodingWorkspace.dialog = {
      mode: "rename-folder",
      fileId: "",
      value: String(actionBtn.getAttribute("data-coding-folder-name") || ""),
      error: "",
      kind: "folder",
      parentFolder: String(actionBtn.getAttribute("data-coding-folder-name") || ""),
    };
    renderProviderCodingWorkspace();
  }
  if (action === "delete-folder") {
    providerCodingWorkspace.dialog = {
      mode: "delete-folder",
      fileId: "",
      value: String(actionBtn.getAttribute("data-coding-folder-name") || ""),
      error: "",
      kind: "folder",
      parentFolder: String(actionBtn.getAttribute("data-coding-folder-name") || ""),
    };
    renderProviderCodingWorkspace();
  }
  if (action === "new") openProviderCodingDialog("new");
  if (action === "reset") resetProviderCodingWorkspace();
  if (action === "run") runProviderCodingFile().catch((err) => {
    providerCodingWorkspace.output = err?.message || "Runner failed.";
    providerCodingWorkspace.running = false;
    renderProviderCodingWorkspace();
  });
  if (action === "publish-preview") {
    publishProviderCodingPreview().catch((err) => {
      providerCodingWorkspace.output = err?.message || "Preview publishing failed.";
      renderProviderCodingWorkspace();
    });
  }
  if (action === "dismiss-dialog") closeProviderCodingDialog();
  if (action === "submit-dialog") {
    if (providerCodingWorkspace.dialog.mode === "new") commitProviderCodingFileCreate();
    if (providerCodingWorkspace.dialog.mode === "rename") commitProviderCodingFileRename();
    if (providerCodingWorkspace.dialog.mode === "delete") commitProviderCodingFileDelete();
    if (providerCodingWorkspace.dialog.mode === "rename-folder") renameProviderCodingFolder(providerCodingWorkspace.dialog.parentFolder);
    if (providerCodingWorkspace.dialog.mode === "delete-folder") deleteProviderCodingFolder(providerCodingWorkspace.dialog.parentFolder);
  }
  if (action === "close") closeProviderCodingWorkspace();
}

function handleProviderCodingWorkspacePointerDown(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const fileBtn = target.closest(".coding-file-pill[data-coding-file-id]");
  if (!fileBtn || typeof fileBtn.getAttribute !== "function") return;
  const nextId = String(fileBtn.getAttribute("data-coding-file-id") || "");
  if (!nextId || nextId === providerCodingWorkspace.activeFileId) return;
  providerCodingWorkspace.activeFileId = nextId;
  window.setTimeout(() => renderProviderCodingWorkspace(), 0);
}

function handleProviderCodingWorkspaceInput(event) {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.id === "providerCodingEditor") {
    const file = getProviderCodingActiveFile();
    file.value = target.value;
    refreshProviderCodingLineNumbers();
    return;
  }
  if (target instanceof HTMLInputElement && target.id === "providerCodingDialogInput") {
    providerCodingWorkspace.dialog.value = target.value;
    providerCodingWorkspace.dialog.error = "";
    return;
  }
  if (target instanceof HTMLInputElement && target.id === "providerCodingPreviewUrl") {
    providerCodingWorkspace.previewDraft = target.value;
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === "providerCodingDialogKind") {
    providerCodingWorkspace.dialog.kind = target.value;
    providerCodingWorkspace.dialog.error = "";
    renderProviderCodingWorkspace();
    return;
  }
  if (target instanceof HTMLSelectElement && target.id === "providerCodingDialogParent") {
    providerCodingWorkspace.dialog.parentFolder = target.value;
  }
}

function handleProviderCodingWorkspaceScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || target.id !== "providerCodingEditor") return;
  refreshProviderCodingLineNumbers();
}

function handleProviderCodingWorkspaceChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || target.id !== "providerCodingLanguage") return;
  getProviderCodingActiveFile().language = target.value;
  renderProviderCodingWorkspace();
}

function handleProviderCodingWorkspaceKeydown(event) {
  if (!(event instanceof KeyboardEvent)) return;
  if (providerCodingWorkspace.dialog.mode && event.key === "Enter") {
    event.preventDefault();
    if (providerCodingWorkspace.dialog.mode === "new") commitProviderCodingFileCreate();
    if (providerCodingWorkspace.dialog.mode === "rename") commitProviderCodingFileRename();
    if (providerCodingWorkspace.dialog.mode === "delete") commitProviderCodingFileDelete();
    return;
  }
  if (event.key === "Escape") {
    if (providerCodingWorkspace.dialog.mode) {
      closeProviderCodingDialog();
    } else {
      closeProviderCodingWorkspace();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runProviderCodingFile().catch(() => {});
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    openProviderCodingDialog("new");
  }
}

function ensureProviderSimToolScreen() {
  let screen = $("providerSimToolWorkspaceScreen");
  if (screen) return screen;
  screen = document.createElement("section");
  screen.id = "providerSimToolWorkspaceScreen";
  screen.className = "sim-workspace-screen hidden";
  document.body.appendChild(screen);
  return screen;
}

function closeProviderSimToolWorkspace() {
  $("providerSimToolWorkspaceScreen")?.classList.add("hidden");
  document.body.classList.remove("sim-workspace-open");
}

function openProviderSimToolWorkspace(type) {
  const screen = ensureProviderSimToolScreen();
  screen.classList.remove("hidden");
  document.body.classList.add("sim-workspace-open");
  if (type === "tax") renderProviderTaxTool(screen);
  if (type === "accounts") renderProviderAccountsTool(screen);
}

const providerSimState = {
  tax: {
    profileReviewed: false,
    returnReviewed: false,
    efilePrepared: false,
    routingConfirmed: false,
    readyFor8879: false,
    submitted: false,
    mileageBusinessUsePct: 0,
    selectedMailId: "tax-assign",
    openMailId: "",
    selectedDocId: "tax-engagement",
    intakeNotes: "",
    preparerNotes: "",
    workpaper: {
      wages: "",
      businessIncome: "",
      agi: "",
      deduction: "",
      taxableIncome: "",
      totalTax: "",
      totalPayments: "",
      refundOrDue: "",
    },
    reviewedDocs: {
      "tax-engagement": false,
      "tax-w2-primary": false,
      "tax-w2-spouse": false,
      "tax-interest": false,
      "tax-schedule-c": false,
      "tax-bank": false,
    },
    data: {
      taxpayer: "Maria Rodriguez",
      spouse: "Daniel Rodriguez",
      filingStatus: "MFJ",
      dependents: 1,
      wagesPrimary: 98240,
      wagesSpouse: 50180,
      federalWithholdingPrimary: 18420,
      federalWithholdingSpouse: 7980,
      interestIncome: 640,
      businessGross: 74200,
      advertising: 4880,
      contractorLabor: 16400,
      supplies: 11820,
      vehicleExpense: 8140,
      homeOffice: 2360,
      stateTax: 12400,
      mortgageInterest: 14200,
      charity: 1850,
      estimatedPayments: 6200,
    },
  },
  accounts: {
    invoicePosted: false,
    expensesReviewed: false,
    reportGenerated: false,
    reconciled: false,
    submitted: false,
    selectedMailId: "acct-close",
    openMailId: "",
    selectedDocId: "acct-close-checklist",
    workpaperNotes: "",
    reconciliationNotes: "",
    invoiceSupportConfirmed: false,
    workpaper: {
      revenue: "",
      expenses: "",
      netIncome: "",
      endingBank: "",
      reconcileDiff: "",
    },
    reviewedDocs: {
      "acct-close-checklist": false,
      "acct-bank-statement": false,
      "acct-ar-aging": false,
      "acct-merchant-report": false,
      "acct-expense-bundle": false,
    },
    transactions: {
      stripe: false,
      ach: false,
      adobe: false,
      office: false,
      internet: false,
    },
    data: {
      company: "Northstar Design LLC",
      customer: "Harbor Retail Group",
      invoiceService: "Implementation consulting",
      invoiceAmount: 4800,
      invoiceTax: 384,
      openingBank: 23166.52,
      recurringRevenue: 20000,
      stripePayout: 2184.4,
      clientAch: 4800,
      adobe: 64.99,
      officeDepot: 238.18,
      internet: 119,
      payroll: 2100,
      rent: 2900,
      statementEnding: 29728.75,
    },
  },
};

const SIM_CASE_LIBRARY = {
  tax: {
    mailbox: [
      {
        id: "tax-assign",
        from: "Elaine Park, Tax Manager",
        subject: "2025 1040 filing for Rodriguez household",
        attachments: ["tax-engagement", "tax-w2-primary", "tax-w2-spouse", "tax-interest", "tax-schedule-c", "tax-bank"],
        body: [
          "Prepare the 2025 individual return for Maria and Daniel Rodriguez.",
          "Use the attached source documents and complete the filing package inside this portal.",
          "Recruiter note: candidate should determine the correct deduction method, calculate Schedule C profit, complete the return workpapers, and prepare the return for filing.",
        ],
      },
      {
        id: "tax-followup",
        from: "Maria Rodriguez",
        subject: "Business mileage and home office clarification",
        attachments: ["tax-schedule-c", "tax-bank"],
        body: [
          "Business-use mileage for the consulting activity is 68 percent for the year.",
          "Home office square footage is already reflected in the worksheet; do not duplicate it elsewhere.",
          "Use the checking account on the voided check for any refund direct deposit setup.",
        ],
      },
    ],
    documents: [
      {
        id: "tax-engagement",
        label: "Engagement Letter",
        kind: "PDF",
        content: [
          "Client: Maria Rodriguez and Daniel Rodriguez",
          "Scope: 2025 Federal individual income tax return with Schedule C activity.",
          "Deliverable: reviewer-ready filing package and Form 8879 prep package.",
        ],
      },
      {
        id: "tax-w2-primary",
        label: "W-2 | Apex Manufacturing",
        kind: "W-2",
        content: [
          "Employee: Maria Rodriguez",
          "Box 1 wages: 98,240",
          "Federal withholding: 18,420",
          "Box 12 retirement code must be reviewed by preparer.",
        ],
      },
      {
        id: "tax-w2-spouse",
        label: "W-2 | Solstice Medical",
        kind: "W-2",
        content: [
          "Employee: Daniel Rodriguez",
          "Box 1 wages: 50,180",
          "Federal withholding: 7,980",
          "Benefits and dependent coverage already reconciled.",
        ],
      },
      {
        id: "tax-interest",
        label: "1099-INT | Valley Credit Union",
        kind: "1099-INT",
        content: [
          "Interest income: 640",
          "No backup withholding.",
          "This ties to the family operating account used for refund direct deposit.",
        ],
      },
      {
        id: "tax-schedule-c",
        label: "Schedule C Worksheet",
        kind: "Workpaper",
        content: [
          "Gross receipts: 74,200",
          "Advertising: 4,880",
          "Contract labor: 16,400",
          "Supplies: 11,820",
          "Vehicle expense: 8,140",
          "Home office: 2,360",
        ],
      },
      {
        id: "tax-bank",
        label: "Voided Check",
        kind: "Bank",
        content: [
          "Routing number and account number are visible for refund setup.",
          "Account owner: Maria Rodriguez",
          "Direct deposit should be used if refund remains after final review.",
        ],
      },
    ],
  },
  accounts: {
    mailbox: [
      {
        id: "acct-close",
        from: "Ryan Cole, Controller",
        subject: "May close package for Northstar Design LLC",
        attachments: ["acct-close-checklist", "acct-bank-statement", "acct-ar-aging", "acct-merchant-report", "acct-expense-bundle"],
        body: [
          "Complete the May close for Northstar Design LLC.",
          "Post the pending client invoice, match the bank feed, review expense support, and finish the bank reconciliation.",
          "Recruiter note: candidate should work entirely inside the portal, using only the attached statement, aging, merchant report, and expense packet.",
        ],
      },
      {
        id: "acct-sales",
        from: "Harbor Retail Group",
        subject: "Invoice request for implementation consulting",
        attachments: ["acct-ar-aging"],
        body: [
          "Please invoice 4,800 plus applicable sales tax for the May implementation engagement.",
          "Payment will be remitted by ACH after the invoice is issued.",
          "Reference engagement code HRG-IMPL-05.",
        ],
      },
    ],
    documents: [
      {
        id: "acct-close-checklist",
        label: "Close Checklist",
        kind: "Checklist",
        content: [
          "1. Post missing revenue documents.",
          "2. Match bank feed and categorize expenses.",
          "3. Review AR and merchant deposits.",
          "4. Reconcile checking account to month-end statement.",
        ],
      },
      {
        id: "acct-bank-statement",
        label: "Bank Statement | May 2026",
        kind: "Statement",
        content: [
          "Statement ending balance: 29,728.75",
          "Deposits include Stripe payout and Harbor ACH remittance.",
          "Payments include Adobe, Office Depot, and Delta Internet.",
        ],
      },
      {
        id: "acct-ar-aging",
        label: "A/R Aging",
        kind: "Report",
        content: [
          "Harbor Retail Group invoice remains outstanding until posted and matched.",
          "Legacy receivables total 12,480 before current-period invoice work.",
          "No allowance adjustment required for this exercise.",
        ],
      },
      {
        id: "acct-merchant-report",
        label: "Merchant Settlement Report",
        kind: "Merchant",
        content: [
          "Stripe payout: 2,184.40",
          "Settlement ties to May web retainers.",
          "Candidate should match this to merchant revenue and clear the bank feed item.",
        ],
      },
      {
        id: "acct-expense-bundle",
        label: "Expense Packet",
        kind: "Receipts",
        content: [
          "Adobe: software subscription, 64.99",
          "Office Depot: office supplies, 238.18",
          "Delta Internet: utilities / internet, 119.00",
          "All three should be categorized before close.",
        ],
      },
    ],
  },
};

function simNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function simCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(simNumber(value));
}

function simPreciseCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(simNumber(value));
}

function simTextReady(value, min = 40) {
  return String(value || "").trim().length >= min;
}

function simReviewedDocCount(type) {
  return Object.values(providerSimState[type]?.reviewedDocs || {}).filter(Boolean).length;
}

function simReviewedDocTotal(type) {
  return Object.keys(providerSimState[type]?.reviewedDocs || {}).length;
}

function getSimLibraryItem(type, kind, id) {
  return (SIM_CASE_LIBRARY[type]?.[kind] || []).find((item) => item.id === id) || null;
}

function calcTaxSim() {
  const s = providerSimState.tax;
  const d = s.data;
  const wages = simNumber(d.wagesPrimary) + simNumber(d.wagesSpouse);
  const withholding = simNumber(d.federalWithholdingPrimary) + simNumber(d.federalWithholdingSpouse);
  const businessExpenses = simNumber(d.advertising) + simNumber(d.contractorLabor) + simNumber(d.supplies) + simNumber(d.vehicleExpense) + simNumber(d.homeOffice);
  const businessNet = simNumber(d.businessGross) - businessExpenses;
  const agi = wages + businessNet + simNumber(d.interestIncome);
  const itemized = Math.min(simNumber(d.stateTax), 10000) + simNumber(d.mortgageInterest) + simNumber(d.charity);
  const standard = 31500;
  const deduction = Math.max(standard, itemized);
  const taxableIncome = Math.max(0, agi - deduction);
  const bracket10 = Math.min(taxableIncome, 23850) * 0.1;
  const bracket12 = Math.max(0, Math.min(taxableIncome, 96950) - 23850) * 0.12;
  const bracket22 = Math.max(0, Math.min(taxableIncome, 206700) - 96950) * 0.22;
  const incomeTax = bracket10 + bracket12 + bracket22;
  const selfEmploymentTax = Math.max(0, businessNet * 0.9235 * 0.153);
  const childCredit = simNumber(d.dependents) > 0 ? 2000 : 0;
  const totalTax = Math.max(0, incomeTax + selfEmploymentTax - childCredit);
  const totalPayments = withholding + simNumber(d.estimatedPayments);
  const refund = Math.max(0, totalPayments - totalTax);
  const amountDue = Math.max(0, totalTax - totalPayments);
  const diagnostics = [];
  if (!s.w2Box12Reviewed) diagnostics.push("W-2 Box 12 retirement code must be reviewed against source document.");
  if (simNumber(s.mileageBusinessUsePct) < 50) diagnostics.push("Schedule C mileage worksheet needs business-use percentage of at least 50% for the demo case.");
  if (!s.routingConfirmed) diagnostics.push("Refund routing and account number must be confirmed before e-file.");
  if (businessNet < 0) diagnostics.push("Schedule C shows a loss; candidate should explain business purpose and supporting records.");
  return { wages, withholding, businessExpenses, businessNet, agi, itemized, standard, deduction, taxableIncome, incomeTax, selfEmploymentTax, childCredit, totalTax, totalPayments, refund, amountDue, diagnostics };
}

function calcAccountsSim() {
  const s = providerSimState.accounts;
  const d = s.data;
  const matchedDeposits = (s.transactions.stripe ? simNumber(d.stripePayout) : 0) + (s.transactions.ach ? simNumber(d.clientAch) : 0);
  const matchedExpenses = (s.transactions.adobe ? simNumber(d.adobe) : 0) + (s.transactions.office ? simNumber(d.officeDepot) : 0) + (s.transactions.internet ? simNumber(d.internet) : 0);
  const sales = simNumber(d.recurringRevenue) + (s.invoicePosted ? simNumber(d.invoiceAmount) : 0);
  const salesTaxPayable = s.invoicePosted ? simNumber(d.invoiceTax) : 0;
  const operatingExpenses = matchedExpenses + simNumber(d.payroll) + simNumber(d.rent);
  const netIncome = sales - operatingExpenses;
  const bankBalance = simNumber(d.openingBank) + matchedDeposits - matchedExpenses;
  const expectedEnding = simNumber(d.statementEnding);
  const reconcileDiff = bankBalance - expectedEnding;
  const unmatched = Object.values(s.transactions).filter((x) => !x).length;
  const ar = s.invoicePosted && !s.transactions.ach ? simNumber(d.invoiceAmount) + simNumber(d.invoiceTax) : 12480;
  return { matchedDeposits, matchedExpenses, sales, salesTaxPayable, operatingExpenses, netIncome, bankBalance, expectedEnding, reconcileDiff, unmatched, ar };
}

function renderSimTasks(tasks) {
  return `
    <section class="sim-card sim-task-card">
      <div class="sim-card-head"><strong>Assessment Tasks</strong><span>${tasks.filter((x) => x.done).length}/${tasks.length} complete</span></div>
      <div class="sim-task-list">
        ${tasks.map((task) => `<div class="sim-task ${task.done ? "done" : ""}"><span>${task.done ? "OK" : ""}</span><div><strong>${escapeHtmlAttr(task.title)}</strong><small>${escapeHtmlAttr(task.detail)}</small></div></div>`).join("")}
      </div>
    </section>`;
}

function taxSimTasks() {
  const s = providerSimState.tax;
  const c = calcTaxSim();
  return [
    { title: "Review client packet", detail: "Read recruiter email, open all client documents, and summarize intake facts.", done: simReviewedDocCount("tax") === simReviewedDocTotal("tax") && simTextReady(s.intakeNotes, 60) },
    { title: "Complete income entry", detail: "Enter W-2, interest, and Schedule C data with correct mileage support.", done: c.wages > 0 && c.businessNet > 0 && simNumber(s.mileageBusinessUsePct) >= 50 },
    { title: "Resolve diagnostics", detail: "Clear W-2, mileage, and bank-routing checks.", done: c.diagnostics.length === 0 && s.diagnosticsRun },
    { title: "Review return", detail: "Validate tax, payments, refund/due, and leave a preparer memo.", done: s.returnReviewed && simTextReady(s.preparerNotes, 60) },
    { title: "Prepare e-file", detail: "Package federal/state return and confirm Form 8879 + refund banking.", done: s.efilePrepared && s.readyFor8879 && s.routingConfirmed },
  ];
}

function accountsSimTasks() {
  const s = providerSimState.accounts;
  const c = calcAccountsSim();
  return [
    { title: "Review close packet", detail: "Read controller email, open the attached packet, and log workpaper notes.", done: simReviewedDocCount("accounts") === simReviewedDocTotal("accounts") && simTextReady(s.workpaperNotes, 60) },
    { title: "Create customer invoice", detail: "Post invoice to A/R and consulting revenue with source support.", done: s.invoicePosted && s.invoiceSupportConfirmed },
    { title: "Match bank feed", detail: "Match deposits and categorize operating expenses.", done: c.unmatched === 0 },
    { title: "Run reports", detail: "Generate P&L / balance sheet and document conclusions.", done: s.reportGenerated && simTextReady(s.reconciliationNotes, 50) },
    { title: "Finish reconciliation", detail: "Tie bank balance to statement and close the period.", done: s.reconciled && Math.abs(c.reconcileDiff) < 1 },
  ];
}

function renderSimCompletionCard(title, complete, rows) {
  return `<section class="sim-card sim-completion-card ${complete ? "complete" : ""}">
    <div class="sim-card-head"><strong>${escapeHtmlAttr(title)}</strong><span>${complete ? "Assessment ready" : "In progress"}</span></div>
    <div class="tax-form-sheet compact">
      ${rows.map((row) => `<div><span>${escapeHtmlAttr(row[0])}</span><strong>${escapeHtmlAttr(row[1])}</strong></div>`).join("")}
      <div class="tax-total"><span>Candidate result state</span><strong>${complete ? "Complete" : "Incomplete"}</strong></div>
    </div>
  </section>`;
}

function renderSimMailModal(type) {
  const stateRef = providerSimState[type];
  if (!stateRef.openMailId) return "";
  const mail = getSimLibraryItem(type, "mailbox", stateRef.openMailId);
  if (!mail) return "";
  const attachments = (mail.attachments || []).map((docId) => getSimLibraryItem(type, "documents", docId)).filter(Boolean);
  return `
    <div class="sim-modal-backdrop">
      <section class="sim-mail-modal" role="dialog" aria-modal="true" aria-label="Case email">
        <header class="sim-mail-modal-head">
          <div>
            <strong>${escapeHtmlAttr(mail.subject)}</strong>
            <span>${escapeHtmlAttr(mail.from)}</span>
          </div>
          <button type="button" class="sim-mail-close" data-sim-action="close-mail-modal" aria-label="Close email">X</button>
        </header>
        <div class="sim-mail-modal-body">
          ${mail.body.map((line) => `<p>${escapeHtmlAttr(line)}</p>`).join("")}
        </div>
        ${attachments.length ? `
          <div class="sim-mail-attachments">
            <div class="sim-list-kicker">Attachments</div>
            <div class="sim-attachment-row">
              ${attachments.map((doc) => `<button type="button" class="sim-attachment-btn" data-sim-open-doc="${escapeHtmlAttr(doc.id)}">${escapeHtmlAttr(doc.label)}</button>`).join("")}
            </div>
          </div>
        ` : ""}
      </section>
    </div>`;
}

function renderSimPortal(type) {
  const stateRef = providerSimState[type];
  const mails = SIM_CASE_LIBRARY[type]?.mailbox || [];
  const docs = SIM_CASE_LIBRARY[type]?.documents || [];
  const currentDoc = getSimLibraryItem(type, "documents", stateRef.selectedDocId) || docs[0] || null;
  const viewerTitle = currentDoc?.label || "Case document";
  const viewerMeta = `${currentDoc?.kind || "Document"} | ${stateRef.reviewedDocs?.[currentDoc?.id] ? "Reviewed" : "Not reviewed"}`;
  const viewerBody = currentDoc?.content || [];
  const noteField = type === "tax"
    ? `
      <label class="sim-note-field">
        <span>Intake summary</span>
        <textarea data-tax-text="intakeNotes" class="sim-textarea" placeholder="Summarize the case facts, filing status, income sources, and missing items.">${escapeHtmlAttr(stateRef.intakeNotes || "")}</textarea>
      </label>
      <label class="sim-note-field">
        <span>Preparer review memo</span>
        <textarea data-tax-text="preparerNotes" class="sim-textarea" placeholder="Document deduction choice, Schedule C logic, and refund review.">${escapeHtmlAttr(stateRef.preparerNotes || "")}</textarea>
      </label>
      <label class="sim-check"><input type="checkbox" data-tax-toggle="readyFor8879" ${stateRef.readyFor8879 ? "checked" : ""}> Form 8879 package ready</label>
    `
    : `
      <label class="sim-note-field">
        <span>Workpaper notes</span>
        <textarea data-account-text="workpaperNotes" class="sim-textarea" placeholder="Summarize close tasks, unresolved items, and supporting documents.">${escapeHtmlAttr(stateRef.workpaperNotes || "")}</textarea>
      </label>
      <label class="sim-note-field">
        <span>Report / reconciliation memo</span>
        <textarea data-account-text="reconciliationNotes" class="sim-textarea" placeholder="Explain P&L result, bank recon result, and any follow-up.">${escapeHtmlAttr(stateRef.reconciliationNotes || "")}</textarea>
      </label>
      <label class="sim-check"><input type="checkbox" data-account-toggle="invoiceSupportConfirmed" ${stateRef.invoiceSupportConfirmed ? "checked" : ""}> Invoice source support confirmed</label>
    `;
  return `
    <aside class="sim-case-panel">
      <section class="sim-card sim-tool-ui-card">
        <div class="sim-card-head"><strong>Case Desk</strong><span>${simReviewedDocCount(type)}/${simReviewedDocTotal(type)} docs reviewed</span></div>
        <div class="sim-case-lists">
          <div class="sim-case-list">
            <div class="sim-list-kicker">Inbox</div>
            ${mails.map((mail) => `<button type="button" class="sim-list-item ${stateRef.selectedMailId === mail.id ? "active" : ""}" data-sim-open-mail="${escapeHtmlAttr(mail.id)}"><strong>${escapeHtmlAttr(mail.subject)}</strong><small>${escapeHtmlAttr(mail.from)}</small></button>`).join("")}
          </div>
          <div class="sim-case-list">
            <div class="sim-list-kicker">Documents</div>
            ${docs.map((doc) => `<div class="sim-doc-item ${stateRef.selectedDocId === doc.id ? "active" : ""}">
              <button type="button" class="sim-list-item" data-sim-open-doc="${escapeHtmlAttr(doc.id)}"><strong>${escapeHtmlAttr(doc.label)}</strong><small>${escapeHtmlAttr(doc.kind)} | ${stateRef.reviewedDocs?.[doc.id] ? "Opened" : "Not opened"}</small></button>
            </div>`).join("")}
          </div>
        </div>
      </section>
      <section class="sim-card sim-viewer-card">
        <div class="sim-card-head"><strong>${escapeHtmlAttr(viewerTitle)}</strong><span>${escapeHtmlAttr(viewerMeta)}</span></div>
        <div class="sim-viewer-body">
          ${viewerBody.map((line) => `<p>${escapeHtmlAttr(line)}</p>`).join("")}
        </div>
      </section>
      <section class="sim-card sim-notes-card">
        <div class="sim-card-head"><strong>Work Notes</strong><span>Saved inside tool</span></div>
        <div class="sim-notes-stack">${noteField}</div>
      </section>
    </aside>`;
}

function renderSimShell(type, clientBar, workspace, status) {
  return `${clientBar}
    <div class="sim-shell-grid">
      <div class="sim-shell-main">${workspace}</div>
      ${renderSimPortal(type)}
    </div>
    <div id="${type === "tax" ? "taxSimStatus" : "accountsSimStatus"}" class="sim-status">${status}</div>
    ${renderSimMailModal(type)}`;
}

function renderTaxSimMain(tab = "Client Profile") {
  const normalized = String(tab || "Client Profile").trim().toLowerCase();
  const s = providerSimState.tax;
  const d = s.data;
  const clientBar = `
    <div class="sim-client-bar">
      <div class="sim-client-summary">
        <strong>${escapeHtmlAttr(d.taxpayer)}</strong>
        <span>TY 2025 | Individual | Status: ${s.efilePrepared ? "Ready to transmit" : s.returnReviewed ? "Reviewed" : "In preparation"}</span>
      </div>
    </div>
  `;
  let workspace = "";
  let status = "Work entirely inside the case desk and tax workspace to complete the filing.";
  const submitButton = `<button type="button" class="btn small primary" data-sim-action="submit-tax-assessment">${s.submitted ? "Assessment Submitted" : "Complete Assessment"}</button>`;
  if (normalized === "interview forms") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Interview Forms</strong></div>
          <div class="tax-input-grid">
            <label>Primary W-2 wages<input data-tax-field="wagesPrimary" value="${d.wagesPrimary}" /></label>
            <label>Primary withholding<input data-tax-field="federalWithholdingPrimary" value="${d.federalWithholdingPrimary}" /></label>
            <label>Spouse W-2 wages<input data-tax-field="wagesSpouse" value="${d.wagesSpouse}" /></label>
            <label>Spouse withholding<input data-tax-field="federalWithholdingSpouse" value="${d.federalWithholdingSpouse}" /></label>
            <label>Interest income<input data-tax-field="interestIncome" value="${d.interestIncome}" /></label>
            <label>Estimated payments<input data-tax-field="estimatedPayments" value="${d.estimatedPayments}" /></label>
          </div>
          <div class="sim-actions">
            <label class="sim-check"><input type="checkbox" data-tax-toggle="profileReviewed" ${s.profileReviewed ? "checked" : ""}> Intake reviewed</label>
            <label class="sim-check"><input type="checkbox" data-tax-toggle="routingConfirmed" ${s.routingConfirmed ? "checked" : ""}> Banking details reviewed</label>
          </div>
        </section>
      </div>`;
    status = "Interview values should match the source documents opened from the case desk.";
  } else if (normalized === "federal 1040") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Federal 1040 Workpaper</strong></div>
          <div class="tax-input-grid">
            <label>Wages<input data-tax-workpaper="wages" value="${escapeHtmlAttr(s.workpaper.wages || "")}" /></label>
            <label>Business income<input data-tax-workpaper="businessIncome" value="${escapeHtmlAttr(s.workpaper.businessIncome || "")}" /></label>
            <label>AGI<input data-tax-workpaper="agi" value="${escapeHtmlAttr(s.workpaper.agi || "")}" /></label>
            <label>Deduction used<input data-tax-workpaper="deduction" value="${escapeHtmlAttr(s.workpaper.deduction || "")}" /></label>
            <label>Taxable income<input data-tax-workpaper="taxableIncome" value="${escapeHtmlAttr(s.workpaper.taxableIncome || "")}" /></label>
            <label>Total tax<input data-tax-workpaper="totalTax" value="${escapeHtmlAttr(s.workpaper.totalTax || "")}" /></label>
            <label>Total payments<input data-tax-workpaper="totalPayments" value="${escapeHtmlAttr(s.workpaper.totalPayments || "")}" /></label>
            <label>Refund / amount due<input data-tax-workpaper="refundOrDue" value="${escapeHtmlAttr(s.workpaper.refundOrDue || "")}" /></label>
          </div>
          <div class="sim-actions"><button type="button" class="btn small primary sim-review-btn" data-sim-action="mark-tax-reviewed">Mark Return Reviewed</button></div>
        </section>
      </div>`;
    status = "Return review should be supported by a preparer memo in the case desk.";
  } else if (normalized === "schedule c") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Schedule C</strong></div>
          <div class="tax-input-grid">
            <label>Gross receipts<input data-tax-field="businessGross" value="${d.businessGross}" /></label>
            <label>Advertising<input data-tax-field="advertising" value="${d.advertising}" /></label>
            <label>Contract labor<input data-tax-field="contractorLabor" value="${d.contractorLabor}" /></label>
            <label>Supplies<input data-tax-field="supplies" value="${d.supplies}" /></label>
            <label>Vehicle expense<input data-tax-field="vehicleExpense" value="${d.vehicleExpense}" /></label>
            <label>Home office<input data-tax-field="homeOffice" value="${d.homeOffice}" /></label>
            <label>Business-use mileage %<input data-tax-meta="mileageBusinessUsePct" value="${s.mileageBusinessUsePct}" /></label>
          </div>
        </section>
        <section class="sim-card">
          <div class="sim-card-head"><strong>Deductions Workpaper</strong></div>
          <div class="tax-input-grid">
            <label>State and local taxes<input data-tax-field="stateTax" value="${d.stateTax}" /></label>
            <label>Mortgage interest<input data-tax-field="mortgageInterest" value="${d.mortgageInterest}" /></label>
            <label>Charitable contributions<input data-tax-field="charity" value="${d.charity}" /></label>
            <label>Dependents<input data-tax-field="dependents" value="${d.dependents}" /></label>
          </div>
        </section>
      </div>`;
    status = "Schedule C and deduction choices should tie back to the attached worksheet.";
  } else if (normalized === "e-file") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Filing Control</strong></div>
          <div class="tax-form-sheet">
            <div><span>Federal return</span><strong>${s.returnReviewed ? "Reviewed" : "Needs review"}</strong></div>
            <div><span>Form 8879 package</span><strong>${s.readyFor8879 ? "Prepared" : "Pending"}</strong></div>
            <div><span>Banking review</span><strong>${s.routingConfirmed ? "Completed" : "Pending"}</strong></div>
            <div><span>Work submission</span><strong>${s.submitted ? "Submitted" : "Not submitted"}</strong></div>
            <div class="tax-total"><span>Filing package</span><strong>${s.efilePrepared ? "Prepared" : "Draft"}</strong></div>
          </div>
          <div class="sim-actions">
            <label class="sim-check"><input type="checkbox" data-tax-toggle="readyFor8879" ${s.readyFor8879 ? "checked" : ""}> Form 8879 package ready</label>
            <button type="button" class="btn small" data-sim-action="prepare-tax-efile">Mark Filing Package Prepared</button>
            ${submitButton}
          </div>
        </section>
      </div>`;
    status = "The candidate can complete and submit the assessment from here, whether or not the work is correct.";
  } else {
    workspace = `
    <div class="sim-workflow-grid">
      <section class="sim-card">
        <div class="sim-card-head"><strong>Client Overview</strong></div>
        <div class="tax-form-sheet">
          <div><span>Primary taxpayer</span><strong>${escapeHtmlAttr(d.taxpayer)}</strong></div>
          <div><span>Spouse</span><strong>${escapeHtmlAttr(d.spouse)}</strong></div>
          <div><span>Filing status</span><strong>${escapeHtmlAttr(d.filingStatus)}</strong></div>
          <div><span>Return type</span><strong>Schedule C filing</strong></div>
          <div><span>Supporting packet</span><strong>${simReviewedDocCount("tax")}/${simReviewedDocTotal("tax")} reviewed</strong></div>
          <div class="tax-total"><span>Assessment status</span><strong>${s.submitted ? "Submitted" : "In progress"}</strong></div>
        </div>
      </section>
      <section class="sim-card">
        <div class="sim-card-head"><strong>Return Workpaper</strong></div>
        <div class="tax-input-grid">
          <label>Wages<input data-tax-workpaper="wages" value="${escapeHtmlAttr(s.workpaper.wages || "")}" /></label>
          <label>Business income<input data-tax-workpaper="businessIncome" value="${escapeHtmlAttr(s.workpaper.businessIncome || "")}" /></label>
          <label>AGI<input data-tax-workpaper="agi" value="${escapeHtmlAttr(s.workpaper.agi || "")}" /></label>
          <label>Deduction<input data-tax-workpaper="deduction" value="${escapeHtmlAttr(s.workpaper.deduction || "")}" /></label>
          <label>Taxable income<input data-tax-workpaper="taxableIncome" value="${escapeHtmlAttr(s.workpaper.taxableIncome || "")}" /></label>
          <label>Refund / amount due<input data-tax-workpaper="refundOrDue" value="${escapeHtmlAttr(s.workpaper.refundOrDue || "")}" /></label>
        </div>
      </section>
    </div>`;
    status = "Use the tabs to complete the tax preparation workflow with the embedded case material.";
  }
  return renderSimShell("tax", clientBar, workspace, status);
}

function renderAccountsSimMain(tab = "Dashboard") {
  const normalized = String(tab || "Dashboard").trim().toLowerCase();
  const s = providerSimState.accounts;
  const d = s.data;
  const clientBar = `
    <div class="sim-client-bar">
      <div class="sim-client-summary"><strong>${escapeHtmlAttr(d.company)}</strong><span>Cash basis | FY 2026 | ${s.reconciled ? "Period closed" : "Books open"}</span></div>
    </div>
  `;
  let workspace = "";
  let status = "Use the case desk and accounting workspace together to complete the close.";
  const submitButton = `<button type="button" class="btn small primary" data-sim-action="submit-accounts-assessment">${s.submitted ? "Assessment Submitted" : "Complete Assessment"}</button>`;
  if (normalized === "banking") {
    const c = calcAccountsSim();
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Bank Feed</strong><span id="bankFeedStatus">${c.unmatched} unmatched</span></div>
          ${renderBankFeedRow("stripe", "Stripe payout", d.stripePayout, "Match to merchant fees revenue")}
          ${renderBankFeedRow("ach", "Client ACH", d.clientAch, "Match to Harbor invoice")}
          ${renderBankFeedRow("adobe", "Adobe subscription", -d.adobe, "Categorize: Software")}
          ${renderBankFeedRow("office", "Office Depot", -d.officeDepot, "Categorize: Office supplies")}
          ${renderBankFeedRow("internet", "Delta Internet", -d.internet, "Categorize: Utilities")}
        </section>
      </div>`;
    status = "Bank transactions should be matched only after reviewing the statement and merchant packet.";
  } else if (normalized === "sales") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Invoice</strong><span>#INV-1048</span></div>
          <div class="qb-invoice">
            <label>Customer<input data-account-field="customer" value="${escapeHtmlAttr(d.customer)}" /></label>
            <label>Service<input data-account-field="invoiceService" value="${escapeHtmlAttr(d.invoiceService)}" /></label>
            <label>Amount<input data-account-field="invoiceAmount" value="${d.invoiceAmount}" /></label>
            <label>Sales tax<input data-account-field="invoiceTax" value="${d.invoiceTax}" /></label>
          </div>
          <div class="sim-actions"><button type="button" class="btn small primary" data-sim-action="post-invoice">Post Invoice</button></div>
        </section>
      </div>`;
    status = "Invoice posting should be supported by the client request email in the case desk.";
  } else if (normalized === "expenses") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Expense Register</strong></div>
          <table class="sim-ledger">
            <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>May 04</td><td>Adobe Inc.</td><td>Software</td><td>${simPreciseCurrency(d.adobe)}</td><td>${s.transactions.adobe ? "Posted" : "Unmatched"}</td></tr>
              <tr><td>May 12</td><td>Office Depot</td><td>Office supplies</td><td>${simPreciseCurrency(d.officeDepot)}</td><td>${s.transactions.office ? "Posted" : "Unmatched"}</td></tr>
              <tr><td>May 18</td><td>Delta Internet</td><td>Utilities</td><td>${simPreciseCurrency(d.internet)}</td><td>${s.transactions.internet ? "Posted" : "Unmatched"}</td></tr>
              <tr><td>May 31</td><td>Payroll</td><td>Wages</td><td>${simPreciseCurrency(d.payroll)}</td><td>Posted</td></tr>
              <tr><td>May 31</td><td>Studio Rent</td><td>Rent</td><td>${simPreciseCurrency(d.rent)}</td><td>Posted</td></tr>
            </tbody>
          </table>
          <div class="sim-actions"><button type="button" class="btn small primary" data-sim-action="review-expenses">Mark Expenses Reviewed</button></div>
        </section>
      </div>`;
    status = "Expense review should tie back to the embedded receipt packet.";
  } else if (normalized === "reports") {
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Reporting Workpaper</strong></div>
          <div class="tax-input-grid">
            <label>Revenue<input data-account-workpaper="revenue" value="${escapeHtmlAttr(s.workpaper.revenue || "")}" /></label>
            <label>Expenses<input data-account-workpaper="expenses" value="${escapeHtmlAttr(s.workpaper.expenses || "")}" /></label>
            <label>Net income<input data-account-workpaper="netIncome" value="${escapeHtmlAttr(s.workpaper.netIncome || "")}" /></label>
          </div>
          <div class="sim-actions"><button type="button" class="btn small primary" data-sim-action="run-pl">Mark Reports Prepared</button></div>
        </section>
        <section class="sim-card">
          <div class="sim-card-head"><strong>Balance Sheet Workpaper</strong></div>
          <div class="tax-input-grid">
            <label>Ending bank<input data-account-workpaper="endingBank" value="${escapeHtmlAttr(s.workpaper.endingBank || "")}" /></label>
            <label>Reconciliation difference<input data-account-workpaper="reconcileDiff" value="${escapeHtmlAttr(s.workpaper.reconcileDiff || "")}" /></label>
          </div>
        </section>
      </div>`;
    status = "Reports should be interpreted in the memo before the close is finalized.";
  } else if (normalized === "reconcile") {
    const complete = accountsSimTasks().every((task) => task.done);
    const c = calcAccountsSim();
    workspace = `
      <div class="sim-workflow-grid">
        <section class="sim-card">
          <div class="sim-card-head"><strong>Reconciliation</strong></div>
          <div class="tax-form-sheet">
            <div><span>Beginning bank balance</span><strong>${simPreciseCurrency(d.openingBank)}</strong></div>
            <div><span>Cleared deposits</span><strong>${simPreciseCurrency(c.matchedDeposits)}</strong></div>
            <div><span>Cleared payments</span><strong>${simPreciseCurrency(c.matchedExpenses)}</strong></div>
            <div><span>Book ending balance</span><strong>${simPreciseCurrency(c.bankBalance)}</strong></div>
            <div><span>Statement ending balance</span><strong>${simPreciseCurrency(c.expectedEnding)}</strong></div>
            <div class="tax-total"><span>Difference</span><strong>${simPreciseCurrency(c.reconcileDiff)}</strong></div>
          </div>
          <div class="sim-actions"><button type="button" class="btn small primary" data-sim-action="reconcile-books">Finish Reconciliation</button>${submitButton}</div>
        </section>
      </div>`;
    status = complete ? "Books are ready to close." : "The candidate can finish the close and submit from here.";
  } else {
    workspace = `
    <div class="sim-workflow-grid">
      <section class="sim-card">
        <div class="sim-card-head"><strong>Company Snapshot</strong></div>
        <div class="tax-form-sheet">
          <div><span>Company</span><strong>${escapeHtmlAttr(d.company)}</strong></div>
          <div><span>Period</span><strong>May 2026</strong></div>
          <div><span>Close packet</span><strong>${simReviewedDocCount("accounts")}/${simReviewedDocTotal("accounts")} reviewed</strong></div>
          <div><span>Invoice support</span><strong>${s.invoiceSupportConfirmed ? "Confirmed" : "Pending"}</strong></div>
          <div class="tax-total"><span>Assessment status</span><strong>${s.submitted ? "Submitted" : "In progress"}</strong></div>
        </div>
      </section>
      <section class="sim-card">
        <div class="sim-card-head"><strong>Close Workpaper</strong></div>
        <div class="tax-input-grid">
          <label>Revenue<input data-account-workpaper="revenue" value="${escapeHtmlAttr(s.workpaper.revenue || "")}" /></label>
          <label>Expenses<input data-account-workpaper="expenses" value="${escapeHtmlAttr(s.workpaper.expenses || "")}" /></label>
          <label>Net income<input data-account-workpaper="netIncome" value="${escapeHtmlAttr(s.workpaper.netIncome || "")}" /></label>
          <label>Ending bank<input data-account-workpaper="endingBank" value="${escapeHtmlAttr(s.workpaper.endingBank || "")}" /></label>
        </div>
      </section>
    </div>`;
    status = "Use Sales, Banking, Reports, and Reconcile to complete accounting work from the embedded case desk.";
  }
  return renderSimShell("accounts", clientBar, workspace, status);
}

function renderBankFeedRow(key, label, amount, memo) {
  const matched = Boolean(providerSimState.accounts.transactions[key]);
  return `<div class="bank-feed-row ${matched ? "matched" : ""}">
    <span><strong>${escapeHtmlAttr(label)}</strong><small>${escapeHtmlAttr(memo)}</small></span>
    <strong>${simPreciseCurrency(amount)}</strong>
    <button type="button" data-sim-action="match-bank" data-bank-key="${escapeHtmlAttr(key)}" ${matched ? "disabled" : ""}>${matched ? "Matched" : amount < 0 ? "Categorize" : "Match"}</button>
  </div>`;
}

function setProviderSimTab(panel, type, tabLabel) {
  panel.querySelectorAll(".sim-nav-links button").forEach((button) => {
    button.classList.toggle("active", String(button.textContent || "").trim() === tabLabel);
  });
  const main = panel.querySelector(".sim-main");
  if (!main) return;
  main.innerHTML = type === "tax" ? renderTaxSimMain(tabLabel) : renderAccountsSimMain(tabLabel);
}

function getProviderSimActiveTab(panel, fallback) {
  return String(panel.querySelector(".sim-nav-links button.active")?.textContent || fallback || "").trim();
}

function refreshProviderSimTab(panel, type) {
  const main = panel.querySelector(".sim-main");
  if (!main) return;
  const tab = getProviderSimActiveTab(panel, type === "tax" ? "Client Profile" : "Dashboard");
  main.innerHTML = type === "tax" ? renderTaxSimMain(tab) : renderAccountsSimMain(tab);
}

function syncProviderTaxInputs(panel) {
  panel.querySelectorAll("[data-tax-field]").forEach((node) => {
    const field = node.getAttribute("data-tax-field");
    if (!field || !(field in providerSimState.tax.data)) return;
    providerSimState.tax.data[field] = simNumber(node.value);
  });
  panel.querySelectorAll("[data-tax-meta]").forEach((node) => {
    const field = node.getAttribute("data-tax-meta");
    if (!field || !(field in providerSimState.tax)) return;
    providerSimState.tax[field] = simNumber(node.value);
  });
  panel.querySelectorAll("[data-tax-toggle]").forEach((node) => {
    const field = node.getAttribute("data-tax-toggle");
    if (!field || !(field in providerSimState.tax)) return;
    providerSimState.tax[field] = Boolean(node.checked);
  });
  panel.querySelectorAll("[data-tax-text]").forEach((node) => {
    const field = node.getAttribute("data-tax-text");
    if (!field || !(field in providerSimState.tax)) return;
    providerSimState.tax[field] = String(node.value || "");
  });
  panel.querySelectorAll("[data-tax-workpaper]").forEach((node) => {
    const field = node.getAttribute("data-tax-workpaper");
    if (!field || !(field in providerSimState.tax.workpaper)) return;
    providerSimState.tax.workpaper[field] = String(node.value || "");
  });
}

function syncProviderAccountsInputs(panel) {
  panel.querySelectorAll("[data-account-field]").forEach((node) => {
    const field = node.getAttribute("data-account-field");
    if (!field || !(field in providerSimState.accounts.data)) return;
    const stringFields = new Set(["customer", "invoiceService", "company"]);
    providerSimState.accounts.data[field] = stringFields.has(field) ? String(node.value || "") : simNumber(node.value);
  });
  panel.querySelectorAll("[data-account-text]").forEach((node) => {
    const field = node.getAttribute("data-account-text");
    if (!field || !(field in providerSimState.accounts)) return;
    providerSimState.accounts[field] = String(node.value || "");
  });
  panel.querySelectorAll("[data-account-toggle]").forEach((node) => {
    const field = node.getAttribute("data-account-toggle");
    if (!field || !(field in providerSimState.accounts)) return;
    providerSimState.accounts[field] = Boolean(node.checked);
  });
  panel.querySelectorAll("[data-account-workpaper]").forEach((node) => {
    const field = node.getAttribute("data-account-workpaper");
    if (!field || !(field in providerSimState.accounts.workpaper)) return;
    providerSimState.accounts.workpaper[field] = String(node.value || "");
  });
}

function renderProviderTaxTool(panel) {
  panel.innerHTML = `
    <section class="sim-tool tax-sim-tool" aria-label="Tax simulation">
      <div class="sim-app-frame tax-app-frame">
        <aside class="sim-nav">
          <div class="sim-nav-title">Tax</div>
          <div class="sim-nav-links">
            <button class="active" type="button">Client Profile</button>
            <button type="button">Interview Forms</button>
            <button type="button">Federal 1040</button>
            <button type="button">Schedule C</button>
            <button type="button">E-file</button>
          </div>
          <div class="sim-nav-footer">
            <button type="button" class="sim-nav-close" data-sim-action="close">Close</button>
          </div>
        </aside>
        <main class="sim-main">
          ${renderTaxSimMain("Client Profile")}
        </main>
      </div>
    </section>
  `;
  panel.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionBtn = target.closest("[data-sim-action]");
    const navBtn = target.closest(".sim-nav-links button");
    if (navBtn) {
      syncProviderTaxInputs(panel);
      setProviderSimTab(panel, "tax", String(navBtn.textContent || "").trim());
      return;
    }
    const openMailId = target.closest("[data-sim-open-mail]")?.getAttribute("data-sim-open-mail");
    if (openMailId) {
      providerSimState.tax.selectedMailId = openMailId;
      providerSimState.tax.openMailId = openMailId;
      refreshProviderSimTab(panel, "tax");
      return;
    }
    const openDocId = target.closest("[data-sim-open-doc]")?.getAttribute("data-sim-open-doc");
    if (openDocId) {
      providerSimState.tax.selectedDocId = openDocId;
      if (openDocId in providerSimState.tax.reviewedDocs) providerSimState.tax.reviewedDocs[openDocId] = true;
      providerSimState.tax.openMailId = "";
      refreshProviderSimTab(panel, "tax");
      return;
    }
    const action = actionBtn?.getAttribute("data-sim-action") || "";
    if (action === "close") {
      closeProviderSimToolWorkspace();
      panel.classList.add("hidden");
      return;
    }
    if (action === "close-mail-modal") {
      providerSimState.tax.openMailId = "";
      refreshProviderSimTab(panel, "tax");
      return;
    }
    if (action === "mark-tax-reviewed") {
      syncProviderTaxInputs(panel);
      providerSimState.tax.returnReviewed = true;
      refreshProviderSimTab(panel, "tax");
      const status = panel.querySelector("#taxSimStatus");
      if (status) status.textContent = "Return marked reviewed.";
    }
    if (action === "prepare-tax-efile") {
      syncProviderTaxInputs(panel);
      providerSimState.tax.efilePrepared = true;
      refreshProviderSimTab(panel, "tax");
      const status = panel.querySelector("#taxSimStatus");
      if (status) status.textContent = "Filing package marked prepared.";
    }
    if (action === "submit-tax-assessment") {
      syncProviderTaxInputs(panel);
      providerSimState.tax.submitted = true;
      refreshProviderSimTab(panel, "tax");
      const status = panel.querySelector("#taxSimStatus");
      if (status) status.textContent = "Tax assessment marked complete.";
    }
  };
  panel.onchange = () => {
    syncProviderTaxInputs(panel);
    refreshProviderSimTab(panel, "tax");
  };
}

function renderProviderAccountsTool(panel) {
  panel.innerHTML = `
    <section class="sim-tool accounts-sim-tool" aria-label="Accounts simulation">
      <div class="sim-app-frame accounts-app-frame">
        <aside class="sim-nav">
          <div class="sim-nav-title">Accounts</div>
          <div class="sim-nav-links">
            <button class="active" type="button">Dashboard</button>
            <button type="button">Banking</button>
            <button type="button">Sales</button>
            <button type="button">Expenses</button>
            <button type="button">Reports</button>
            <button type="button">Reconcile</button>
          </div>
          <div class="sim-nav-footer">
            <button type="button" class="sim-nav-close" data-sim-action="close">Close</button>
          </div>
        </aside>
        <main class="sim-main">
          ${renderAccountsSimMain("Dashboard")}
        </main>
      </div>
    </section>
  `;
  panel.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionBtn = target.closest("[data-sim-action]");
    const navBtn = target.closest(".sim-nav-links button");
    if (navBtn) {
      syncProviderAccountsInputs(panel);
      setProviderSimTab(panel, "accounts", String(navBtn.textContent || "").trim());
      return;
    }
    const openMailId = target.closest("[data-sim-open-mail]")?.getAttribute("data-sim-open-mail");
    if (openMailId) {
      providerSimState.accounts.selectedMailId = openMailId;
      providerSimState.accounts.openMailId = openMailId;
      refreshProviderSimTab(panel, "accounts");
      return;
    }
    const openDocId = target.closest("[data-sim-open-doc]")?.getAttribute("data-sim-open-doc");
    if (openDocId) {
      providerSimState.accounts.selectedDocId = openDocId;
      if (openDocId in providerSimState.accounts.reviewedDocs) providerSimState.accounts.reviewedDocs[openDocId] = true;
      providerSimState.accounts.openMailId = "";
      refreshProviderSimTab(panel, "accounts");
      return;
    }
    const action = actionBtn?.getAttribute("data-sim-action") || "";
    if (action === "close") {
      closeProviderSimToolWorkspace();
      panel.classList.add("hidden");
      return;
    }
    if (action === "close-mail-modal") {
      providerSimState.accounts.openMailId = "";
      refreshProviderSimTab(panel, "accounts");
      return;
    }
    if (action === "post-invoice") {
      syncProviderAccountsInputs(panel);
      providerSimState.accounts.invoicePosted = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      if (status) status.textContent = "Invoice posted to Accounts Receivable and Consulting Revenue.";
    }
    if (action === "match-bank") {
      syncProviderAccountsInputs(panel);
      const key = actionBtn?.getAttribute("data-bank-key") || "";
      if (key && key in providerSimState.accounts.transactions) providerSimState.accounts.transactions[key] = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      const unmatched = calcAccountsSim().unmatched;
      if (status) status.textContent = unmatched ? `Bank feed updated. ${unmatched} transaction${unmatched === 1 ? "" : "s"} still unmatched.` : "All bank feed items matched and categorized.";
    }
    if (action === "review-expenses") {
      syncProviderAccountsInputs(panel);
      providerSimState.accounts.expensesReviewed = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      if (status) status.textContent = "Expenses reviewed and categories accepted.";
    }
    if (action === "reconcile-books") {
      syncProviderAccountsInputs(panel);
      const c = calcAccountsSim();
      if (Math.abs(c.reconcileDiff) < 1 && c.unmatched === 0) providerSimState.accounts.reconciled = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      if (status) status.textContent = providerSimState.accounts.reconciled ? "Reconciliation complete. Month can be closed." : "Reconciliation still has unmatched items or a balance difference.";
    }
    if (action === "run-pl") {
      syncProviderAccountsInputs(panel);
      providerSimState.accounts.reportGenerated = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      if (status) status.textContent = "Reports marked prepared.";
    }
    if (action === "submit-accounts-assessment") {
      syncProviderAccountsInputs(panel);
      providerSimState.accounts.submitted = true;
      refreshProviderSimTab(panel, "accounts");
      const status = panel.querySelector("#accountsSimStatus");
      if (status) status.textContent = "Accounts assessment marked complete.";
    }
  };
  panel.onchange = () => {
    syncProviderAccountsInputs(panel);
    refreshProviderSimTab(panel, "accounts");
  };
}

function openProviderAssessmentTool(tool) {
  const panel = el.providerAssessmentToolPanel;
  if (!panel) return;
  const normalized = String(tool || "").trim().toLowerCase();
  panel.classList.remove("hidden");
  if (normalized === "coding" || normalized === "code" || normalized === "vscode" || normalized === "vs-code" || normalized === "vs code") {
    panel.classList.add("hidden");
    window.location.assign(providerCodingWorkspaceUrl());
    return;
  }
  if (normalized === "tax") {
    panel.classList.add("hidden");
    openProviderSimToolWorkspace("tax");
    return;
  }
  if (normalized === "accounts" || normalized === "accounting") {
    panel.classList.add("hidden");
    openProviderSimToolWorkspace("accounts");
    return;
  }
  if (normalized === "excel" || normalized === "spreadsheet") {
    panel.classList.add("hidden");
    window.location.assign(providerExcelWorkspaceUrl());
    return;
  }
  if (normalized !== "excel") {
    const labels = {
      coding: "Coding Env",
    };
    panel.innerHTML = `<strong>${escapeHtmlAttr(labels[normalized] || "Tool")}</strong><div class="meta" style="margin-top:6px;">This tool runtime is queued after Excel.</div>`;
    return;
  }
}

function bindEvents() {
  initializeLiveIconButtons();
  refreshLiveFullscreenButton();
  let appNetworkHideTimer = null;
  window.addEventListener("certora:network-busy", (event) => {
    const pending = Number(event?.detail?.pending || 0);
    if (pending > 0) {
      if (appNetworkHideTimer) {
        clearTimeout(appNetworkHideTimer);
        appNetworkHideTimer = null;
      }
      el.appNetworkBusy?.classList.remove("hidden");
      if (el.appNetworkBusyText) {
        el.appNetworkBusyText.textContent = pending > 1 ? `Loading ${pending} tasks...` : "Loading...";
      }
      return;
    }
    appNetworkHideTimer = setTimeout(() => {
      el.appNetworkBusy?.classList.add("hidden");
      if (el.appNetworkBusyText) el.appNetworkBusyText.textContent = "Loading...";
    }, 180);
  });
  window.addEventListener("resize", () => {
    if (state.liveRoom.participantsOpen) positionLiveParticipantsMenu();
  });
  const isStudentPlayerOpen = () => {
    const courseView = document.getElementById("student-view-course");
    const viewer = document.getElementById("studentCourseViewer");
    if (!courseView || !viewer) return false;
    return !courseView.classList.contains("hidden") && !viewer.classList.contains("hidden");
  };
  const pauseProtectedPlayback = (showHint = false) => {
    const now = Date.now();
    const cw = $("cwVideoPreview");
    const pcv = $("pcvVideo");
    const scv = $("scvVideo");
    [cw, pcv, scv].forEach((video) => {
      try {
        if (video && !video.paused) video.pause();
      } catch {}
    });
    if (state.studentViewerMode === "stream") {
      const frame = $("scvStreamFrame");
      if (frame && !frame.classList.contains("hidden")) {
        forceStopStudentStreamPlayback();
      }
    }
    if (showHint && isStudentPlayerOpen()) {
      const last = Number(state.studentSeekHintAt || 0);
      if (now - last > 2500) {
        state.studentSeekHintAt = now;
        toast("Playback paused for content protection.", "error");
      }
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseProtectedPlayback(true);
  });
  window.addEventListener("blur", () => {
    pauseProtectedPlayback(true);
  });
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const suspiciousCaptureCombo = key === "PrintScreen"
      || ((event.ctrlKey || event.metaKey) && event.shiftKey && (lower === "s" || lower === "r" || lower === "5"));
    if (suspiciousCaptureCombo) {
      pauseProtectedPlayback(true);
    }
  });
  el.liveRoomStageShell?.addEventListener("mousemove", () => {
    pokeLiveControlDock();
  });
  el.liveRoomStageShell?.addEventListener("pointermove", () => {
    pokeLiveControlDock();
  });
  el.liveRoomStageShell?.addEventListener("touchstart", () => {
    pokeLiveControlDock();
  }, { passive: true });
  el.liveRoomControlDock?.addEventListener("mouseenter", () => {
    state.liveRoom.controlDockPointerInside = true;
    setLiveControlDockVisibility(true);
    clearLiveControlDockIdleTimer();
  });
  el.liveRoomControlDock?.addEventListener("mouseleave", () => {
    state.liveRoom.controlDockPointerInside = false;
    scheduleLiveControlDockAutoHide();
  });
  el.liveRoomControlDock?.addEventListener("focusin", () => {
    state.liveRoom.controlDockPointerInside = true;
    setLiveControlDockVisibility(true);
    clearLiveControlDockIdleTimer();
  });
  el.liveRoomControlDock?.addEventListener("focusout", () => {
    state.liveRoom.controlDockPointerInside = false;
    scheduleLiveControlDockAutoHide();
  });
  el.liveRoomStageTopbar?.addEventListener("mouseenter", () => {
    state.liveRoom.topbarPointerInside = true;
    setLiveControlDockVisibility(true);
    clearLiveControlDockIdleTimer();
  });
  el.liveRoomStageTopbar?.addEventListener("mouseleave", () => {
    state.liveRoom.topbarPointerInside = false;
    scheduleLiveControlDockAutoHide();
  });
  el.liveRoomStageTopbar?.addEventListener("focusin", () => {
    state.liveRoom.topbarPointerInside = true;
    setLiveControlDockVisibility(true);
    clearLiveControlDockIdleTimer();
  });
  el.liveRoomStageTopbar?.addEventListener("focusout", () => {
    state.liveRoom.topbarPointerInside = false;
    scheduleLiveControlDockAutoHide();
  });
  el.showSignupBtn?.addEventListener("click", () => showAuthMode("signup"));
  el.showLoginBtn?.addEventListener("click", () => showAuthMode("login"));

  $("loginBtn")?.addEventListener("click", async () => {
    if (!ensureAuthReady()) return;
    const email = el.loginEmail.value.trim().toLowerCase();
    const rawPassword = el.loginPassword.value;
    const trimmedPassword = rawPassword.trim();
    try {
      state.authLoginInFlight = true;
      showAuthProgress("Signing you in", "Verifying email and password...");
      if (state.authMode === "dummy") {
        const role = email.includes("student") ? "student" : email.includes("admin") ? "admin" : "provider";
        const context = await enterLocalDummyWorkspace(email, role);
        state.authLoginInFlight = false;
        hideAuthProgress();
        if (context) toast("Local dummy login successful");
        return;
      }
      let loggedIn = false;
      let breakglassErrorMessage = "";
      try {
        await signInWithEmailAndPassword(state.auth, email, rawPassword);
        loggedIn = true;
      } catch (primaryErr) {
        if (String(primaryErr?.code || "").includes("auth/invalid-credential")) {
          // Common operator mistake: copied password with leading/trailing spaces.
          if (rawPassword !== trimmedPassword) {
            try {
              await signInWithEmailAndPassword(state.auth, email, trimmedPassword);
              loggedIn = true;
              toast("Removed leading/trailing spaces from password input.");
            } catch {}
          }
          // Break-glass admin login: admin email + recovery key in password field.
          if (!loggedIn) {
            try {
              const out = await api("POST", "/auth/admin/breakglass-login", { email, password: rawPassword }, false);
              if (out?.custom_token) {
                await signInWithCustomToken(state.auth, out.custom_token);
                loggedIn = true;
              } else if (out?.password_login_ready) {
                await signInWithEmailAndPassword(state.auth, email, rawPassword);
                loggedIn = true;
              }
            } catch (breakglassErr) {
              breakglassErrorMessage = String(breakglassErr?.message || breakglassErr || "").trim();
            }
          }
          if (!loggedIn && email === "admin@certora.in") {
            if (breakglassErrorMessage) {
              throw new Error(
                `Admin break-glass login failed. ${breakglassErrorMessage}`,
              );
            }
            throw new Error(
              "Admin break-glass login failed. Verify latest deployment and ADMIN_RECOVERY_KEY env variable.",
            );
          }
          if (!loggedIn && state.authMode === "dummy") {
            const role = email.includes("student") ? "student" : email.includes("admin") ? "admin" : "provider";
            const context = await enterLocalDummyWorkspace(email, role);
            state.authLoginInFlight = false;
            hideAuthProgress();
            if (context) toast("Local dummy login successful");
            return;
          }
          if (!loggedIn) throw primaryErr;
        } else {
          throw primaryErr;
        }
      }
      if (state.authLoginFallbackTimer) clearTimeout(state.authLoginFallbackTimer);
      state.authLoginFallbackTimer = setTimeout(async () => {
        if (!state.authLoginInFlight || !state.auth?.currentUser) return;
        try {
          showAuthProgress("Loading your workspace", "Preparing your dashboard...");
          const context = await loadSessionContext();
          if (context) toast("Login successful");
        } catch (err) {
          toast(formatAuthError(err, "Session load failed"), "error");
        } finally {
          state.authLoginInFlight = false;
          hideAuthProgress();
        }
      }, 250);
    } catch (err) {
      state.authLoginInFlight = false;
      hideAuthProgress();
      toast(formatAuthError(err, "Login failed"), "error");
      log("login_error", String(err));
    }
  });

  $("googleBtn")?.addEventListener("click", async () => {
    if (!ensureAuthReady()) return;
    try {
      state.authLoginInFlight = true;
      showAuthProgress("Signing in with Google", "Authenticating your Google account...");
      const provider = new GoogleAuthProvider();
      await signInWithPopup(state.auth, provider);
      if (state.authLoginFallbackTimer) clearTimeout(state.authLoginFallbackTimer);
      state.authLoginFallbackTimer = setTimeout(async () => {
        if (!state.authLoginInFlight || !state.auth?.currentUser) return;
        try {
          showAuthProgress("Loading your workspace", "Preparing your dashboard...");
          const context = await loadSessionContext();
          if (context) toast("Login successful");
        } catch (err) {
          toast(formatAuthError(err, "Session load failed"), "error");
        } finally {
          state.authLoginInFlight = false;
          hideAuthProgress();
        }
      }, 250);
    } catch (err) {
      state.authLoginInFlight = false;
      hideAuthProgress();
      toast(formatAuthError(err, "Google login failed"), "error");
      log("google_error", String(err));
    }
  });

  $("signupBtn")?.addEventListener("click", async () => {
    if (!ensureAuthReady()) return;
    try {
      const name = el.signupName.value.trim();
      const email = el.signupEmail.value.trim().toLowerCase();
      const password = el.signupPassword.value.trim();
      const role = el.signupRole.value;
      if (!name || !email || !password) throw new Error("Name, email, and password are required.");
      const activeEmail = String(state.auth?.currentUser?.email || "").trim().toLowerCase();
      if (activeEmail && activeEmail !== email) {
        await signOut(state.auth);
      }
      try {
        localStorage.setItem("certora_signup_role_intent", role);
      } catch {}
      state.authRoleSetupInFlight = true;
      let cred = null;
      try {
        cred = await createUserWithEmailAndPassword(state.auth, email, password);
      } catch (firebaseErr) {
        if (String(firebaseErr?.code || "").includes("auth/email-already-in-use")) {
          // Existing Firebase auth user: continue setup if password is valid.
          try {
            cred = await signInWithEmailAndPassword(state.auth, email, password);
          } catch (signInErr) {
            if (String(signInErr?.code || "").includes("auth/invalid-credential")) {
              throw new Error(
                "This email is already registered with a different password. Use Login (or reset password) instead of Signup.",
              );
            }
            throw signInErr;
          }
        } else {
          throw firebaseErr;
        }
      }
      await updateProfile(cred.user, { displayName: name });
      let roleSetupDone = false;
      let lastRoleErr = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await api("POST", "/auth/register-role", buildRoleRegistrationPayload(name, role));
          roleSetupDone = true;
          break;
        } catch (roleErr) {
          lastRoleErr = roleErr;
          await cred.user.getIdToken(true).catch(() => {});
          await new Promise((r) => setTimeout(r, 350 + (attempt * 250)));
        }
      }
      if (!roleSetupDone && lastRoleErr) throw lastRoleErr;
      await cred.user.getIdToken(true).catch(() => {});
      state.authRoleSetupInFlight = false;
      let context = await loadSessionContext();
      if (context?.role && context.role !== role) {
        await api("POST", "/auth/register-role", buildRoleRegistrationPayload(name, role));
        await cred.user.getIdToken(true).catch(() => {});
        context = await loadSessionContext();
      }
      try {
        localStorage.removeItem("certora_signup_role_intent");
      } catch {}
      toast("Account created");
    } catch (err) {
      state.authRoleSetupInFlight = false;
      const requestedEmail = String(el.signupEmail?.value || "").trim().toLowerCase();
      const currentEmail = String(state.auth?.currentUser?.email || "").trim().toLowerCase();
      if (requestedEmail && currentEmail && currentEmail === requestedEmail) {
        try {
          const fallbackRole = String(localStorage.getItem("certora_signup_role_intent") || "").trim().toLowerCase();
          let context = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
              context = await loadSessionContext();
              if (["student", "provider"].includes(fallbackRole) && context?.role && context.role !== fallbackRole) {
                await api(
                  "POST",
                  "/auth/register-role",
                  buildRoleRegistrationPayload(el.signupName?.value?.trim() || "User", fallbackRole),
                );
                await state.auth.currentUser.getIdToken(true).catch(() => {});
                await new Promise((r) => setTimeout(r, 300 + (attempt * 250)));
                context = await loadSessionContext();
              }
              break;
            } catch {
              await state.auth?.currentUser?.getIdToken?.(true).catch(() => {});
              await new Promise((r) => setTimeout(r, 350 + (attempt * 250)));
            }
          }
          try {
            localStorage.removeItem("certora_signup_role_intent");
          } catch {}
          toast("Account created");
          return;
        } catch {}
      }
      toast(formatAuthError(err, "Signup failed"), "error");
      log("signup_error", String(err));
    }
  });

  el.forgotPasswordBtn?.addEventListener("click", async () => {
    if (!ensureAuthReady()) return;
    const email = String(el.loginEmail?.value || "").trim().toLowerCase();
    if (!email) {
      toast("Enter your email first, then click Forgot Password.", "error");
      return;
    }
    try {
      await sendPasswordResetEmail(state.auth, email);
      toast("Password reset email sent. Check inbox/spam.");
    } catch (err) {
      toast(formatAuthError(err, "Password reset failed"), "error");
      log("password_reset_error", String(err));
    }
  });

  el.logoutBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        stopAdminPolling();
        hideAuthProgress();
        state.localAccessToken = "";
        state.localDummyRole = "";
        state.localDummyEmail = "";
        state.localDummyName = "";
        state.context = null;
        if (state.auth) await signOut(state.auth);
        showView("auth");
        showAuthMode("login");
        setSessionBadge("Not signed in");
        setUserUidBadge("");
        el.logoutBtns.forEach((b) => {
          b.disabled = true;
        });
        toast("Logged out");
      } catch (err) {
        toast("Logout failed", "error");
      }
    });
  });

  $("nonAdminBackToLoginBtn")?.addEventListener("click", async () => {
    try {
      hideAuthProgress();
      state.localAccessToken = "";
      state.localDummyRole = "";
      state.localDummyEmail = "";
      state.localDummyName = "";
      state.context = null;
      if (state.auth?.currentUser) await signOut(state.auth);
    } catch {}
    showView("auth");
    showAuthMode("login");
    setSessionBadge("Not signed in");
    setUserUidBadge("");
    el.logoutBtns.forEach((b) => {
      b.disabled = true;
    });
  });

  el.nonAdminUpdateRoleBtn?.addEventListener("click", async () => {
    try {
      if (!ensureAuthReady()) return;
      const nextRole = el.nonAdminRoleSelect?.value || "student";
      const fullName = state.auth?.currentUser?.displayName || state.context?.full_name || "User";
      await api("POST", "/auth/register-role", buildRoleRegistrationPayload(fullName, nextRole));
      await state.auth?.currentUser?.getIdToken(true).catch(() => {});
      toast("Account type updated");
      await loadSessionContext();
    } catch (err) {
      toast(err?.message || "Failed to update account type", "error");
    }
  });

  el.settingsToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const menu = toggle.nextElementSibling;
      if (!(menu instanceof HTMLElement)) return;
      const willOpen = menu.classList.contains("hidden");
      el.settingsMenus.forEach((m) => m.classList.add("hidden"));
      if (willOpen) menu.classList.remove("hidden");
    });
  });
  el.sessionBadges.forEach((badge) => {
    badge.addEventListener("click", () => {
      openCurrentUserProfilePage();
    });
  });
  el.collapseWorkspaceBtns.forEach((btn) => {
    btn.addEventListener("click", () => toggleWorkspaceCollapse());
  });
  el.adminRecoveryBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      runAdminRecoveryFlow().catch(() => {});
    });
  });
  el.changePasswordBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      runSelfPasswordChangeFlow().catch(() => {});
    });
  });
  el.adminPasswordBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      runAdminSetUserPasswordFlow().catch(() => {});
    });
  });
  $("providerProfileBackBtn")?.addEventListener("click", () => activateProviderSubView("home"));
  $("studentProfileBackBtn")?.addEventListener("click", () => activateStudentSubView("home"));
  $("adminProfileBackBtn")?.addEventListener("click", () => activateAdminSubView("home"));
  el.studentAvailableCourseBackBtn?.addEventListener("click", () => activateStudentSubView("available"));
  $("providerProfileSaveEmailBtn")?.addEventListener("click", () => {
    saveProfileEmail("provider").catch(() => {});
  });
  $("studentProfileSaveEmailBtn")?.addEventListener("click", () => {
    saveProfileEmail("student").catch(() => {});
  });
  $("adminProfileSaveEmailBtn")?.addEventListener("click", () => {
    saveProfileEmail("admin").catch(() => {});
  });
  el.workspaceExpandFab?.addEventListener("click", () => {
    if (!document.body.classList.contains("workspace-collapsed")) return;
    applyWorkspaceCollapse(false);
    try {
      localStorage.setItem("certora_workspace_collapsed", "0");
    } catch {}
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const insideAnySettings = el.settingsToggles.some((t) => t.contains(target))
      || el.settingsMenus.some((m) => m.contains(target));
    if (!insideAnySettings) {
      el.settingsMenus.forEach((m) => m.classList.add("hidden"));
    }
    const filterNodes = [
      [el.studentAvailableFilterBtn, el.studentAvailableFilterMenu],
      [el.studentEnrolledFilterBtn, el.studentEnrolledFilterMenu],
      [el.studentAssessmentsFilterBtn, el.studentAssessmentsFilterMenu],
      [el.studentCertificationsFilterBtn, el.studentCertificationsFilterMenu],
      [el.providerCoursesFilterBtn, el.providerCoursesFilterMenu],
      [el.providerAssessmentToolsBtn, el.providerAssessmentToolsMenu],
    ];
    filterNodes.forEach(([btn, menu]) => {
      if (!menu) return;
      const inside = (btn && btn.contains(target)) || menu.contains(target);
      if (!inside) menu.classList.add("hidden");
      if (btn && !inside) btn.classList.remove("active");
    });
  });

  bindPasswordToggle(el.loginPassword, el.loginShowPasswordBtn);
  bindPasswordToggle(el.signupPassword, el.signupShowPasswordBtn);

  document.querySelectorAll(".nav-btn:not(.provider-nav-btn)").forEach((btn) => {
    btn.addEventListener("click", () => activateAdminSubView(btn.dataset.view));
  });

  document.querySelectorAll(".provider-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateProviderSubView(btn.dataset.providerView));
  });
  document.querySelectorAll(".student-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateStudentSubView(btn.dataset.studentView));
  });

  document.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      state.moderationMode = btn.dataset.mode;
      renderModerationPanel();
    });
  });

  document.querySelectorAll(".approval-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.approvalsTab = btn.dataset.approvalTab;
      renderApprovalsTab();
    });
  });

  el.moderationSearch?.addEventListener("input", () => renderModerationPanel());
  el.moderationStatusFilter?.addEventListener("change", () => renderModerationPanel());

  const downloadFile = async (url, filename) => {
    const res = await fetch(url, { headers: await getHeaders(true) });
    if (!res.ok) throw new Error(`Failed to export ${filename}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  $("exportReportsBtn")?.addEventListener("click", async () => {
    try { await downloadFile("/admin/reports/export.csv", "reports.csv"); toast("Reports CSV exported"); } catch { toast("Export failed", "error"); }
  });
  $("exportComplaintsBtn")?.addEventListener("click", async () => {
    try { await downloadFile("/admin/complaints/export.csv", "complaints.csv"); toast("Compliants CSV exported"); } catch { toast("Export failed", "error"); }
  });
  el.adminUsersSearch?.addEventListener("input", () => {
    refreshAdminUsers().catch(() => toast("Failed to refresh users", "error"));
  });
  el.refreshAdminUsersBtn?.addEventListener("click", () => {
    refreshAdminUsers().catch(() => toast("Failed to refresh users", "error"));
  });

  $("openCourseWizardBtn")?.addEventListener("click", () => {
    ensureCourseWizardMounted();
    activateProviderSubView("course-create");
    el.courseWizard?.classList.remove("hidden");
    el.providerDraftsPage?.classList.add("hidden");
    resetCourseWizard();
  });
  $("openDraftsPageBtn")?.addEventListener("click", async () => {
    try {
      await refreshProviderDrafts();
      $("providerCoursesHeader")?.classList.add("hidden");
      $("providerCoursesList")?.classList.add("hidden");
      $("courseWizard")?.classList.add("hidden");
      el.providerCourseViewer?.classList.add("hidden");
      el.providerDraftsPage?.classList.remove("hidden");
    } catch {
      toast("Failed to open drafts", "error");
    }
  });
  $("closeDraftsPageBtn")?.addEventListener("click", () => {
    el.providerDraftsPage?.classList.add("hidden");
    $("providerCoursesHeader")?.classList.remove("hidden");
    $("providerCoursesList")?.classList.remove("hidden");
  });
  $("refreshDraftsBtn")?.addEventListener("click", () => refreshProviderDrafts().catch(() => toast("Failed to refresh drafts", "error")));
  $("closeCourseWizardBtn")?.addEventListener("click", () => {
    el.courseWizard?.classList.add("hidden");
    activateProviderSubView("courses");
  });
  $("closeCourseCreatePageBtn")?.addEventListener("click", () => {
    el.courseWizard?.classList.add("hidden");
    activateProviderSubView("courses");
  });
  $("cwSaveDraftBtn")?.addEventListener("click", async () => {
    try {
      const out = await saveDraftFromWizard();
      toast(`Draft saved (#${out.draft_id})`);
      await refreshProviderDrafts();
    } catch {
      toast("Failed to save draft", "error");
    }
  });
  $("cwSaveDraftBtn2")?.addEventListener("click", async () => {
    try {
      const out = await saveDraftFromWizard();
      toast(`Draft saved (#${out.draft_id})`);
      await refreshProviderDrafts();
    } catch {
      toast("Failed to save draft", "error");
    }
  });
  $("cwSaveDraftBtn3")?.addEventListener("click", async () => {
    try {
      const out = await saveDraftFromWizard();
      toast(`Draft saved (#${out.draft_id})`);
      await refreshProviderDrafts();
    } catch {
      toast("Failed to save draft", "error");
    }
  });
  $("cwUploadVideoBtn")?.addEventListener("click", () => $("cwVideoFile")?.click());
  $("cwVideoFile")?.addEventListener("change", async () => {
    const file = $("cwVideoFile")?.files?.[0];
    if (!file) return;
    if (state.wizardVideoUploadPromise) return toast("Video upload is already in progress", "error");
    try {
      setWizardVideoPreviewFromLocalFile(file);
      state.wizardVideoUploadPromise = uploadLocalVideoInChunks(file, { progressStart: 4, progressEnd: 100 });
      await state.wizardVideoUploadPromise;
      toast("Video uploaded");
    } catch (err) {
      toast(err?.message || "Video upload failed", "error");
    } finally {
      state.wizardVideoUploadPromise = null;
    }
  });
  $("cwUploadThumbnailBtn")?.addEventListener("click", () => $("cwThumbnailFile")?.click());
  $("cwThumbnailFile")?.addEventListener("change", async () => {
    const file = $("cwThumbnailFile")?.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setThumbnailValue(String(dataUrl));
      toast("Thumbnail selected");
    } catch {
      toast("Failed to load thumbnail image", "error");
    }
  });
  $("cwUseCurrentFrameBtn")?.addEventListener("click", async () => {
    const preview = $("cwVideoPreview");
    const videoUrl = state.wizardVideoPlaybackUrl || $("cwVideoUrl")?.value?.trim();
    if (!videoUrl) return toast("Video URL required first", "error");
    let frame = "";
    if (preview && preview.getAttribute("src")) {
      frame = captureFrameFromVideoElement(preview);
    }
    if (!frame) {
      const seconds = Math.floor(preview?.currentTime || 0);
      frame = await captureThumbnailAt(videoUrl, seconds);
    }
    if (!frame) return toast("Could not capture frame from video", "error");
    setThumbnailValue(frame);
    toast("Thumbnail captured from video");
  });
  $("cwCourseThumbnail")?.addEventListener("input", () => refreshThumbnailPreview());
  $("cwNextToVideoBtn")?.addEventListener("click", () => {
    const title = $("cwCourseTitle")?.value?.trim();
    if (!title) return toast("Course name is required", "error");
    setCourseWizardStep("video");
  });
  $("cwBackToDetailsBtn")?.addEventListener("click", () => setCourseWizardStep("details"));
  $("cwNextToTopicsBtn")?.addEventListener("click", () => {
    const videoUrl = $("cwVideoUrl")?.value?.trim();
    const localVideoFile = $("cwVideoFile")?.files?.[0] || null;
    if (state.wizardVideoUploadPromise) return toast("Video is still uploading. Please wait.", "error");
    if (!videoUrl && !localVideoFile) return toast("Video URL or local video file is required", "error");
    const thumbnail = $("cwCourseThumbnail")?.value?.trim();
    if (!thumbnail) return toast("Thumbnail is required. Upload one or capture from video.", "error");
    setCourseWizardStep("topics");
  });
  $("cwBackToVideoBtn")?.addEventListener("click", () => setCourseWizardStep("video"));
  $("cwNextToPricingBtn")?.addEventListener("click", () => {
    setCourseWizardStep("pricing");
  });
  $("cwBackToTopicsBtn")?.addEventListener("click", () => setCourseWizardStep("topics"));
  $("cwBasePriceAmount")?.addEventListener("input", () => refreshWizardPricing());
  $("cwLoadVideoPreviewBtn")?.addEventListener("click", () => {
    ensureCourseVideoPreview();
    updateVideoTimeMeta();
    renderDraftTopics();
  });
  $("cwUseCurrentTimeBtn")?.addEventListener("click", () => {
    const video = $("cwVideoPreview");
    const input = $("cwTopicTime");
    if (!video || !input) return;
    input.value = formatSecondsToClock(Math.floor(video.currentTime || 0));
  });
  $("cwVideoPreview")?.addEventListener("timeupdate", () => updateVideoTimeMeta());
  $("cwVideoPreview")?.addEventListener("loadedmetadata", () => {
    updateVideoTimeMeta();
    renderDraftTopics();
  });
  $("cwAddTopicBtn")?.addEventListener("click", async () => {
    const title = $("cwTopicTitle")?.value?.trim();
    const timeRaw = $("cwTopicTime")?.value?.trim();
    const seconds = parseTimeToSeconds(timeRaw);
    if (!title) return toast("Topic name is required", "error");
    if (Number.isNaN(seconds)) return toast("Invalid topic time. Use mm:ss or hh:mm:ss", "error");
    const videoUrl = state.wizardVideoPlaybackUrl || $("cwVideoUrl")?.value?.trim();
    const thumb = videoUrl ? await captureThumbnailAt(videoUrl, seconds) : "";
    state.draftTopics.push({ title, time_seconds: seconds, thumbnail_data_url: thumb });
    $("cwTopicTitle").value = "";
    $("cwTopicTime").value = "";
    renderDraftTopics();
  });
  $("pcvCloseBtn")?.addEventListener("click", () => {
    closeProviderUnifiedViewer();
    $("providerDraftsPage")?.classList.add("hidden");
  });
  $("pcvVideo")?.addEventListener("timeupdate", () => updateViewerTimeMeta());
  $("pcvVideo")?.addEventListener("loadedmetadata", () => updateViewerTimeMeta());
  $("scvVideo")?.addEventListener("timeupdate", () => {
    updateStudentPlaybackPolicyFromVideo($("scvVideo"));
    updateStudentViewerTimeMeta();
    maybeUnlockAssessmentFromPlayback().catch(() => {});
  });
  $("scvVideo")?.addEventListener("loadedmetadata", () => {
    updateStudentPlaybackPolicyFromVideo($("scvVideo"));
    updateStudentViewerTimeMeta();
    refreshStudentSeekUi();
  });
  $("scvCloseBtn")?.addEventListener("click", () => {
    if (state.context?.role === "provider" && state.providerUsingStudentViewer) {
      closeProviderUnifiedViewer();
      return;
    }
    stopStudentStreamHeartbeat();
    setStudentViewerMode("legacy");
    $("scvVideoShell")?.classList.remove("minimized");
    el.studentCourseViewer?.classList.add("hidden");
    activateStudentSubView("enrolled");
  });
  const scvShell = $("scvVideoShell");
  const scvVolume = $("scvVolume");
  const scvVolumeToggleBtn = $("scvVolumeToggleBtn");
  const scvMiniCloseBtn = $("scvMiniCloseBtn");
  const scvVideo = $("scvVideo");
  const scvStreamFrame = $("scvStreamFrame");
  let scvMountParent = scvShell?.parentElement || null;
  let scvMountNextSibling = scvShell?.nextSibling || null;
  const restoreScvShell = () => {
    if (!scvShell || !scvMountParent || scvShell.parentElement === scvMountParent) return;
    if (scvMountNextSibling && scvMountNextSibling.parentNode === scvMountParent) {
      scvMountParent.insertBefore(scvShell, scvMountNextSibling);
    } else {
      scvMountParent.appendChild(scvShell);
    }
    scvShell.classList.remove("scv-shell-detached");
    scvShell.style.left = "";
    scvShell.style.top = "";
    scvShell.style.right = "";
    scvShell.style.bottom = "";
  };
  const detachScvShell = () => {
    if (!scvShell || scvShell.parentElement === document.body) return;
    scvMountParent = scvShell.parentElement;
    scvMountNextSibling = scvShell.nextSibling;
    document.body.appendChild(scvShell);
    scvShell.classList.add("scv-shell-detached");
  };
  const tryEnterPipForScv = async () => {
    if (!scvVideo || state.studentViewerMode === "stream") return;
    if (!document.pictureInPictureEnabled || typeof scvVideo.requestPictureInPicture !== "function") return;
    if (document.pictureInPictureElement === scvVideo) return;
    try { await scvVideo.requestPictureInPicture(); } catch {}
  };
  const tryExitPipForScv = async () => {
    if (document.pictureInPictureElement !== scvVideo || typeof document.exitPictureInPicture !== "function") return;
    try { await document.exitPictureInPicture(); } catch {}
  };
  scvShell?.addEventListener("player-minimize-change", (event) => {
    const minimized = Boolean(event?.detail?.minimized);
    if (minimized) {
      detachScvShell();
      tryEnterPipForScv().catch(() => {});
    } else {
      restoreScvShell();
      tryExitPipForScv().catch(() => {});
    }
  });
  const attachPlaybackHardening = (node) => {
    if (!node) return;
    node.addEventListener("contextmenu", (event) => event.preventDefault());
    node.addEventListener("dragstart", (event) => event.preventDefault());
  };
  attachPlaybackHardening($("cwVideoShell"));
  attachPlaybackHardening($("pcvVideoShell"));
  attachPlaybackHardening(scvShell);
  const ensureScvWatermark = () => {
    if (!scvShell) return null;
    let node = scvShell.querySelector(".scv-watermark");
    if (!node) {
      node = document.createElement("div");
      node.className = "scv-watermark";
      scvShell.appendChild(node);
    }
    return node;
  };
  const refreshScvWatermark = () => {
    const node = ensureScvWatermark();
    if (!node) return;
    const courseOpen = !document.getElementById("student-view-course")?.classList.contains("hidden");
    const minimized = Boolean(scvShell?.classList.contains("minimized"));
    if (!courseOpen && !minimized) {
      node.classList.add("hidden");
      return;
    }
    node.classList.remove("hidden");
    const userName = String(state.context?.full_name || state.auth?.currentUser?.displayName || "student").trim();
    const phone = String(state.context?.phone_number || "").trim() || "-";
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    node.textContent = `${userName} | ${phone} | ${stamp}`;
    const pos = Math.floor((Date.now() / 20000) % 4);
    node.classList.remove("pos-a", "pos-b", "pos-c", "pos-d");
    if (pos === 0) node.classList.add("pos-a");
    if (pos === 1) node.classList.add("pos-b");
    if (pos === 2) node.classList.add("pos-c");
    if (pos === 3) node.classList.add("pos-d");
  };
  refreshScvWatermark();
  setInterval(refreshScvWatermark, 20000);
  scvMiniCloseBtn?.addEventListener("click", () => {
    if (!scvShell) return;
    scvShell.classList.remove("minimized", "controls-hidden", "volume-open");
    stopStudentStreamHeartbeat();
    setStudentViewerMode("legacy");
    try { scvVideo?.pause?.(); } catch {}
    if (scvStreamFrame) scvStreamFrame.src = "";
    restoreScvShell();
    tryExitPipForScv().catch(() => {});
    const coursePaneVisible = !document.getElementById("student-view-course")?.classList.contains("hidden");
    if (coursePaneVisible) activateStudentSubView("enrolled");
  });
  let scvDragActive = false;
  let scvDragOffsetX = 0;
  let scvDragOffsetY = 0;
  scvShell?.addEventListener("pointerdown", (event) => {
    if (!scvShell.classList.contains("minimized")) return;
    if (event.target?.closest(".video-controls, .icon-corner-btn, input, button, select, textarea")) return;
    const rect = scvShell.getBoundingClientRect();
    scvShell.style.left = `${Math.round(rect.left)}px`;
    scvShell.style.top = `${Math.round(rect.top)}px`;
    scvShell.style.right = "auto";
    scvShell.style.bottom = "auto";
    scvDragActive = true;
    scvDragOffsetX = event.clientX - rect.left;
    scvDragOffsetY = event.clientY - rect.top;
    scvShell.setPointerCapture?.(event.pointerId);
  });
  scvShell?.addEventListener("pointermove", (event) => {
    if (!scvDragActive || !scvShell.classList.contains("minimized")) return;
    const width = scvShell.offsetWidth || 0;
    const height = scvShell.offsetHeight || 0;
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    const nextLeft = Math.max(0, Math.min(maxX, event.clientX - scvDragOffsetX));
    const nextTop = Math.max(0, Math.min(maxY, event.clientY - scvDragOffsetY));
    scvShell.style.left = `${Math.round(nextLeft)}px`;
    scvShell.style.top = `${Math.round(nextTop)}px`;
  });
  const stopScvDrag = (event) => {
    if (!scvDragActive) return;
    scvDragActive = false;
    scvShell?.releasePointerCapture?.(event.pointerId);
  };
  scvShell?.addEventListener("pointerup", stopScvDrag);
  scvShell?.addEventListener("pointercancel", stopScvDrag);
  const refreshScvVolumeIcon = () => {
    if (!scvVolumeToggleBtn) return;
    const vol = Number(scvVolume?.value || 0);
    scvVolumeToggleBtn.innerHTML = materialIcon(vol <= 0.01 ? "volume_off" : "volume_up");
  };
  if (scvMiniCloseBtn) scvMiniCloseBtn.innerHTML = materialIcon("close");
  scvVolumeToggleBtn?.addEventListener("click", () => {
    scvShell?.classList.toggle("volume-open");
  });
  scvVolume?.addEventListener("input", () => {
    refreshScvVolumeIcon();
    if (Number(scvVolume.value || 0) > 0.01) scvShell?.classList.add("volume-open");
  });
  refreshScvVolumeIcon();
  $("scvSaveRatingBtn")?.addEventListener("click", async () => {
    const courseId = Number(state.studentActiveCourseId || 0);
    if (!courseId) {
      toast("Open a course first", "error");
      return;
    }
    if (el.scvSaveRatingBtn?.disabled) {
      toast("Complete at least one assessment attempt to submit rating.", "error");
      return;
    }
    try {
      const payload = {
        valuable_time_rating: Number(el.scvRateValue?.value || 5),
        content_quality_rating: Number(el.scvRateContent?.value || 5),
        instructor_clarity_rating: Number(el.scvRateClarity?.value || 5),
        practical_usefulness_rating: Number(el.scvRatePractical?.value || 5),
        comment: String(el.scvRatingComment?.value || "").trim() || null,
      };
      await api("POST", `/student/courses/${courseId}/feedback`, payload);
      if (el.scvRatingStatus) el.scvRatingStatus.textContent = "Rating saved.";
      toast("Course rating submitted");
      await refreshStudentDashboard().catch(() => {});
      await openStudentCourseViewer(courseId);
    } catch (err) {
      toast(err?.message || "Failed to submit rating", "error");
    }
  });

  bindCustomPlayerControls({
    videoId: "cwVideoPreview",
    shellId: "cwVideoShell",
    playBtnId: "cwPlayBtn",
    back10BtnId: "cwBack10Btn",
    fwd10BtnId: "cwFwd10Btn",
    scrubberId: "cwScrubber",
    hoverPreviewId: "cwHoverPreview",
    hoverTimeId: "cwHoverTime",
    speedId: "cwSpeed",
    volumeId: "cwVolume",
    fullscreenBtnId: "cwFullscreenBtn",
    topicsGetter: () => state.draftTopics || [],
    updateTimeFn: updateVideoTimeMeta,
  });
  bindCustomPlayerControls({
    videoId: "pcvVideo",
    shellId: "pcvVideoShell",
    playBtnId: "pcvPlayBtn",
    back10BtnId: "pcvBack10Btn",
    fwd10BtnId: "pcvFwd10Btn",
    scrubberId: "pcvScrubber",
    hoverPreviewId: "pcvHoverPreview",
    hoverTimeId: "pcvHoverTime",
    speedId: "pcvSpeed",
    volumeId: "pcvVolume",
    fullscreenBtnId: "pcvFullscreenBtn",
    topicsGetter: () => state.viewerTopics || [],
    updateTimeFn: updateViewerTimeMeta,
  });
  bindCustomPlayerControls({
    videoId: "scvVideo",
    shellId: "scvVideoShell",
    playBtnId: "scvPlayBtn",
    back10BtnId: "scvBack10Btn",
    fwd10BtnId: "scvFwd10Btn",
    scrubberId: "scvScrubber",
    hoverPreviewId: "scvHoverPreview",
    hoverTimeId: "scvHoverTime",
    speedId: "scvSpeed",
    volumeId: "scvVolume",
    fullscreenBtnId: "scvFullscreenBtn",
    minimizeBtnId: "scvMinimizeBtn",
    topicsGetter: () => state.studentViewerTopics || [],
    updateTimeFn: updateStudentViewerTimeMeta,
    canSeekTo: (targetSeconds, currentSeconds) => canStudentSeekTo(targetSeconds, currentSeconds),
    onSeekBlocked: () => maybeShowStudentSeekLockHint(),
  });
  $("cwCreateCourseBtn")?.addEventListener("click", async () => {
    const createBtn = $("cwCreateCourseBtn");
    if (createBtn) createBtn.disabled = true;
    try {
      const out = await createCourseFromWizard();
      // Move user out of wizard immediately once create/publish succeeded.
      el.courseWizard?.classList.add("hidden");
      activateProviderSubView("courses");
      toast(`Course created (ID ${out.courseId})`);
      // Refresh dashboard/content in background; do not block UI transition.
      Promise.allSettled([
        refreshProviderHome(),
        refreshProviderContent(),
        refreshProviderDrafts(),
      ]).then((results) => {
        const hasError = results.some((r) => r.status === "rejected");
        if (hasError) toast("Course published, but some lists failed to refresh. Please refresh once.", "error");
      });
    } catch (err) {
      toast(err?.message || "Failed to create course", "error");
    } finally {
      if (createBtn) createBtn.disabled = false;
    }
  });

  $("openAssessmentBuilderBtn")?.addEventListener("click", async () => {
    if (!ASSESSMENT_ONLY_MODE) {
      await Promise.all([refreshProviderContent(), loadProviderDraftsRaw()]);
    }
    openAssessmentBuilder();
  });
  $("assessmentBuilderCloseBtn")?.addEventListener("click", () => closeAssessmentBuilder());
  $("abStep1NextBtn")?.addEventListener("click", () => {
    if (!validateAssessmentStep(1)) return;
    goToAssessmentStep(2);
  });
  $("abStep2BackBtn")?.addEventListener("click", () => goToAssessmentStep(1));
  $("abStep2NextBtn")?.addEventListener("click", () => {
    if (!validateAssessmentStep(2)) return;
    goToAssessmentStep(3);
  });
  $("abStep3BackBtn")?.addEventListener("click", () => goToAssessmentStep(2));
  $("assessmentPreviewCloseBtn")?.addEventListener("click", () => confirmQuitAssessment());
  $("apRerunChecksBtn")?.addEventListener("click", () => runProctoringPrecheck().catch(() => toast("Failed to run proctor checks", "error")));
  $("apPrecheckNextBtn")?.addEventListener("click", () => {
    const p = state.assessmentPreview.proctor;
    if (!p.precheckReady || p.precheckInProgress) {
      toast("Complete all technical checks before continuing.", "error");
      return;
    }
    showPrecheckRulesPage();
    if (el.apRulesReadStatus) el.apRulesReadStatus.textContent = "Reading instructions...";
    setTimeout(() => {
      speakAssessmentRules();
    }, 120);
    updateAssessmentStartEligibility();
  });
  $("apBackToChecksBtn")?.addEventListener("click", () => {
    showPrecheckChecksPage();
    updateAssessmentStartEligibility();
  });
  $("apRulesSpeakBtn")?.addEventListener("click", () => {
    speakAssessmentRules();
  });
  $("apStartTestBtn")?.addEventListener("click", () => startAssessmentAfterPrecheck());
  $("apPrevBtn")?.addEventListener("click", () => {
    (async () => {
      readCurrentPreviewAnswer();
      if (state.assessmentPreview.mode === "student_attempt") await persistCurrentStudentAttemptAnswer();
      finalizeGazeQuestionForNavigation(state.assessmentPreview, false);
      state.assessmentPreview.index = Math.max(0, state.assessmentPreview.index - 1);
      renderAssessmentPreviewQuestion();
    })().catch(() => {});
  });
  $("apNextBtn")?.addEventListener("click", () => {
    (async () => {
      readCurrentPreviewAnswer();
      if (state.assessmentPreview.mode === "student_attempt") await persistCurrentStudentAttemptAnswer();
      finalizeGazeQuestionForNavigation(state.assessmentPreview, true);
      state.assessmentPreview.index = Math.min(state.assessmentPreview.questions.length - 1, state.assessmentPreview.index + 1);
      renderAssessmentPreviewQuestion();
    })().catch(() => {});
  });
  $("apSubmitBtn")?.addEventListener("click", () => {
    (async () => {
      readCurrentPreviewAnswer();
      if (state.assessmentPreview.mode === "student_attempt") await persistCurrentStudentAttemptAnswer();
      finalizeGazeQuestionForNavigation(state.assessmentPreview, true);
      showAssessmentPreviewResult();
    })().catch(() => {});
  });
  $("apTrainingPassBtn")?.addEventListener("click", () => {
    setTrainingFeedbackChoice("correct");
    if (el.apTrainingFeedbackStatus) {
      el.apTrainingFeedbackStatus.textContent = "Selected: Pass (model correct)";
    }
  });
  $("apTrainingFailBtn")?.addEventListener("click", () => {
    setTrainingFeedbackChoice("incorrect");
    if (el.apTrainingFeedbackStatus) {
      el.apTrainingFeedbackStatus.textContent = "Selected: Fail (model wrong)";
    }
  });
  $("apTrainingSaveBtn")?.addEventListener("click", () => {
    saveTrainingFeedback().catch((err) => toast(err?.message || "Failed to save training review", "error"));
  });
  $("apEnvironmentAttest")?.addEventListener("change", (event) => {
    state.assessmentPreview.proctor.environmentAttested = Boolean(event.target?.checked);
    updateAssessmentStartEligibility();
  });
  $("proctorWarningAcknowledgeBtn")?.addEventListener("click", () => {
    closeProctorWarningModal();
  });
  $("abCourseFilter")?.addEventListener("change", () => {
    renderAssessmentCourseOptions();
    persistAssessmentBuilderCache();
  });
  $("abCourseSelect")?.addEventListener("change", () => {
    updateAssessmentSourceMeta();
    persistAssessmentBuilderCache();
  });
  $("abAssessmentType")?.addEventListener("change", () => {
    applyAssessmentTypeUi();
    persistAssessmentBuilderCache();
  });
  document.querySelectorAll("[data-ab-type-card]").forEach((node) => {
    node.addEventListener("click", () => {
      const type = String(node.getAttribute("data-ab-type-card") || "mcq");
      fillAssessmentSampleTemplate(type, { gotoContent: false });
    });
  });
  document.querySelectorAll(".ab-sample-card[data-ab-sample-template]").forEach((node) => {
    node.addEventListener("click", () => {
      const type = String(node.getAttribute("data-ab-sample-template") || "mcq");
      fillAssessmentSampleTemplate(type, { gotoContent: true });
    });
  });
  $("abTimingMode")?.addEventListener("change", () => {
    applyAssessmentTimingMode();
    persistAssessmentBuilderCache();
  });
  $("abNegativeMarking")?.addEventListener("change", () => {
    applyAssessmentNegativeMarkingUi();
    persistAssessmentBuilderCache();
  });
  $("abQuestionsPerAttempt")?.addEventListener("change", () => renderAssessmentPool());
  [
    "abCourseFilter",
    "abTitle",
    "abAssessmentType",
    "abInstructions",
    "abAbout",
    "abTools",
    "abTopics",
    "abPassScore",
    "abMaxAttempts",
    "abQuestionsPerAttempt",
    "abDefaultNegativeMarks",
    "abDurationMinutes",
    "abTimePerQuestionSeconds",
    "abTaskTitle",
    "abTaskMarks",
    "abTaskDescription",
    "abTaskInstructions",
    "abCodingLanguages",
    "abStarterCode",
    "abVisibleTests",
    "abHiddenTests",
    "abInitialSheet",
    "abExpectedValues",
    "abExpectedFormulas",
    "abLockedCells",
    "abClientScenario",
    "abTaxYear",
    "abClientDocuments",
    "abRequiredForms",
    "abScenarioFacts",
    "abExpectedFormValues",
    "abComplianceChecks",
    "abRedFlags",
    "abCasePrompt",
    "abAllowedFileTypes",
    "abMaxFileSize",
    "abRubric",
    "abQuestionType",
    "abQuestionMarks",
    "abQuestionNegativeMarks",
    "abQuestionText",
    "abOption1",
    "abOption2",
    "abOption3",
    "abOption4",
  ].forEach((id) => {
    $(id)?.addEventListener("input", () => persistAssessmentBuilderCache());
  });
  ["abQuestionsPerAttempt", "abTimePerQuestionSeconds", "abAssessmentType", "abTaskAutoGrading", "abSpreadsheetAutoGrading", "abTaxManualReview", "abCaseManualReview"].forEach((id) => {
    $(id)?.addEventListener("change", () => persistAssessmentBuilderCache());
  });
  [
    "abTitle",
    "abAssessmentType",
    "abPassScore",
    "abInstructions",
    "abAbout",
    "abTools",
    "abTopics",
    "abMaxAttempts",
    "abQuestionsPerAttempt",
    "abTimingMode",
    "abDurationMinutes",
    "abTimePerQuestionSeconds",
    "abDefaultNegativeMarks",
  ].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      $(id)?.classList.remove("ab-field-invalid");
      const err = $("abStep2Error");
      if (err) {
        err.textContent = "";
        err.classList.add("hidden");
      }
    });
    $(id)?.addEventListener("change", () => {
      $(id)?.classList.remove("ab-field-invalid");
      const err = $("abStep2Error");
      if (err) {
        err.textContent = "";
        err.classList.add("hidden");
      }
    });
  });
  ["abShuffleQuestions", "abShuffleOptions", "abCertificateEnabled"].forEach((id) => {
    $(id)?.addEventListener("change", () => persistAssessmentBuilderCache());
  });
  ["abNegativeMarking", "abShuffleQuestions", "abShuffleOptions", "abCertificateEnabled"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      const row = $(id)?.closest?.(".checkbox-row");
      row?.classList?.remove("ab-field-invalid");
      const err = $("abStep2Error");
      if (err) {
        err.textContent = "";
        err.classList.add("hidden");
      }
    });
  });
  document.querySelectorAll("[data-ab-correct]").forEach((node) => {
    node.addEventListener("change", () => {
      if (($("abQuestionType")?.value || "mcq_single_correct") === "mcq_single_correct" && node.checked) {
        document.querySelectorAll("[data-ab-correct]").forEach((other) => {
          if (other !== node) other.checked = false;
        });
      }
      persistAssessmentBuilderCache();
    });
  });
  $("abQuestionType")?.addEventListener("change", () => {
    if (($("abQuestionType")?.value || "mcq_single_correct") !== "mcq_single_correct") return;
    let seen = false;
    document.querySelectorAll("[data-ab-correct]").forEach((n) => {
      if (n.checked && !seen) {
        seen = true;
      } else if (n.checked && seen) {
        n.checked = false;
      }
    });
  });
  $("abAddQuestionBtn")?.addEventListener("click", () => {
    try {
      const q = buildQuestionFromAssessmentForm();
      state.assessmentDraftQuestions.push(q);
      if (state.assessmentQuestionDefaultMarks == null) {
        state.assessmentQuestionDefaultMarks = Number(q.marks);
      }
      if (Boolean($("abNegativeMarking")?.checked) && state.assessmentQuestionDefaultNegativeMarks == null) {
        state.assessmentQuestionDefaultNegativeMarks = Number(q.negative_marks);
      }
      $("abQuestionText").value = "";
      $("abQuestionMarks").value = state.assessmentQuestionDefaultMarks != null ? String(state.assessmentQuestionDefaultMarks) : "";
      if (Boolean($("abNegativeMarking")?.checked)) {
        const defaultNeg = state.assessmentQuestionDefaultNegativeMarks != null
          ? state.assessmentQuestionDefaultNegativeMarks
          : Number($("abDefaultNegativeMarks")?.value || 0);
        $("abQuestionNegativeMarks").value = Number.isFinite(defaultNeg) ? String(defaultNeg) : "";
      } else {
        $("abQuestionNegativeMarks").value = "";
      }
      ["abOption1", "abOption2", "abOption3", "abOption4"].forEach((id) => {
        if ($(id)) $(id).value = "";
      });
      document.querySelectorAll("[data-ab-correct]").forEach((n) => {
        n.checked = false;
      });
      renderAssessmentPool();
      persistAssessmentBuilderCache();
      toast("Question added to pool");
    } catch (err) {
      toast(err?.message || "Invalid question", "error");
    }
  });
  $("abSaveDraftBtn")?.addEventListener("click", async () => {
    try {
      if (!validateAssessmentStep(1)) {
        setAssessmentBuilderStep(1);
        toast("Select assessment source first.", "error");
        return;
      }
      if (!validateAssessmentStep(2)) {
        setAssessmentBuilderStep(2);
        toast("Fix assessment settings before saving.", "error");
        return;
      }
      persistAssessmentBuilderCache();
      await createAssessmentFromBuilder(false);
      toast("Assessment draft saved");
      clearAssessmentBuilderCache();
      closeAssessmentBuilder();
      await Promise.all([refreshProviderHome(), refreshProviderAssessments()]);
    } catch (err) {
      const msg = err?.message || "Failed to save assessment draft";
      console.error("[assessment_save_error]", err);
      const inline = $("abStep2Error");
      if (inline) {
        inline.textContent = msg;
        inline.classList.remove("hidden");
      }
      toast(err?.message || "Failed to save assessment draft", "error");
    }
  });
  $("abPublishBtn")?.addEventListener("click", async () => {
    try {
      if (!validateAssessmentStep(1)) {
        setAssessmentBuilderStep(1);
        toast("Select assessment source first.", "error");
        return;
      }
      if (!validateAssessmentStep(2)) {
        setAssessmentBuilderStep(2);
        toast("Fix assessment settings before publishing.", "error");
        return;
      }
      persistAssessmentBuilderCache();
      await createAssessmentFromBuilder(true);
      toast("Assessment published");
      clearAssessmentBuilderCache();
      closeAssessmentBuilder();
      await Promise.all([refreshProviderHome(), refreshProviderAssessments()]);
    } catch (err) {
      const msg = err?.message || "Failed to publish assessment";
      console.error("[assessment_publish_error]", err);
      const inline = $("abStep2Error");
      if (inline) {
        inline.textContent = msg;
        inline.classList.remove("hidden");
      }
      toast(err?.message || "Failed to publish assessment", "error");
    }
  });

  $("refreshProviderCoursesBtn")?.addEventListener("click", async () => {
    const btn = $("refreshProviderCoursesBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshProviderContent();
    } catch {
      toast("Failed to refresh courses", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  $("refreshStudentDashboardBtn")?.addEventListener("click", () =>
    Promise.all([refreshStudentDashboard(), refreshStudentCertifications(), refreshStudentLiveClasses()]).catch(() => toast("Failed to refresh dashboard", "error")));
  $("studentAvailableSearch")?.addEventListener("input", () => renderStudentCourseCatalogs());
  $("studentAvailableSort")?.addEventListener("change", () => renderStudentCourseCatalogs());
  const syncStudentAvailableSortOptionState = () => {
    const current = String($("studentAvailableSort")?.value || "latest");
    document.querySelectorAll("[data-student-available-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-available-sort") === current);
    });
  };
  document.querySelectorAll("[data-student-available-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-available-sort") || "latest");
      if ($("studentAvailableSort")) $("studentAvailableSort").value = next;
      syncStudentAvailableSortOptionState();
      renderStudentCourseCatalogs();
      if (el.studentAvailableFilterMenu) el.studentAvailableFilterMenu.classList.add("hidden");
      el.studentAvailableFilterBtn?.classList.remove("active");
    });
  });
  syncStudentAvailableSortOptionState();
  $("studentAvailableFilterBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncStudentAvailableSortOptionState();
    toggleFilterPopover(el.studentAvailableFilterMenu, el.studentAvailableFilterBtn);
  });
  $("studentAvailableFilterMenu")?.addEventListener("click", (event) => event.stopPropagation());
  $("refreshStudentAvailableBtn")?.addEventListener("click", async () => {
    const btn = $("refreshStudentAvailableBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshStudentDashboard();
    } catch {
      toast("Failed to refresh available courses", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  $("studentEnrolledSearch")?.addEventListener("input", () => renderStudentCourseCatalogs());
  $("studentEnrolledSort")?.addEventListener("change", () => renderStudentCourseCatalogs());
  const syncStudentEnrolledSortOptionState = () => {
    const current = String($("studentEnrolledSort")?.value || "latest");
    document.querySelectorAll("[data-student-enrolled-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-enrolled-sort") === current);
    });
  };
  document.querySelectorAll("[data-student-enrolled-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-enrolled-sort") || "latest");
      if ($("studentEnrolledSort")) $("studentEnrolledSort").value = next;
      syncStudentEnrolledSortOptionState();
      renderStudentCourseCatalogs();
      if (el.studentEnrolledFilterMenu) el.studentEnrolledFilterMenu.classList.add("hidden");
      el.studentEnrolledFilterBtn?.classList.remove("active");
    });
  });
  syncStudentEnrolledSortOptionState();
  $("studentEnrolledFilterBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncStudentEnrolledSortOptionState();
    toggleFilterPopover(el.studentEnrolledFilterMenu, el.studentEnrolledFilterBtn);
  });
  $("studentEnrolledFilterMenu")?.addEventListener("click", (event) => event.stopPropagation());
  $("studentAssessmentsSearch")?.addEventListener("input", () => renderStudentAssessmentsList());
  $("studentAssessmentsSort")?.addEventListener("change", () => renderStudentAssessmentsList());
  $("studentAssessmentsStatus")?.addEventListener("change", () => renderStudentAssessmentsList());
  const syncStudentAssessmentsFilterOptionState = () => {
    const sortValue = String($("studentAssessmentsSort")?.value || "latest");
    const statusValue = String($("studentAssessmentsStatus")?.value || "all");
    document.querySelectorAll("[data-student-assess-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-assess-sort") === sortValue);
    });
    document.querySelectorAll("[data-student-assess-status]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-assess-status") === statusValue);
    });
  };
  document.querySelectorAll("[data-student-assess-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-assess-sort") || "latest");
      if ($("studentAssessmentsSort")) $("studentAssessmentsSort").value = next;
      syncStudentAssessmentsFilterOptionState();
      renderStudentAssessmentsList();
      if (el.studentAssessmentsFilterMenu) el.studentAssessmentsFilterMenu.classList.add("hidden");
      el.studentAssessmentsFilterBtn?.classList.remove("active");
    });
  });
  document.querySelectorAll("[data-student-assess-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-assess-status") || "all");
      if ($("studentAssessmentsStatus")) $("studentAssessmentsStatus").value = next;
      syncStudentAssessmentsFilterOptionState();
      renderStudentAssessmentsList();
      if (el.studentAssessmentsFilterMenu) el.studentAssessmentsFilterMenu.classList.add("hidden");
      el.studentAssessmentsFilterBtn?.classList.remove("active");
    });
  });
  syncStudentAssessmentsFilterOptionState();
  $("studentAssessmentsFilterBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncStudentAssessmentsFilterOptionState();
    toggleFilterPopover(el.studentAssessmentsFilterMenu, el.studentAssessmentsFilterBtn);
  });
  $("studentAssessmentsFilterMenu")?.addEventListener("click", (event) => event.stopPropagation());
  $("refreshStudentAssessmentsBtn")?.addEventListener("click", async () => {
    const btn = $("refreshStudentAssessmentsBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshStudentDashboard();
      await refreshStudentAssessments();
    } catch {
      toast("Failed to refresh assessments", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  $("providerCoursesSearch")?.addEventListener("input", () => renderProviderCourseCatalog());
  $("providerCoursesSort")?.addEventListener("change", () => renderProviderCourseCatalog());
  const syncProviderSortOptionState = () => {
    const current = String($("providerCoursesSort")?.value || "latest");
    document.querySelectorAll("[data-provider-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-provider-sort") === current);
    });
  };
  document.querySelectorAll("[data-provider-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-provider-sort") || "latest");
      if ($("providerCoursesSort")) $("providerCoursesSort").value = next;
      syncProviderSortOptionState();
      renderProviderCourseCatalog();
      if (el.providerCoursesFilterMenu) el.providerCoursesFilterMenu.classList.add("hidden");
      el.providerCoursesFilterBtn?.classList.remove("active");
    });
  });
  syncProviderSortOptionState();
  $("providerCoursesFilterBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncProviderSortOptionState();
    toggleFilterPopover(el.providerCoursesFilterMenu, el.providerCoursesFilterBtn);
  });
  $("providerCoursesFilterMenu")?.addEventListener("click", (event) => event.stopPropagation());
  $("studentCertificationsSearch")?.addEventListener("input", () => renderStudentCertificationsList());
  $("studentCertificationsSort")?.addEventListener("change", () => renderStudentCertificationsList());
  $("studentCertificationsStatus")?.addEventListener("change", () => renderStudentCertificationsList());
  const syncStudentCertificationsFilterOptionState = () => {
    const sortValue = String($("studentCertificationsSort")?.value || "latest");
    const statusValue = String($("studentCertificationsStatus")?.value || "all");
    document.querySelectorAll("[data-student-cert-sort]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-cert-sort") === sortValue);
    });
    document.querySelectorAll("[data-student-cert-status]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-student-cert-status") === statusValue);
    });
  };
  document.querySelectorAll("[data-student-cert-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-cert-sort") || "latest");
      if ($("studentCertificationsSort")) $("studentCertificationsSort").value = next;
      syncStudentCertificationsFilterOptionState();
      renderStudentCertificationsList();
      if (el.studentCertificationsFilterMenu) el.studentCertificationsFilterMenu.classList.add("hidden");
      el.studentCertificationsFilterBtn?.classList.remove("active");
    });
  });
  document.querySelectorAll("[data-student-cert-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = String(btn.getAttribute("data-student-cert-status") || "all");
      if ($("studentCertificationsStatus")) $("studentCertificationsStatus").value = next;
      syncStudentCertificationsFilterOptionState();
      renderStudentCertificationsList();
      if (el.studentCertificationsFilterMenu) el.studentCertificationsFilterMenu.classList.add("hidden");
      el.studentCertificationsFilterBtn?.classList.remove("active");
    });
  });
  syncStudentCertificationsFilterOptionState();
  $("studentCertificationsFilterBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    syncStudentCertificationsFilterOptionState();
    toggleFilterPopover(el.studentCertificationsFilterMenu, el.studentCertificationsFilterBtn);
  });
  $("studentCertificationsFilterMenu")?.addEventListener("click", (event) => event.stopPropagation());
  $("refreshStudentCertificationsBtn")?.addEventListener("click", () =>
    refreshStudentCertifications().catch(() => toast("Failed to refresh certifications", "error")));
  $("providerAssessmentsSearch")?.addEventListener("input", () => {
    renderProviderAssessmentsList();
  });
  $("refreshProviderAssessmentsBtn")?.addEventListener("click", async () => {
    const btn = $("refreshProviderAssessmentsBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshProviderAssessments();
    } catch {
      toast("Failed to refresh assessments", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  $("providerAssessmentToolsBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFilterPopover(el.providerAssessmentToolsMenu, el.providerAssessmentToolsBtn);
  });
  $("providerAssessmentToolsMenu")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest("[data-provider-assessment-tool]");
    if (!(btn instanceof HTMLElement)) return;
    const tool = String(btn.getAttribute("data-provider-assessment-tool") || "").trim();
    if (!tool) return;
    openProviderAssessmentTool(tool);
    if (el.providerAssessmentToolsMenu) el.providerAssessmentToolsMenu.classList.add("hidden");
    el.providerAssessmentToolsBtn?.classList.remove("active");
  });
  $("assessmentCatalogSearch")?.addEventListener("input", debounce(() => {
    refreshAssessmentCatalogIssueOptions().catch(() => toast("Failed to search assessments", "error"));
  }, 250));
  $("assessmentCatalogDuration")?.addEventListener("change", () => {
    refreshAssessmentCatalogIssueOptions().catch(() => toast("Failed to filter assessments", "error"));
  });
  $("assessmentCatalogSort")?.addEventListener("change", () => {
    refreshAssessmentCatalogIssueOptions().catch(() => toast("Failed to sort assessments", "error"));
  });
  $("refreshAssessmentCatalogBtn")?.addEventListener("click", async () => {
    const btn = $("refreshAssessmentCatalogBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshAssessmentCatalogIssueOptions();
      await refreshIssuedAssessments();
    } catch {
      toast("Failed to refresh assessment catalog", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  $("backToAssessmentCatalogBtn")?.addEventListener("click", () => {
    activateProviderSubView(state.selectedAssessmentSource === "custom" ? "assessments" : "assessment-catalog");
  });
  $("issueAssessmentBtn")?.addEventListener("click", async () => {
    try {
      const examId = Number(state.selectedCatalogExamId || 0);
      const candidate_name = String(el.issueCandidateName?.value || "").trim();
      const candidate_email = String(el.issueCandidateEmail?.value || "").trim();
      if (!examId || !candidate_name || !candidate_email) {
        throw new Error("Assessment, candidate name, and candidate email are required");
      }
      const out = await api("POST", `/exams/${examId}/issue`, { candidate_name, candidate_email });
      if (el.issueAssessmentStatus) {
        const emailState = out.email_delivery?.sent ? "Email sent" : `Email not sent${out.email_delivery?.reason ? ` (${out.email_delivery.reason})` : ""}`;
        el.issueAssessmentStatus.textContent = `Issued. ID ${out.internal_id || ""}. ${emailState}. Temp password for ${out.candidate_email}: ${out.temporary_password}. Link: ${out.login_link || "-"}`;
      }
      await refreshIssuedAssessments();
    } catch (err) {
      if (el.issueAssessmentStatus) el.issueAssessmentStatus.textContent = err?.message || "Failed to issue assessment";
    }
  });
  $("issuedCandidateLoginBtn")?.addEventListener("click", async () => {
    try {
      const email = String(el.issuedCandidateEmail?.value || "").trim();
      const password = String(el.issuedCandidatePassword?.value || "").trim();
      if (!password) throw new Error("Password is required");
      let authOut;
      if (state.issuedAccessKey) {
        authOut = await api("POST", `/exams/issued/key/${encodeURIComponent(state.issuedAccessKey)}/login`, { password }, false);
      } else {
        throw new Error("Open the assessment from the recruiter email link.");
      }
      state.issuedCandidateToken = String(authOut.token || "");
      const data = await issuedApi("GET", "/exams/issued/me");
      if (String(data.status || "") === "completed") {
        throw new Error(`Assessment already completed. Score ${Number(data.score_pct || 0).toFixed(2)}%`);
      }
      renderIssuedCandidateAssessment(data);
      if (el.issuedAssessmentAttemptScreen) el.issuedAssessmentAttemptScreen.classList.remove("hidden");
      showView("auth");
      if (el.issuedAssessmentStatus) el.issuedAssessmentStatus.textContent = "";
    } catch (err) {
      toast(err?.message || "Failed to login issued candidate", "error");
    }
  });
  $("issuedAssessmentSubmitBtn")?.addEventListener("click", () => {
    submitIssuedCandidateAssessment().catch((err) => {
      if (el.issuedAssessmentStatus) el.issuedAssessmentStatus.textContent = err?.message || "Failed to submit";
    });
  });
  $("issuedAssessmentCloseBtn")?.addEventListener("click", () => {
    exitIssuedAssessmentServer();
  });
  $("refreshProviderCommentsBtn")?.addEventListener("click", async () => {
    const btn = $("refreshProviderCommentsBtn");
    btn?.classList.add("is-spinning");
    try {
      await refreshProviderFeedback();
    } catch {
      toast("Failed to refresh feedback", "error");
    } finally {
      setTimeout(() => btn?.classList.remove("is-spinning"), 350);
    }
  });
  document.querySelectorAll("[data-provider-fc-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setProviderFeedbackTab(btn.getAttribute("data-provider-fc-tab") || "feedback");
    });
  });
  $("providerFeedbackTileNew")?.addEventListener("click", () => {
    openProviderFeedbackDetail("new");
    renderProviderFeedbackDetail();
  });
  $("providerFeedbackTileOld")?.addEventListener("click", () => {
    openProviderFeedbackDetail("old");
    renderProviderFeedbackDetail();
  });
  $("providerComplaintTileNew")?.addEventListener("click", () => {
    openProviderComplaintsDetail("new");
    renderProviderComplaintsDetail();
  });
  $("providerComplaintTilePending")?.addEventListener("click", () => {
    openProviderComplaintsDetail("pending");
    renderProviderComplaintsDetail();
  });
  $("providerComplaintTileClosed")?.addEventListener("click", () => {
    openProviderComplaintsDetail("closed");
    renderProviderComplaintsDetail();
  });
  $("providerFeedbackBackBtn")?.addEventListener("click", () => {
    closeProviderFeedbackDetails();
  });
  $("providerComplaintsBackBtn")?.addEventListener("click", () => {
    closeProviderFeedbackDetails();
  });
  $("refreshProviderNotificationsBtn")?.addEventListener("click", () => refreshProviderNotifications().catch(() => toast("Failed to refresh notifications", "error")));
  $("refreshProviderCertsBtn")?.addEventListener("click", () => refreshProviderCertifications().catch(() => toast("Failed to refresh certifications", "error")));
  $("refreshProviderLiveClassesBtn")?.addEventListener("click", () => refreshProviderLiveClasses().catch(() => toast("Failed to refresh live classes", "error")));
  $("refreshStudentLiveClassesBtn")?.addEventListener("click", () => refreshStudentLiveClasses().catch(() => toast("Failed to refresh live classes", "error")));
  $("openLiveClassSchedulerBtn")?.addEventListener("click", () => {
    if (el.providerLiveCreateScreen?.classList.contains("hidden")) {
      resetProviderLiveScheduler();
      providerLiveSchedulerSetVisible(true);
    } else {
      providerLiveSchedulerSetVisible(false);
    }
  });
  $("closeLiveClassSchedulerBtn")?.addEventListener("click", () => {
    providerLiveSchedulerSetVisible(false);
    resetProviderLiveScheduler();
  });
  $("cancelLiveClassSchedulerBtn")?.addEventListener("click", () => {
    providerLiveSchedulerSetVisible(false);
    resetProviderLiveScheduler();
  });
  $("createLiveClassBtn")?.addEventListener("click", () => {
    submitProviderLiveSchedule().catch((err) => toast(err?.message || "Failed to save live class schedule", "error"));
  });
  $("liveClassMode")?.addEventListener("change", () => applyProviderLiveModeUi());
  $("liveClassRecurrencePattern")?.addEventListener("change", () => applyProviderLiveRecurrenceUi());
  $("liveClassGenerateAgendaBtn")?.addEventListener("click", () => {
    if (el.liveClassAiOutput) el.liveClassAiOutput.value = generateLiveClassAiDraft("agenda");
  });
  $("liveClassGeneratePollBtn")?.addEventListener("click", () => {
    if (el.liveClassAiOutput) el.liveClassAiOutput.value = generateLiveClassAiDraft("poll");
  });
  $("liveClassGenerateSummaryBtn")?.addEventListener("click", () => {
    if (el.liveClassAiOutput) el.liveClassAiOutput.value = generateLiveClassAiDraft("summary");
  });
  $("liveClassAppendAiBtn")?.addEventListener("click", () => {
    const ai = String(el.liveClassAiOutput?.value || "").trim();
    if (!ai) return;
    const current = String(el.liveClassDescription?.value || "").trim();
    el.liveClassDescription.value = current ? `${current}\n\n${ai}` : ai;
    toast("AI draft appended to description");
  });
  $("liveClassReplaceAiBtn")?.addEventListener("click", () => {
    const ai = String(el.liveClassAiOutput?.value || "").trim();
    if (!ai) return;
    el.liveClassDescription.value = ai;
    toast("Description replaced with AI draft");
  });
  $("leaveLiveRoomBtn")?.addEventListener("click", () => {
    leaveLiveClassroom().catch(() => toast("Failed to leave room", "error"));
  });
  $("liveRoomToggleToolsBtn")?.addEventListener("click", () => {
    toggleLiveDrawer("tools");
  });
  $("liveRoomToggleChatBtn")?.addEventListener("click", () => {
    toggleLiveDrawer("chat");
  });
  $("liveRoomReactBtn")?.addEventListener("click", () => {
    toggleLiveDrawer("reaction");
  });
  $("liveRoomFullscreenBtn")?.addEventListener("click", () => {
    const target = el.liveRoomStageShell || el.liveClassroomScreen;
    if (!target) return;
    if (document.fullscreenElement === target) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      target.requestFullscreen?.().catch(() => {});
    }
  });
  $("signupRole")?.addEventListener("change", () => refreshSignupVerificationOptions());
  refreshSignupVerificationOptions();
  $("liveRoomVideoStartBtn")?.addEventListener("click", () => {
    startLiveCamera()
      .then(() => toast("Camera started"))
      .catch((err) => toast(err?.message || "Unable to start camera", "error"));
  });
  $("liveRoomVideoStopBtn")?.addEventListener("click", () => {
    stopLiveCamera()
      .then(() => toast("Camera stopped"))
      .catch((err) => toast(err?.message || "Unable to stop camera", "error"));
  });
  $("liveRoomToggleMicBtn")?.addEventListener("click", () => {
    toggleLiveMic()
      .catch((err) => toast(err?.message || "Unable to toggle microphone", "error"));
  });
  $("liveRoomShareScreenBtn")?.addEventListener("click", () => {
    startLiveScreenShare()
      .then((started) => {
        if (started) toast("Screen sharing started");
      })
      .catch((err) => toast(err?.message || "Unable to share screen", "error"));
  });
  $("liveRoomParticipantsBtn")?.addEventListener("click", () => {
    toggleLiveDrawer("participants");
  });
  $("liveRoomStopShareOverlayBtn")?.addEventListener("click", () => {
    stopLiveScreenShare()
      .then(() => toast("Screen sharing stopped"))
      .catch((err) => toast(err?.message || "Unable to stop screen share", "error"));
  });
  $("liveRoomStopShareBtn")?.addEventListener("click", () => {
    stopLiveScreenShare()
      .then(() => toast("Screen sharing stopped"))
      .catch((err) => toast(err?.message || "Unable to stop screen share", "error"));
  });
  $("liveRoomSendChatBtn")?.addEventListener("click", () => {
    sendLiveRoomChatMessage("chat", el.liveRoomChatInput?.value || "").catch((err) => toast(err?.message || "Failed to send message", "error"));
  });
  $("liveRoomChatInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    sendLiveRoomChatMessage("chat", el.liveRoomChatInput?.value || "").catch((err) => toast(err?.message || "Failed to send message", "error"));
  });
  document.querySelectorAll("[data-live-reaction]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reaction = String(btn.dataset.liveReaction || "").trim();
      if (!reaction) return;
      sendLiveRoomChatMessage("reaction", reaction)
        .then(() => {
          burstLiveReactionOnStage(reaction, `local:${Date.now()}:${reaction}`);
        })
        .catch((err) => toast(err?.message || "Failed to send reaction", "error"));
      setLiveDrawerState("reaction", false);
    });
  });
  document.addEventListener("fullscreenchange", refreshLiveFullscreenButton);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const insideReaction = target.closest("#liveRoomReactionMenu") || target.closest("#liveRoomReactBtn");
    if (!insideReaction && state.liveRoom.reactionOpen) setLiveDrawerState("reaction", false);
    const insideParticipants = target.closest("#liveRoomParticipantsMenu") || target.closest("#liveRoomParticipantsBtn");
    if (!insideParticipants && state.liveRoom.participantsOpen) setLiveDrawerState("participants", false);
    const insideTools = target.closest("#liveRoomToolsPanel") || target.closest("#liveRoomToggleToolsBtn");
    if (!insideTools && state.liveRoom.toolsOpen) setLiveDrawerState("tools", false);
  });
  $("liveRoomSaveBoardBtn")?.addEventListener("click", () => {
    const sessionId = Number(state.liveRoom.sessionId || 0);
    if (!sessionId || state.liveRoom.role !== "provider") return;
    api("POST", `/provider/workspace/live-classes/${sessionId}/tools/board`, {
      board_text: String(el.liveRoomBoardText?.value || ""),
    })
      .then(() => {
        state.liveRoom.boardDraftDirty = false;
      })
      .then(() => refreshLiveRoomState())
      .then(() => toast("Whiteboard updated"))
      .catch((err) => toast(err?.message || "Failed to save board", "error"));
  });
  $("liveRoomBoardText")?.addEventListener("input", () => {
    const draft = String(el.liveRoomBoardText?.value || "");
    state.liveRoom.boardDraftDirty = draft !== String(state.liveRoom.boardServerText || "");
  });
  $("liveRoomOpenWhiteboardBtn")?.addEventListener("click", () => {
    setLiveSidePanel("whiteboard", true);
  });
  $("liveRoomOpenBreakoutBtn")?.addEventListener("click", () => {
    setLiveSidePanel("breakout", true);
  });
  $("liveRoomOpenPollBtn")?.addEventListener("click", () => {
    setLiveSidePanel("poll-composer", true);
  });
  $("liveRoomOpenQaBtn")?.addEventListener("click", () => {
    setLiveSidePanel("qa", true);
  });
  $("liveRoomShareWhiteboardBtn")?.addEventListener("click", () => {
    setLiveSidePanel("whiteboard", true);
    broadcastLiveToolPanel("whiteboard", true).catch(() => {});
    toast("Whiteboard opened for everyone");
  });
  $("liveRoomShareBreakoutBtn")?.addEventListener("click", () => {
    setLiveSidePanel("breakout", true);
    broadcastLiveToolPanel("breakout", true).catch(() => {});
    toast("Breakout panel opened for everyone");
  });
  $("liveRoomAddQaBtn")?.addEventListener("click", () => {
    const text = String(el.liveRoomQaInput?.value || "").trim();
    if (!text) return;
    state.liveRoom.qaItems.push({ text, author: state.context?.name || "Host", ts: Date.now() });
    if (el.liveRoomQaInput) el.liveRoomQaInput.value = "";
    renderLiveQaList();
  });
  $("liveRoomShareQaBtn")?.addEventListener("click", () => {
    const latest = state.liveRoom.qaItems[state.liveRoom.qaItems.length - 1];
    if (!latest?.text) return toast("Add a Q&A item first", "error");
    setLiveSidePanel("qa", true);
    sendLiveSignal("qa_add", { text: latest.text, author: latest.author || "Host" }).catch(() => {});
    broadcastLiveToolPanel("qa", true).catch(() => {});
    toast("Q&A shared");
  });
  document.querySelectorAll("[data-live-side-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLiveSidePanel("", false);
      if (state.liveRoom.role === "provider") broadcastLiveToolPanel("", false).catch(() => {});
    });
  });
  $("liveRoomRaiseHandBtn")?.addEventListener("click", () => {
    const sessionId = Number(state.liveRoom.sessionId || 0);
    if (!sessionId || state.liveRoom.role !== "student") return;
    api("POST", `/student/live-classes/${sessionId}/raise-hand`)
      .then(() => refreshLiveRoomState())
      .catch((err) => toast(err?.message || "Failed to update hand raise", "error"));
  });
  $("liveRoomStartPollBtn")?.addEventListener("click", () => {
    const sessionId = Number(state.liveRoom.sessionId || 0);
    if (!sessionId || state.liveRoom.role !== "provider") return;
    const question = String(el.liveRoomPollQuestion?.value || "").trim();
    const options = String(el.liveRoomPollOptions?.value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    api("POST", `/provider/workspace/live-classes/${sessionId}/tools/poll`, { question, options })
      .then(() => {
        if (el.liveRoomPollQuestion) el.liveRoomPollQuestion.value = "";
        if (el.liveRoomPollOptions) el.liveRoomPollOptions.value = "";
        return refreshLiveRoomState();
      })
      .then(() => {
        setLiveSidePanel("poll", true);
        broadcastLiveToolPanel("poll", true).catch(() => {});
        toast("Poll shared");
      })
      .catch((err) => toast(err?.message || "Failed to start poll", "error"));
  });
  $("liveRoomClosePollBtn")?.addEventListener("click", () => {
    const sessionId = Number(state.liveRoom.sessionId || 0);
    if (!sessionId || state.liveRoom.role !== "provider") return;
    api("POST", `/provider/workspace/live-classes/${sessionId}/tools/poll/close`)
      .then(() => refreshLiveRoomState())
      .then(() => {
        broadcastLiveToolPanel("", false).catch(() => {});
        setLiveSidePanel("", false);
        toast("Poll closed");
      })
      .catch((err) => toast(err?.message || "Failed to close poll", "error"));
  });
  $("liveRoomStartTimerBtn")?.addEventListener("click", () => {
    startLiveClassTimer();
    toast("Class timer started");
  });
  $("liveRoomStopTimerBtn")?.addEventListener("click", () => {
    stopLiveClassTimer();
    toast("Class timer stopped");
  });
  $("liveRoomAiExplainBtn")?.addEventListener("click", () => {
    const topic = String(el.liveRoomAiTopicInput?.value || "").trim();
    if (!topic) return toast("Enter a topic first", "error");
    const draft = generateLiveTopicExplainer(topic);
    const existing = String(el.liveRoomBoardText?.value || "").trim();
    el.liveRoomBoardText.value = existing ? `${existing}\n\n${draft}` : draft;
    state.liveRoom.boardDraftDirty = true;
    toast("AI explanation added to board. Save board to publish.");
  });
  $("liveRoomPickStudentBtn")?.addEventListener("click", () => {
    const participants = Array.from(el.liveRoomParticipantsList?.querySelectorAll(".item strong") || [])
      .map((n) => String(n.textContent || "").trim())
      .filter(Boolean);
    if (!participants.length) return toast("No participants available", "error");
    const chosen = participants[Math.floor(Math.random() * participants.length)];
    toast(`Selected student: ${chosen}`);
    sendLiveRoomChatMessage("announcement", `Random pick: ${chosen}, please answer.`).catch(() => {});
  });
  $("liveRoomExportAttendanceBtn")?.addEventListener("click", () => {
    exportLiveAttendanceCsv();
  });
  $("liveRoomWaitingToggle")?.addEventListener("change", () => {
    runHostAction("toggle_waiting_room", { enabled: Boolean(el.liveRoomWaitingToggle?.checked) })
      .catch((err) => toast(err?.message || "Failed to update waiting room", "error"));
  });
  $("liveRoomAssignBreakoutBtn")?.addEventListener("click", () => {
    const uid = Number(state.liveRoom.selectedParticipantId || 0);
    const room = String(el.liveRoomBreakoutName?.value || "").trim();
    if (!uid) return toast("Select a participant first", "error");
    if (!room) return toast("Enter breakout room name", "error");
    runHostAction("assign_breakout", { target_user_id: uid, room })
      .then(() => toast("Breakout assigned"))
      .catch((err) => toast(err?.message || "Failed to assign breakout", "error"));
  });
  $("liveRoomClearBreakoutsBtn")?.addEventListener("click", () => {
    runHostAction("clear_breakouts")
      .then(() => toast("Breakout rooms closed"))
      .catch((err) => toast(err?.message || "Failed to close breakouts", "error"));
  });
  $("liveRoomStartRecordingBtn")?.addEventListener("click", () => {
    startLiveRecording()
      .then(() => toast("Recording started"))
      .catch((err) => toast(err?.message || "Failed to start recording", "error"));
  });
  $("liveRoomPauseRecordingBtn")?.addEventListener("click", () => {
    try {
      toggleLiveRecordingPause();
    } catch (err) {
      toast(err?.message || "Failed to pause/resume recording", "error");
    }
  });
  $("liveRoomStopRecordingBtn")?.addEventListener("click", () => {
    stopLiveRecording()
      .then(() => toast("Recording stopped"))
      .catch((err) => toast(err?.message || "Failed to stop recording", "error"));
  });
  document.addEventListener("keydown", handleKeyboardShortcuts);
}

(async function boot() {
  try {
    applyWorkspaceCollapse(localStorage.getItem("certora_workspace_collapsed") === "1");
  } catch {
    applyWorkspaceCollapse(false);
  }
  bindEvents();
  applyAssessmentOnlyMode();
  try {
    const params = new URLSearchParams(window.location.search || "");
    const key = String(params.get("issued_key") || "").trim();
    if (key) {
      state.issuedAccessKey = key;
      if (el.issuedCandidateEmail) {
        el.issuedCandidateEmail.disabled = true;
        el.issuedCandidateEmail.placeholder = "Email locked by issued link";
      }
    }
  } catch {}
  showAuthMode("login");
  showView("auth");
  try {
    await initFirebase();
  } catch (err) {
    setAuthActionState(false);
    toast(formatAuthError(err, "Authentication setup failed"), "error");
    log("firebase_init_error", String(err));
  }
  log("ready", { message: "Admin + provider workspace loaded." });
})();




