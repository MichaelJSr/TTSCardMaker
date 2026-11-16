// action.yml's: python3 -S -m commands.card_preview_branch --hand $RUNNER_TEMP/preview in bot/, detached. Never fails.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
try {
  const temp = process.env.RUNNER_TEMP, log = fs.openSync(path.join(temp, "hand.log"), "a");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ACTIONS_")));
  const child = spawn("python3", ["-S", "-m", "commands.card_preview_branch", "--hand", path.join(temp, "preview")],
    { cwd: path.join(process.env.GITHUB_WORKSPACE, "bot"), env, detached: true, stdio: ["pipe", log, log] });
  child.on("error", (e) => fs.appendFileSync(path.join(temp, "hand.log"), `hand-over: ${e.message}\n`));
  child.stdin.on("error", () => {});
  child.stdin.end(`${process.env.ACTIONS_RUNTIME_TOKEN || ""}\n${process.env.ACTIONS_RESULTS_URL || ""}\n`);
  if (child.pid) fs.writeFileSync(path.join(temp, "hand.pid"), String(child.pid));
  child.unref();
} catch (e) {
  console.log(`hand-over not started: ${e.message}`);
}
