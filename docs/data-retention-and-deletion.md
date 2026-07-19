# Data Retention and Deletion Policy

**Status:** Product default for legal and customer review  
**Effective date:** 19 July 2026

These periods are defaults. The recruiting organization must choose the final schedule, disclose it to candidates, and configure legal holds where required.

| Data category | Default retention | Deletion behavior |
| --- | ---: | --- |
| Unsubmitted candidate session and temporary browser state | 30 days | Purge automatically unless the attempt is submitted, terminated, under review, or on legal hold |
| Submitted answers, workbooks, code, scores, and reviewer notes | 24 months after completion | Delete or anonymize after the period; retain only aggregated metrics where possible |
| Proctoring events and model-derived signals | 12 months after completion | Delete with the related attempt unless needed for a documented review or legal hold |
| Camera, microphone, image, audio, or video evidence | 30 days after review completion | Delete from primary and object storage, including generated thumbnails and derivatives |
| Audit and security logs | 24 months | Minimize personal fields and delete or anonymize at expiry |
| Recruiter account and billing records | Account lifetime plus 24 months | Retain only records required for security, tax, accounting, or legal obligations |
| Backups | Rolling 35 days | Expire through the backup lifecycle; deletion requests propagate on the next backup expiry |

## Deletion workflow

1. Verify the requestor and identify the candidate, assessment, and organization.
2. Check legal holds, disputes, fraud investigations, and regulatory retention duties.
3. Delete or anonymize database rows, uploaded evidence, object-storage copies, exports, caches, and derived artifacts.
4. Preserve a minimal deletion audit record without retaining the deleted assessment content.
5. Confirm completion or explain the lawful reason for retaining specific data.

Deletion must be implemented as a server-side job with retries, an operator audit trail, and storage-provider verification. This policy does not override a stricter customer, contractual, or jurisdictional requirement.
