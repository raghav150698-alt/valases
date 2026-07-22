import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("node_modules/@mediapipe/tasks-vision/wasm");
const destination = resolve("public/vendor/mediapipe/wasm");

await rm(dirname(destination), { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
