import { rename } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("dist-candidate");
await rename(
  resolve(outputDirectory, "candidate.html"),
  resolve(outputDirectory, "index.html"),
);
