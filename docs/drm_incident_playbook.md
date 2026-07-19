# Stream DRM Incident Playbook

## Goal
Contain leaked course video access quickly, preserve evidence, and restore service safely.

## Immediate Actions (0-15 min)
1. Identify the affected `course_id`, `lesson_video_id`, and suspected `user_id` (if known).
2. Revoke active sessions for the user or course:
   - `PATCH /stream/admin/users/{user_id}/revoke-sessions`
   - `PATCH /stream/admin/watch-sessions/{session_id}/revoke`
3. Pull latest security events:
   - `GET /stream/admin/security-events?limit=200`
4. Preserve evidence:
   - Save event payloads (`stream_drm_anomaly`, `stream_session_revoked`)
   - Save source links/screenshots from reported leak posts.

## Short-Term Containment (15-60 min)
1. Tighten stream controls temporarily in env:
   - `STREAM_PLAYBACK_TOKEN_TTL_SECONDS=120` (or lower)
   - `STREAM_DRM_LICENSE_TTL_SECONDS=90`
   - `STREAM_DRM_AUTO_REVOKE_ON_IP_MISMATCH=true`
2. Restart backend to apply updated env.
3. Re-test one authorized playback flow end-to-end.

## Forensic Checklist
1. Correlate watermark values in leaked media:
   - user label/email
   - `C:<course_id>`
   - `S:<session_id>`
   - timestamp shown in watermark
2. Match watermark/session with:
   - `video_watch_sessions`
   - `audit_logs` stream events
3. Export timeline:
   - session start
   - anomaly events
   - revoke action
   - leak post/report timestamps

## Recovery
1. Return env values to standard production posture if needed.
2. Keep revoked sessions closed; force fresh playback sessions.
3. Record final incident summary in internal tracker.

## Notes
- Browser-side capture cannot be fully blocked at OS level.
- This pipeline is designed for fast containment, attribution, and response.
