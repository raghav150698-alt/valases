"""Versioned listening content, selected once and frozen for each issued attempt."""
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
import json
import random
from types import SimpleNamespace

BANK_PATH = Path(__file__).resolve().parents[1] / "content" / "english_listening_bank.json"
SNAPSHOT_KEY = "_english_task_snapshot"

@lru_cache(maxsize=1)
def load_listening_bank() -> dict:
    bank = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    rows = bank.get("conversations", [])
    ids = set()
    question_ids = set()
    for row in rows:
        if row["id"] in ids:
            raise ValueError("Duplicate listening conversation ID")
        ids.add(row["id"])
        if set(row.get("locales", [])) - {"en-US", "en-GB"}:
            raise ValueError("Unknown listening locale")
        if row.get("locales") and not row.get("accent_profile"):
            raise ValueError("Regional recordings require an accent profile")
        if not 60 <= row["duration_seconds"] <= 250 or len(row["questions"]) != 6:
            raise ValueError("Each conversation needs bounded audio and six questions")
        for question in row["questions"]:
            if question["id"] in question_ids or not question["id"].startswith("l"):
                raise ValueError("Listening questions need unique listening IDs")
            question_ids.add(question["id"])
            if "evidence_seconds" not in question and not question.get("evidence_reference"):
                raise ValueError("Listening questions require transcript evidence")
            if question["answer"] not in question["options"] or len(set(question["options"])) != 4:
                raise ValueError("Listening answer must match one of four distinct options")
            if "evidence_seconds" in question and not row["start_seconds"] <= question["evidence_seconds"] < row["start_seconds"] + row["duration_seconds"]:
                raise ValueError("Question evidence lies outside the audio excerpt")
    return bank

def summarize_listening_bank(bank: dict) -> dict:
    """Recruiter-facing inventory, with no claims of empirical calibration."""
    rows = [row for row in bank["conversations"] if row.get("status") == "ready"]
    durations = [row["duration_seconds"] for row in rows]
    natural = sum(row.get("speech_style", "").startswith("spontaneous") for row in rows)
    scripted = sum("scripted" in row.get("speech_style", "") for row in rows)
    source_conversations = {(row.get("source", bank.get("source")), row.get("source_conversation_id", row.get("meeting_id", row["id"])).split("_P")[0]) for row in rows}
    difficulties = sorted({q.get("difficulty", "Unlabelled") for row in rows for q in row["questions"]})
    warnings = []
    if len(rows) < 20:
        warnings.append("Small pool: recordings will repeat across a large candidate cohort.")
    if len(source_conversations) < len(rows):
        warnings.append("Some clips share a source conversation and speakers; clip count is not independent conversation count.")
    if scripted:
        warnings.append("This pool includes scripted teaching dialogues; natural replacements are still needed.")
    if any(row.get("accent_mix") == "mixed" or "colleague" in row.get("accent_profile", "") for row in rows):
        warnings.append("This regional pool includes international conversations with mixed accents.")
    if any(not 120 <= duration <= 210 for duration in durations):
        warnings.append("Some recordings fall outside the proposed 2–3.5 minute range; difficulty review is pending.")
    if any("pending" in row.get("review_status", "") for row in rows):
        warnings.append("New excerpts have transcript-backed questions; independent listening review is pending.")
    warnings.append("Difficulty labels are editorial estimates. US/UK equivalence and pass thresholds need an all-role pilot.")
    return {"recording_count": len(rows), "source_conversation_count": len(source_conversations), "natural_count": natural, "scripted_count": scripted,
            "duration_min_seconds": min(durations, default=0), "duration_max_seconds": max(durations, default=0),
            "difficulty_labels": difficulties, "questions_per_attempt": 6, "recordings_per_attempt": 1,
            "calibration_status": "Not calibrated", "readiness": "Pilot content", "target_recording_count": 20,
            "warnings": warnings}

def select_listening_task(task: dict, seed: str, *, previous_ids: tuple[str, ...] = ()) -> dict:
    """Select one recording; keep audio, questions and keys together."""
    output = deepcopy(task)
    bank = output.get("metadata", {}).get("listening_bank")
    if not bank:
        return output
    locale = output["metadata"].get("english_locale")
    rows = [row for row in bank["conversations"] if row.get("status") == "ready" and (not locale or locale in row.get("locales", []))]
    fresh = [row for row in rows if row["id"] not in previous_ids]
    if fresh:
        rows = fresh
    rng = random.Random(seed)
    rng.shuffle(rows)
    selected = rows[:1]
    if not selected:
        raise ValueError("Listening bank requires a ready recording")
    section = next(section for section in output["metadata"]["sections"] if section["id"] == "listening")
    old_ids = {item["id"] for item in section["items"]}
    expected = output["expected_output"]["objective_answers"]
    for item_id in old_ids:
        expected.pop(item_id, None)
    items = []
    for index, row in enumerate(selected, start=1):
        items.append({
            "id": f"listen-{row['id']}", "type": "audio", "label": f"Conversation {index} · {row['title']}",
            "prompt": "Listen to the complete discussion. The questions will appear after the recording.",
            "audio_url": row.get("audio_url", f"/assessment-audio/conversations/{row['id']}.mp3"), "duration_seconds": row["duration_seconds"],
            **{key: row.get(key, bank[key]) for key in ("source", "source_url", "license", "license_url", "attribution")},
            "conversation_id": row["id"],
            "accent_label": row.get("accent_label", ""),
        })
        for question in row["questions"]:
            question = deepcopy(question)
            rng.shuffle(question["options"])
            items.append(question)
            expected[question["id"]] = question["answer"]
    section.update({"items": items, "description": "Listen to one everyday or workplace conversation and answer questions about detail, purpose and inference.", "intro": "You will hear one everyday or workplace conversation. The recording plays once. Answer the questions from memory after it finishes.", "attribution": items[0]["attribution"]})
    output["metadata"]["listening_selection"] = {"bank_version": bank["version"], "conversation_ids": [row["id"] for row in selected]}
    output["metadata"].pop("listening_bank", None)
    return output

def attach_listening_bank(definition: dict) -> dict:
    if not definition.get("id", "").startswith("professional-english-communication"):
        return definition
    bank = deepcopy(load_listening_bank())
    definition["task"]["metadata"]["listening_bank"] = bank
    locale = definition["task"]["metadata"].get("english_locale")
    if locale:
        bank["conversations"] = [row for row in bank["conversations"] if locale in row.get("locales", [])]
    else:
        bank["conversations"] = [row for row in bank["conversations"] if not row.get("audio_url")]
    # Provider summary previews have a representative recording; candidate sessions
    # receive their own selection, frozen at first login.
    representative = select_listening_task(definition["task"], "catalog-listening-v1")
    representative["metadata"]["listening_bank"] = bank
    representative["metadata"]["listening_quality"] = summarize_listening_bank(bank)
    definition["task"] = representative
    return definition

def regional_english_definition(definition: dict, locale: str) -> dict:
    """Create a regional catalog choice, with matching regional listening content."""
    if locale not in {"en-US", "en-GB"}:
        raise ValueError("Unsupported English locale")
    region = "US" if locale == "en-US" else "UK"
    output = deepcopy(definition)
    if locale == "en-US":
        replacements = {"organisations": "organizations", "organisation": "organization", "Organisation": "Organization", "Summarise": "Summarize", "summarise": "summarize", "recognises": "recognizes", "rumours": "rumors", "programme": "program", "judgement": "judgment", "fulfilment": "fulfillment", "cancelling": "canceling", "wellbeing": "well-being"}
        def localize(value):
            if isinstance(value, str):
                for before, after in replacements.items():
                    value = value.replace(before, after)
                return value
            if isinstance(value, list):
                return [localize(item) for item in value]
            if isinstance(value, dict):
                return {key: localize(item) for key, item in value.items()}
            return value
        output = localize(output)
    output["id"] = f"professional-english-communication-{region.lower()}"
    output["title"] = f"English Language Assessment · {region}"
    output["summary"] = f"{region} workplace English: regional listening, vocabulary, reading, writing and speaking. One randomly selected conversation per attempt."
    task = output["task"]
    # Rubric identifiers are stable API keys, independent of displayed spelling.
    task["grading_config"] = deepcopy(definition["task"]["grading_config"])
    task["title"] = output["title"]
    task["metadata"]["english_locale"] = locale
    task["metadata"]["english_region"] = region
    task["metadata"]["listening_content_note"] = (
        "US pilot pool: spontaneous international conversations with a self-described American-accent speaker and an international partner, plus two scripted VOA dialogues. Mixed accents are explicitly labelled; independent listening and difficulty review are pending."
        if region == "US" else
        "UK pilot pool: spontaneous Southern London and Scottish conversations, plus UK-led workplace discussions with an international colleague. Independent listening and difficulty review are pending."
    )
    task["instructions"] += f" Use {region} workplace vocabulary and spelling where appropriate; clear communication and intelligibility remain the scoring criteria."
    sections = task["metadata"]["sections"]
    writing = next(section for section in sections if section["id"] == "writing")
    writing["items"][1]["prompt"] = (
        "A New York customer paid a $250 setup fee, but a promised implementation update was late and incomplete. Write a customer service email acknowledging the issue, explaining immediate next steps without unsupported promises, and proposing a follow-up time in Eastern Time. Use US workplace vocabulary and spelling."
        if region == "US" else
        "A London customer paid a £250 set-up fee, but a promised implementation update was late and incomplete. Write a customer service email acknowledging the issue, explaining immediate next steps without unsupported promises, and proposing a follow-up time in UK local time. Use UK workplace vocabulary and spelling."
    )
    return attach_listening_bank(output)


def task_for_issued_attempt(task, issue, *, create: bool = False):
    if task is None or str(task.type) != "english_language":
        from app.services.practical_assessment_banks import practical_task_for_issued_attempt
        return practical_task_for_issued_attempt(task, issue, create=create)
    result = dict(issue.result_json or {})
    snapshot = result.get(SNAPSHOT_KEY)
    if snapshot is None and create and (task.metadata_json or {}).get("listening_bank"):
        snapshot = select_listening_task({
            "id": task.id, "assessment_id": task.assessment_id, "type": task.type,
            "title": task.title, "description": task.description, "instructions": task.instructions,
            "marks": task.marks, "metadata": task.metadata_json,
            "expected_output": task.expected_output_json, "grading_config": task.grading_config_json,
        }, f"{issue.access_key}:{issue.id}")
        issue.result_json = {**result, SNAPSHOT_KEY: snapshot}
    if snapshot is None:
        return task  # Existing sessions created before bank support stay intact.
    return SimpleNamespace(**{**{key: snapshot[key] for key in ("id", "assessment_id", "type", "title", "description", "instructions", "marks")}, "metadata_json": deepcopy(snapshot["metadata"]), "expected_output_json": deepcopy(snapshot["expected_output"]), "grading_config_json": deepcopy(snapshot["grading_config"])})
