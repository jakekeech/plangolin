// Read .env from the project root. Eight lines beats a dependency, and a real
// environment variable still wins so a one-off override works.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function loadEnv(root) {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const key = t.slice(0, i).trim();
    const value = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (value && !(key in process.env)) process.env[key] = value;
  }
}
