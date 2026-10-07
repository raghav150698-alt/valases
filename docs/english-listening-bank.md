English listening conversations
===============================

The bank is maintained in `app/content/english_listening_bank.json`; audio excerpts
are bundled in `app/web_assessment_react/public/assessment-audio/conversations/`.
Both recruiter and candidate builds include these assets. No third-party audio
request is made during an exam. Existing VOA files remain available for legacy
attempts.

Source: [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), AMI
Consortium / University of Edinburgh. Recordings and transcriptions are distributed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). These excerpts are
human design-team role-play discussions, not synthetic voices or conversations
from actual customer projects. They retain pauses, accent variation and overlap.
The only audio modifications are trimming, MP3 encoding and loudness normalisation;
we do not accelerate speech or splice individual turns together. Credits and the
licence link accompany the candidate player.

Inventory (bank version 4): **36 distinct audio files**, each with six questions.
**30 recordings are selectable in the regional assessments: 15 US and 15 UK.**
The six mixed/unclassified AMI files remain outside these pools.

The US pool contains 13 spontaneous EdAcc excerpts and two scripted VOA teaching
dialogues. The new conversations include a self-described American-accent speaker
and an international partner; both voices are not exclusively American. C64's
American-accent speaker reports English/Japanese first languages and residence in
Hawaii; the partner reports an Indonesian accent. C19's speaker reports an
American accent with English/Shona first languages; the partner reports Chinese
or mixed accents. These are accent self-reports, not nationality labels or an
independent listening assessment. The mixed accent label accompanies the player.

The UK pool contains 13 EdAcc excerpts with Scottish or Southern London accent
profiles and two UK-led AMI workplace excerpts with an international colleague.
All 15 UK clips are spontaneous human speech. The regional pools have four source
conversations each: multiple excerpts share speakers. Audio-file count is not the
number of independent conversations or speaker pairs. The inventory is recorded
in `docs/english-listening-inventory.csv`.

Each regional attempt selects one recording with six questions. The 24 clips
added in this expansion are 121.9–209.9 seconds long and cover everyday topics
without requiring specialist role knowledge. Questions have timed transcript
support; independent listening, ambiguity review and empirical difficulty
calibration remain pending. Recruiter previews explicitly show these limitations.

New English template installations use catalog version 15, with separate US and
UK recruiter choices, regional spelling and contextual writing prompts. On first candidate
login, the backend selects the audio and matching questions using the invitation's
secret key and freezes the complete task and answer keys in a server-side issue
snapshot. Resume, submission scoring, speaking-upload validation and recruiter
review use that snapshot. Changing the bank cannot change a started attempt.
Legacy attempts without a snapshot continue with their original task. Listening
and reading retain 20 marks each despite having six and twelve questions. The
candidate response contains neither the bank nor answer keys nor question-evidence
timestamps or transcript references. Recruiter tests rotate locally on
launch/restart and avoid the previous recording when possible; they do not create
issued attempts. Recruiter previews explain the starter pools' limitations.

To add content, add a versioned conversation entry with its meeting ID, excerpt
start and duration, six single-answer questions, CEFR-informed difficulty labels
and transcript evidence times. Set `status` to `draft` until content review, then
`ready`. Supply verified locales (en-US or en-GB), an accent profile and source
evidence. Transcript references can replace timestamps for existing bundled audio.
Do not modify published IDs in place: retain existing files and use a new
ID for changed audio. Keep multiple ready recordings per region available. New
recordings should balance listening demand and topics across attempts. These initial
question difficulty labels are editorial estimates; natural overlapping speech
needs listening review and cohort piloting before calling the bank calibrated.

Run `python scripts/prepare_english_listening_audio.py` with ffmpeg installed to
download the licensed WAV sources into the ignored local cache under `data/` and
prepare the excerpts. Run `python -m unittest tests.services.test_english_listening`
to verify selection, answer keys and frozen sessions. The existing English API
tests verify scoring and candidate-answer sanitisation.

The 26 EdAcc clips are from the current
[EdAcc release](https://datashare.ed.ac.uk/handle/10283/8983), under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The original
release's MD5 checksum was verified: `146b4b8026b5d0ce9611667c708456b3`.
Original `linguistic_background.csv`, `test/segments`, `test/text`, `dev/segments`
and `dev/text` provide the speaker and timing evidence. The intake ledger records
all 26 clips. New excerpts from the same WAV do not overlap. All 36 stored files
have unique SHA-256 hashes and pass full decoding/duration checks in
`docs/english-listening-audit.json`.

To reproduce them, run `python scripts/fetch_edacc_sources.py` (large source
download, resumable ranges), then `python scripts/prepare_edacc_excerpts.py`.
The source-fetch script extracts only configured WAV files into the ignored cache.
Source-specific licence and adaptation credits override the AMI bank defaults.
