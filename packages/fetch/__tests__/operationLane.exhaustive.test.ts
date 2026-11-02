import { describe, it, expect } from "vitest";
import {
  OperationLane,
  type LanePolicy,
  type OperationTicket,
  type TerminalOutcome,
} from "../src/core/operationLane";

/**
 * OperationLane の操作列の有界全列挙（docs/formal-methods-study.md §3・§4.1）。
 *
 * 実物の lane に深さ DEPTH までの全操作列を再生し、一手ごとに法則を確かめる。法則は lane の
 * コメントと docs/async-execution-model.md §4〜§5 から取る。法則が要る事実（出した要求・終わった
 * 要求・owner の世代）は横のゴーストが法則の言葉で持ち、lane の戻り値と比べる。モデルは書かない。
 * 法則ごとに最も短い反例を残すので、破れはそのまま呼び出しの列として読める。
 *
 * CI の深さは 5（方針ごとに 6,036 列）。§4.1 の 2 件の最短の反例が収まる。手元で深くするには
 * `LANE_DEPTH=7 npx vitest run __tests__/operationLane.exhaustive.test.ts`（方針ごとに 667,424 列）。
 */

const DEPTH = Number(process.env.LANE_DEPTH ?? 5);
const POLICIES: readonly LanePolicy[] = ["latest", "exhaust", "queue", "overlap"];

type Action =
  | { readonly kind: "begin" | "dispose" | "abortActive" }
  | { readonly kind: "claim" | "finalize" | "retry" | "canCommit"; readonly ticket: number };

interface Issued {
  readonly ticket: OperationTicket;
  readonly generation: number;
  signal: AbortSignal | undefined;
  claimed: boolean;
  finalized: boolean;
}

const show = (action: Action): string =>
  "ticket" in action ? `${action.kind}(${"ABCDEFGH"[action.ticket]})` : action.kind;

/** 深さ DEPTH までの全操作列（空列を除く）。ticket は、それまでの begin が出しうる数だけ指せる。 */
function* sequences(prefix: Action[] = [], tickets = 0): Generator<Action[]> {
  if (prefix.length > 0) yield prefix;
  if (prefix.length === DEPTH) return;
  const next: Action[] = [{ kind: "begin" }, { kind: "dispose" }, { kind: "abortActive" }];
  for (let ticket = 0; ticket < tickets; ticket++) {
    for (const kind of ["claim", "finalize", "retry", "canCommit"] as const) next.push({ kind, ticket });
  }
  for (const action of next) {
    yield* sequences([...prefix, action], tickets + (action.kind === "begin" ? 1 : 0));
  }
}

/** 列を再生し、最初に破れた法則を `[法則, 手数, 反例]` で返す。破れなければ null。 */
function firstViolation(
  Lane: typeof OperationLane,
  policy: LanePolicy,
  actions: readonly Action[],
): [law: string, steps: number, witness: string] | null {
  const lane = new Lane("check", policy, { withSignal: true });
  const issued: Issued[] = [];
  let generation = 0;
  const live = () => issued.filter((op) => op.generation === generation && !op.finalized);
  // 方針ごとの「まだ commit してよい要求」（async-execution-model §5）。dispose より前の要求は決して該当しない
  const mayCommit = (op: Issued): boolean => {
    if (op.generation !== generation || op.finalized) return false;
    switch (policy) {
      case "latest":
        return op === issued.at(-1); // 最新の要求だけ
      case "queue":
        return op === live()[0]; // 先着順の先頭
      case "exhaust":
        return op === live()[0]; // 受け入れた 1 件
      case "overlap":
        return true;
    }
  };
  for (const [step, action] of actions.entries()) {
    const fail = (law: string, detail: string): [string, number, string] =>
      [law, step + 1, `${law}: ${detail} — ${policy} [${actions.slice(0, step + 1).map(show).join(", ")}]`];
    if (action.kind === "begin") {
      const refuse = policy === "exhaust" && live().length > 0;
      const superseded = policy === "latest" ? live().at(-1) : undefined;
      const started = lane.begin();
      if ((started === null) !== refuse) {
        return fail("ExhaustAdmits", `begin が${started === null ? "断った" : "受け入れた"}`);
      }
      if (superseded?.signal !== undefined && !superseded.signal.aborted) {
        return fail("LatestAbortsSuperseded", "置き換えられた要求の signal が生きている");
      }
      if (started !== null) {
        issued.push({ ticket: started.ticket, generation, signal: started.attempt.signal, claimed: false, finalized: false });
      }
    } else if (action.kind === "dispose") {
      lane.disposeOwner();
      generation += 1;
      if (issued.some((op) => !op.finalized && op.signal !== undefined && !op.signal.aborted)) {
        return fail("DisposeAbortsAll", "dispose の後も生きている signal がある");
      }
    } else if (action.kind === "abortActive") {
      lane.abortActive();
      const active = policy === "overlap" ? live() : live().filter(mayCommit);
      if (active.some((op) => op.signal !== undefined && !op.signal.aborted)) {
        return fail("AbortActiveAborts", "abortActive の後も active な要求の signal が生きている");
      }
    } else {
      const op = issued[action.ticket];
      if (op === undefined) continue; // exhaust が断った begin の ticket は存在しない
      if (action.kind === "claim") {
        const expected = mayCommit(op) && !op.claimed;
        const won = lane.claimTerminal(op.ticket, "success");
        if (won !== expected) return fail("CommitOnlyWhenEligible", `claimTerminal が ${won}、法則は ${expected}`);
        if (won) op.claimed = true;
      } else if (action.kind === "canCommit") {
        const expected = mayCommit(op);
        const got = lane.canCommit(op.ticket);
        if (got !== expected) return fail("GuardAgrees", `canCommit が ${got}、法則は ${expected}`);
      } else if (action.kind === "retry") {
        const expected = mayCommit(op) && !op.claimed;
        const attempt = lane.retry(op.ticket);
        if ((attempt !== null) !== expected) {
          return fail("RetryOnlyWhilePending", `retry を${attempt === null ? "断った" : "与えた"}、法則は${expected ? "与える" : "断る"}`);
        }
        if (attempt !== null) op.signal = attempt.signal;
      } else {
        lane.finalize(op.ticket);
        if (op.generation === generation) op.finalized = true;
      }
    }
    if (lane.inFlightCount !== live().length) {
      return fail("InFlightCounts", `inFlightCount が ${lane.inFlightCount}、生きている要求は ${live().length}`);
    }
  }
  return null;
}

/** 方針ごとに全列を回し、破れた法則ごとの最短の反例を返す。 */
function shortestWitnesses(Lane: typeof OperationLane, policy: LanePolicy): Map<string, string> {
  const shortest = new Map<string, [number, string]>();
  for (const actions of sequences()) {
    const found = firstViolation(Lane, policy, actions);
    if (found === null) continue;
    const [law, steps, witness] = found;
    const known = shortest.get(law);
    if (known === undefined || steps < known[0]) shortest.set(law, [steps, witness]);
  }
  return new Map([...shortest].map(([law, [, witness]]) => [law, witness]));
}

describe("OperationLane — 操作列の有界全列挙", () => {
  for (const policy of POLICIES) {
    it(`${policy}: ${DEPTH} 手までのどの操作列でも法則を破らない`, () => {
      expect([...shortestWitnesses(OperationLane, policy).values()]).toEqual([]);
    });
  }
});

// 検出力: わざと壊した lane を、この検査が捕まえることを確かめる（docs/formal-methods-study.md §3-5）。
// 壊すのは試験の側のサブクラスだけで、src に切り替えは置かない。

class FinalizeLeavesSlot extends OperationLane {
  override finalize(): void {}
}

class GuardIgnoresPolicy extends OperationLane {
  override canCommit(ticket: OperationTicket): boolean {
    return ticket.ownerGeneration === this.ownerGeneration;
  }
}

class DisposeKeepsOwner extends OperationLane {
  override disposeOwner(): void {}
}

class ClaimsTwice extends OperationLane {
  private readonly _won = new Set<number>();
  override claimTerminal(ticket: OperationTicket, outcome: TerminalOutcome): boolean {
    if (this._won.has(ticket.operationId)) return true;
    const won = super.claimTerminal(ticket, outcome);
    if (won) this._won.add(ticket.operationId);
    return won;
  }
}

class RetriesAnything extends OperationLane {
  override retry(ticket: OperationTicket) {
    return super.retry(ticket) ?? { operationId: ticket.operationId, attempt: 2 };
  }
}

describe("OperationLane — 有界全列挙の検出力（わざと壊した lane）", () => {
  const broken: [string, typeof OperationLane, string][] = [
    ["finalize が枠を空けない", FinalizeLeavesSlot, "InFlightCounts"],
    ["canCommit が方針を見ない", GuardIgnoresPolicy, "GuardAgrees"],
    ["dispose が owner を進めない", DisposeKeepsOwner, "DisposeAbortsAll"],
    ["claim が 2 回通る", ClaimsTwice, "CommitOnlyWhenEligible"],
    ["retry を誰にでも与える", RetriesAnything, "RetryOnlyWhilePending"],
  ];
  for (const [name, Lane, law] of broken) {
    it(`${name}: ${law} が破れる`, () => {
      const laws = new Set(POLICIES.flatMap((policy) => [...shortestWitnesses(Lane, policy).keys()]));
      expect(laws).toContain(law);
    });
  }
});
