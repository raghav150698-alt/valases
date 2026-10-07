import "./EnglishContentSummary.css";

type Quality = {
  recording_count: number; natural_count: number; scripted_count: number; source_conversation_count?: number;
  duration_min_seconds: number; duration_max_seconds: number;
  difficulty_labels: string[]; questions_per_attempt: number;
  calibration_status: string; readiness: string; warnings: string[];
};
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export function EnglishContentSummary({ metadata }: { metadata?: Record<string, unknown> }) {
  const quality = metadata?.listening_quality as Quality | undefined;
  if (!quality) return null;
  return <section className="english-content-summary" aria-label="English assessment content readiness">
    <div className="english-content-heading"><strong>{String(metadata?.english_region || "Workplace")} English content</strong><span>{quality.readiness}</span></div>
    <dl>
      <div><dt>Available recordings</dt><dd>{quality.recording_count}</dd></div>
      {quality.source_conversation_count !== undefined && <div><dt>Source conversations</dt><dd>{quality.source_conversation_count}</dd></div>}
      <div><dt>Per attempt</dt><dd>1 random audio · {quality.questions_per_attempt} questions</dd></div>
      <div><dt>Recording length</dt><dd>{duration(quality.duration_min_seconds)}–{duration(quality.duration_max_seconds)}</dd></div>
      <div><dt>Conversation style</dt><dd>{quality.natural_count} spontaneous · {quality.scripted_count} scripted</dd></div>
      <div><dt>Estimated listening difficulty</dt><dd>{quality.difficulty_labels.join(" / ")}</dd></div>
      <div><dt>Calibration</dt><dd>{quality.calibration_status}</dd></div>
    </dl>
    <ul>{quality.warnings.map(message => <li key={message}>{message}</li>)}</ul>
    <p>Writing and speaking require reviewer scoring. Listening and reading each contribute 20 marks.</p>
  </section>;
}
