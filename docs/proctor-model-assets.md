# Proctor model assets

The candidate application serves its MediaPipe model files from the same origin
so proctor initialization does not depend on a third-party CDN at assessment
time.

| Asset | Upstream source | SHA-256 |
| --- | --- | --- |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task` | `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF` |
| `efficientdet_lite0.tflite` | `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite` | `4B59100025BEA1235A84C1038879A6CCCC9F6C49F5E41144E91E74D99E780993` |

Verify the checked-in files before a release:

```powershell
Get-FileHash -Algorithm SHA256 `
  app/web_assessment_react/public/vendor/mediapipe/models/face_landmarker.task, `
  app/web_assessment_react/public/vendor/mediapipe/models/efficientdet_lite0.tflite
```
