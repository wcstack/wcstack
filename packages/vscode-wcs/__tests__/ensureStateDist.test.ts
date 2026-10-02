import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * scripts/ensure-state-dist.mjs — `@wcstack/state`（file:../state-next）の dist を確かめる前処理。
 * dist は Vitest の globalSetup で既にあるので、ここでは「正しいリンクを古いリンクと取り違えない」ことを見る。
 */
const pkgRoot = join(__dirname, '..');

describe('ensure-state-dist', () => {
  it('正しいリンクでは何もせずに終わる', () => {
    const run = spawnSync(process.execPath, ['scripts/ensure-state-dist.mjs'], { cwd: pkgRoot, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });

  // Windows では import.meta.url 由来のパスがドライブ文字の大小を起動のとおりに持つ（VS Code のタスクは `c:\…`）。
  // リンクの照合でそれを「古いリンク」と取り違えて止まっていた（K12(a) の退行）
  it.skipIf(process.platform !== 'win32')('小文字のドライブ文字で起動しても、正しいリンクを古いリンクと取り違えない（Windows）', () => {
    const lower = pkgRoot.replace(/^[A-Z]:/, (d) => d.toLowerCase());
    const run = spawnSync(process.execPath, ['scripts/ensure-state-dist.mjs'], { cwd: lower, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const upper = pkgRoot.replace(/^[a-z]:/, (d) => d.toUpperCase());
    expect(spawnSync(process.execPath, ['scripts/ensure-state-dist.mjs'], { cwd: upper, encoding: 'utf8' }).status).toBe(0);
  });
});
