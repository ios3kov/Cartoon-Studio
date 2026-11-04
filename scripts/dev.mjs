import { spawn } from "node:child_process";

const children = [];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  const timeout = setTimeout(() => process.exit(code), 1500);
  timeout.unref();
  Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  ).then(() => process.exit(code));
}
function run(args, env = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!closing) stop(code ?? 1);
  });
}
run(["--import", "tsx", "server/index.ts"], {
  PORT: "4174",
  APP_ORIGIN: "http://127.0.0.1:5173",
});
run(["node_modules/vite/bin/vite.js"]);
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
