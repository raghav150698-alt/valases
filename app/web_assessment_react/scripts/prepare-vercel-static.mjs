import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const sourceDirectory = resolve(webDirectory, "dist");
const deploymentRoot = resolve(webDirectory, "..", "..", "public");
const assessmentDirectory = resolve(deploymentRoot, "assessment");

if (!existsSync(resolve(sourceDirectory, "index.html"))) {
  throw new Error("The recruiter frontend must be built before preparing Vercel static files.");
}

rmSync(assessmentDirectory, { recursive: true, force: true });
mkdirSync(assessmentDirectory, { recursive: true });
cpSync(sourceDirectory, assessmentDirectory, { recursive: true });

console.log(`Prepared static recruiter frontend at ${assessmentDirectory}`);
