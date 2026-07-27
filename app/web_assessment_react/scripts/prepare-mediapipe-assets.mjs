import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const wasmSource = resolve("node_modules/@mediapipe/tasks-vision/wasm");
const wasmDestination = resolve("public/vendor/mediapipe/wasm");
const modelSource = resolve("../../data/proctoring/models/mediapipe");
const modelDestination = resolve("public/vendor/mediapipe/models");
const models = [
  {
    file: "face_landmarker.task",
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  },
  {
    file: "efficientdet_lite0.tflite",
    sha256: "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb",
  },
];

await rm(wasmDestination, { recursive: true, force: true });
await rm(modelDestination, { recursive: true, force: true });
await mkdir(resolve("public/vendor/mediapipe"), { recursive: true });
await mkdir(modelDestination, { recursive: true });
await cp(wasmSource, wasmDestination, { recursive: true });

for (const model of models) {
  const source = resolve(modelSource, model.file);
  const contents = await readFile(source);
  const checksum = createHash("sha256").update(contents).digest("hex");

  if (checksum !== model.sha256) {
    throw new Error(
      `MediaPipe model checksum mismatch for ${model.file}: expected ${model.sha256}, received ${checksum}`,
    );
  }

  await cp(source, resolve(modelDestination, model.file));
}
