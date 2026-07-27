# Proctor model assets

The candidate application serves its MediaPipe model files from the same origin
so proctor initialization does not depend on a third-party CDN at assessment
time.

| Asset | Upstream source | SHA-256 |
| --- | --- | --- |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task` | `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF` |
| `efficientdet_lite0.tflite` | `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite` | `0720BF247BD76E6594EA28FA9C6F7C5242BE774818997DBBEFFC4DA460C723BB` |

The source models are checked in under `data/proctoring/models/mediapipe`.
The frontend build verifies their checksums and copies them into the public
MediaPipe asset directory. Verify the source files before a release:

```powershell
Get-FileHash -Algorithm SHA256 `
  data/proctoring/models/mediapipe/face_landmarker.task, `
  data/proctoring/models/mediapipe/efficientdet_lite0.tflite
```
