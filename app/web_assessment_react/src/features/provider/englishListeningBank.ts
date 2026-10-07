import type { EnglishItem, EnglishSection } from "../issued/EnglishAssessmentRunner";

type Conversation = { id: string; meeting_id: string; title: string; duration_seconds: number; status: string; locales?: string[]; audio_url?: string; accent_label?: string; source?: string; attribution?: string; license?: string; license_url?: string; questions: Array<EnglishItem & { answer: string }> };
type Bank = { version: number; source: string; source_url: string; license: string; license_url: string; attribution: string; conversations: Conversation[] };
type TrialTask = { metadata?: Record<string, unknown>; expected_output?: Record<string, unknown> };

const randomIndex = (length: number) => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return Math.floor((values[0] / 0x100000000) * length);
};
function shuffle<T>(values: T[], index: (length: number) => number): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = index(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Recruiter-only test selection. Live candidates use the server-pinned task. */
export function createListeningTrial<T extends TrialTask>(task: T, previousIds: string[] = [], index = randomIndex): T {
  const copy = structuredClone(task);
  const bank = copy.metadata?.listening_bank as Bank | undefined;
  if (!bank) return copy;
  const locale = copy.metadata?.english_locale as string | undefined;
  let rows = bank.conversations.filter(row => row.status === "ready" && (!locale || row.locales?.includes(locale)));
  const fresh = rows.filter(row => !previousIds.includes(row.id));
  if (fresh.length) rows = fresh;
  const selected = shuffle(rows, index).slice(0, 1);
  if (!selected.length) throw new Error("Listening bank requires a ready recording.");
  const sections = copy.metadata!.sections as EnglishSection[];
  const section = sections.find(entry => entry.id === "listening");
  if (!section) throw new Error("Listening section is missing.");
  const expected = { ...(copy.expected_output?.objective_answers as Record<string, string> || {}) };
  for (const item of section.items) delete expected[item.id];
  section.items = selected.flatMap((row, position) => {
    const audio = { id: `listen-${row.id}`, type: "audio" as const, label: `Conversation ${position + 1} · ${row.title}`, prompt: "Listen to the complete conversation. The questions will appear after the recording.", audio_url: row.audio_url || `/assessment-audio/conversations/${row.id}.mp3`, duration_seconds: row.duration_seconds, source: row.source || bank.source, attribution: row.attribution || bank.attribution, license: row.license || bank.license, license_url: row.license_url || bank.license_url };
    return [{ ...audio, accent_label: row.accent_label || "" }, ...row.questions.map(question => { expected[question.id] = question.answer; return { ...question, options: shuffle(question.options || [], index) }; })];
  });
  section.intro = "You will hear one everyday or workplace conversation. The recording plays once. Answer the questions from memory after it finishes.";
  section.description = "Listen to one everyday or workplace conversation and answer questions about detail, purpose and inference.";
  copy.expected_output = { ...copy.expected_output, objective_answers: expected };
  copy.metadata!.listening_selection = { bank_version: bank.version, conversation_ids: selected.map(row => row.id) };
  return copy;
}
