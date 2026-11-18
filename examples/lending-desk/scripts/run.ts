// Starts processes side by side and stops them together (Ctrl+C, or when one exits).
//   node scripts/run.ts dev    → API (3001) + Vite (5173)
//   node scripts/run.ts start  → API (3001) + static server for dist/ (3000)   (run `npm run build` first)
// API_PORT, DEV_PORT and STATIC_PORT change them.
import { spawn, type ChildProcess } from "node:child_process";

const mode = process.argv[2] ?? "dev";
const node = process.execPath;
const procs: [string, string[], NodeJS.ProcessEnv?][] = [["api", ["server/main.ts"]]];
if (mode === "dev") procs.push(["vite", ["node_modules/vite/bin/vite.js"]]);
else if (mode === "start") procs.push(["static", ["server/static.ts"]]);
else throw new Error(`unknown mode ${mode}`);

const children: ChildProcess[] = [];
let stopping = false;
const stop = (code: number): void => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
};
for (const [name, args, env] of procs) {
  const c = spawn(node, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  children.push(c);
  c.stdout?.on("data", (d: Buffer) => process.stdout.write(`[${name}] ${d}`));
  c.stderr?.on("data", (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
  c.on("exit", (code) => { if (!stopping) { console.error(`[${name}] exited (${code})`); stop(code ?? 1); } });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
