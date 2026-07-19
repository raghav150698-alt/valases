# Candidate Assessment and Proctoring Consent

**Status:** Product draft for legal review  
**Version:** 1.0  
**Effective date:** 19 July 2026

Before starting a proctored assessment, the candidate must be shown a clear notice and actively acknowledge it. The checkbox must not be preselected.

## Candidate-facing wording

> I understand that this assessment is administered by the organization that issued my assessment link. I agree that my answers, submitted files, formulas, code, timestamps, and assessment activity may be collected and used to administer, score, secure, and review this assessment.
>
> If this assessment is proctored, I consent to the stated browser checks and to the collection of the proctoring data described on this page, which may include camera or microphone access, fullscreen and tab-visibility events, focus changes, clipboard or restricted-shortcut events, and model-derived integrity signals. I understand that a security warning may be shown during the assessment and that reaching the warning limit or leaving fullscreen may close the assessment and send it for human review.
>
> I understand that automated proctoring signals are not, by themselves, a final employment decision. I can contact the issuing organization about the assessment, my data, accessibility needs, or a review of a flagged attempt.

## Required implementation behavior

- Require an unticked checkbox before the timer and assessment workspace start.
- Link to the privacy policy and retention/deletion policy from the consent surface.
- Record consent version, timestamp, assessment issue, and candidate session identifier.
- Do not collect camera, microphone, or recording data before the relevant permission and consent are confirmed.
- Provide an alternative or accommodation process configured by the issuing organization.

The wording must be reviewed and localized by the organization and its legal counsel before production use.
