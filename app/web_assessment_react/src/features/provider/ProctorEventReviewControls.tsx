import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";

type ProctorEvent = {
  review_key?: string;
  event_type?: string;
  severity?: string;
  details?: Record<string, unknown>;
  recorded_at?: string;
};

type ProctorReviewLabel = {
  id: number;
  event_key: string;
  event_type: string;
  reviewer_label: "confirmed" | "false_positive" | "uncertain" | "missed_detection";
  reviewer_notes?: string | null;
};

type Props = {
  issueId: number;
  events?: ProctorEvent[] | null;
  labels?: ProctorReviewLabel[] | null;
  onSaved: () => Promise<unknown> | void;
};

const MISSED_EVENT_TYPES = [
  ["mobile_phone_detected", "Mobile phone"],
  ["multiple_faces_sustained", "Additional person"],
  ["possible_overlapping_voice_activity_advisory", "Overlapping voice"],
  ["look_away_sustained", "Sustained gaze away"],
  ["object_detected_advisory", "Restricted object"],
  ["face_identity_mismatch", "Identity mismatch"],
  ["other_integrity_signal", "Other integrity signal"],
] as const;

function dispositionLabel(event: ProctorEvent): string {
  const disposition = String(event.details?.policy_disposition || "");
  if (disposition === "high_confidence_flag") return "High-confidence flag";
  if (disposition === "review") return "Needs review";
  if (disposition === "ignore") return "Ignored";
  return event.severity || "Info";
}

function labelText(label?: ProctorReviewLabel["reviewer_label"]): string {
  if (label === "confirmed") return "Confirmed";
  if (label === "false_positive") return "False alarm";
  if (label === "uncertain") return "Uncertain";
  if (label === "missed_detection") return "Missed detection";
  return "Not reviewed";
}

export function ProctorEventReviewControls({ issueId, events, labels, onSaved }: Props) {
  const [missedEventType, setMissedEventType] = useState<string>(MISSED_EVENT_TYPES[0][0]);
  const [missedNotes, setMissedNotes] = useState("");
  const labelsByEvent = useMemo(() => new Map((labels || []).map((label) => [label.event_key, label])), [labels]);
  const missedLabels = (labels || []).filter((label) => label.reviewer_label === "missed_detection");

  const saveLabel = useMutation({
    mutationFn: async (payload: { event_key?: string; event_type: string; reviewer_label: ProctorReviewLabel["reviewer_label"]; reviewer_notes?: string }) => (
      await api.post(`/exams/issued/${issueId}/review/proctor-labels`, payload)
    ).data,
    onSuccess: async (_data, payload) => {
      if (payload.reviewer_label === "missed_detection") setMissedNotes("");
      await onSaved();
    },
  });

  return (
    <div className="review-panel proctor-signal-review">
      <div className="proctor-signal-review-head">
        <div><strong>Integrity activity</strong><p className="review-panel-intro">Confirm whether each signal is supported by the available evidence.</p></div>
        <span>{labelsByEvent.size}/{events?.length || 0} reviewed</span>
      </div>
      {Array.isArray(events) && events.length ? <div className="proctor-signal-list">
        {events.map((event, index) => {
          const eventKey = String(event.review_key || "");
          const current = labelsByEvent.get(eventKey);
          return <div className="proctor-signal-row" key={eventKey || `${event.event_type}-${index}`}>
            <div className="proctor-signal-copy">
              <strong>{event.event_type?.replaceAll("_", " ") || "Integrity signal"}</strong>
              <small>{dispositionLabel(event)}{event.recorded_at ? ` · ${new Date(event.recorded_at).toLocaleString()}` : ""}</small>
            </div>
            <div className="proctor-signal-actions" aria-label={`Review ${event.event_type || "integrity signal"}`}>
              {(["confirmed", "false_positive", "uncertain"] as const).map((choice) => <button
                type="button"
                className={current?.reviewer_label === choice ? "selected" : ""}
                disabled={!eventKey || saveLabel.isPending}
                onClick={() => saveLabel.mutate({ event_key: eventKey, event_type: String(event.event_type || "integrity_signal"), reviewer_label: choice })}
                key={choice}
              >{labelText(choice)}</button>)}
            </div>
          </div>;
        })}
      </div> : <p className="review-panel-intro">No integrity events were recorded.</p>}

      <div className="missed-signal-entry">
        <strong>Record a missed detection</strong>
        <p className="review-panel-intro">Use this when the evidence shows an integrity event that the system did not report.</p>
        <div>
          <select value={missedEventType} onChange={(event) => setMissedEventType(event.target.value)}>
            {MISSED_EVENT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <input value={missedNotes} onChange={(event) => setMissedNotes(event.target.value)} placeholder="Describe what was missed" maxLength={2000} />
          <button type="button" disabled={missedNotes.trim().length < 5 || saveLabel.isPending} onClick={() => saveLabel.mutate({ event_type: missedEventType, reviewer_label: "missed_detection", reviewer_notes: missedNotes.trim() })}>Add</button>
        </div>
        {missedLabels.length > 0 && <div className="missed-signal-list">{missedLabels.map((label) => <span key={label.id}><b>{label.event_type.replaceAll("_", " ")}</b>{label.reviewer_notes ? ` · ${label.reviewer_notes}` : ""}</span>)}</div>}
      </div>
      {saveLabel.isError && <div className="workspace-error">The integrity review label could not be saved.</div>}
    </div>
  );
}
