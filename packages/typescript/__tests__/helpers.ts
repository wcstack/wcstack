import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Fixtures are written to a temp dir at test time (AGENTS.md: never commit
 * intentionally-broken HTML / manifest fixtures — the wcs-validate CI gate
 * scans the repo).
 */
export function makeTempDir(prefix: string = "wcs-schema-"): { dir: string; write: (name: string, text: string) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    write(name, text) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
      return path;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
