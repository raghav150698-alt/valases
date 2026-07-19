# Proctor Data Collection Guide

This folder plan is for your own image/video collection to improve:

- eyeball and gaze accuracy
- object detection and allow/block policy
- non-text-area gazing detection
- looking-away detection

## Main Save Path

Save everything under:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1
```

## Folder Layout

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1
├── 01_eye_tracking
│   ├── images
│   ├── videos
│   └── metadata
├── 02_screen_gaze
│   ├── images
│   ├── videos
│   └── metadata
├── 03_object_detection
│   ├── images
│   ├── videos
│   └── metadata
├── 04_looking_away
│   ├── images
│   ├── videos
│   └── metadata
└── templates
```

## Do You Need To Mark The Eyeball?

For normal collection: no, do not manually draw on the eyeball.

What we need instead:

- clean face visibility
- both eyes visible whenever possible
- good lighting on the face
- labeled direction or target area in the file name or manifest

Manual eyeball marking is only needed later if we build a very fine iris-center regression dataset by hand. For now, it is better to collect more clean labeled samples than to draw annotations.

## What To Collect

### 1. Eye Tracking

Purpose: improve iris and gaze direction accuracy.

Save under:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\01_eye_tracking
```

Collect both images and short videos for:

- center
- left
- right
- up
- down
- up_left
- up_right
- down_left
- down_right
- center_text
- center_non_text

Recommended file naming:

```text
eye_center_text_img_001.jpg
eye_left_vid_001.mp4
eye_down_right_img_002.jpg
```

### 2. Screen Gaze / Non-Text-Area Gaze

Purpose: learn which screen zone you are looking at, and whether it is text area or not.

Save under:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\02_screen_gaze
```

Collect:

- images while looking at known screen zones
- videos while moving gaze between known zones
- per-sample metadata for:
  - screen resolution
  - question text region
  - target gaze region

Use the template image:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\templates\screen_zone_template_1920x1080.svg
```

If the SVG feels too large on your screen, use this fit-to-screen version instead:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\templates\screen_zone_template_fit_screen.html
```

This is the pixel visualization reference. Use it on screen and look at specific boxes while recording.

Important:

- For this task, labels matter more than manual eye drawing.
- For each question screen, we should also store the text region rectangle so we know whether gaze stayed on the readable area.

### 3. Object Detection

Purpose: detect allowed and restricted objects.

Save under:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\03_object_detection
```

Start with these classes:

- `water_bottle` -> allowed
- `mug` -> allowed
- `phone` -> restricted
- `multiple_objects` -> mixed scene

Recommended collection:

- single object close to face/screen
- single object far from face/screen
- partially visible object
- object in hand
- object on desk
- multiple objects in same frame

Recommended file naming:

```text
object_phone_img_001.jpg
object_water_bottle_vid_001.mp4
object_multiple_objects_img_003.jpg
```

Important:

- Folder names and file names are enough for the first pass.
- For strong object detection training, we will later need bounding-box labels.
- If a frame has multiple objects, add them in metadata so we can label them later.

### 4. Looking Away

Purpose: improve head pose + gaze cheating signals.

Save under:

```text
D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\04_looking_away
```

Collect both images and videos for:

- away_left
- away_right
- away_up
- away_down
- away_far_left
- away_far_right
- away_over_shoulder
- away_phone_side
- away_table

Recommended file naming:

```text
away_left_img_001.jpg
away_far_right_vid_001.mp4
away_table_img_004.jpg
```

## Recording Tips

- Keep webcam position fixed for one session.
- Record another session with a different laptop height.
- Record in bright light, medium light, and low light.
- Wear glasses in some clips if you normally wear them.
- Keep background simple for some samples and busy for others.
- Use 5 to 15 second videos for most motion samples.
- Mix neutral samples heavily. We need many more normal samples than cheating samples.

## Metadata Files

Use these templates:

- `manifests\gaze_manifest_template.csv`
- `manifests\object_manifest_template.csv`
- `manifests\screen_text_region_template.csv`

## Best Immediate Plan

First collect in this order:

1. `01_eye_tracking`
2. `04_looking_away`
3. `02_screen_gaze`
4. `03_object_detection`

That order should improve the current proctor model fastest.

## Screen Looking Update

For the current screen-looking model:

- You do not need to manually mark the eyeball.
- We use MediaPipe face and iris landmarks automatically.
- Better accuracy will come from more varied clips, not hand-drawn eye labels.

Current training folders in active use:

- `D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\01_eye_tracking`
- `D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\02_screen_gaze`
- `D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\03_object_detection`
- `D:\Lenovo\certora\data\proctoring\raw\self_collection_v1\04_looking_away`

Best next collection priority for screen-looking accuracy:

1. more `TEXT AREA` videos
2. repeat all corner/edge screen-zone videos on different days
3. collect with brighter and dimmer light
4. collect with glasses and without glasses
5. collect with slightly different laptop distances and webcam heights
6. collect more "still on screen but not centered" clips so small variation stays allowed
