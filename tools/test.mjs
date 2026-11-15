/** Explicit paths keep the suite portable across shells and supported Node versions. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const files = ["tests", "packs/AdminTools BP/scripts"].flatMap(dir =>
  fs.readdirSync(dir).filter(name => name.endsWith(".test.mjs")).sort().map(name => path.join(dir, name)));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
