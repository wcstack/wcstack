#!/usr/bin/env bash
# One measurement session: the current engine twice (current / currentB — their difference
# is the A/A noise floor) and state-next, alternating bundles within each round, then the
# DOM floor (cold and warm) in the same session, then the summary (ratios and size).
# Run from the repository root with nothing else running, after `npm run build` in
# packages/state-next:
#   OUT=docs/research/state-engine/stage-1 ROUNDS=2 bash packages/state-next/bench/run-all.sh
set -u
ROUNDS=${ROUNDS:-2}
OUT=${OUT:-docs/research/state-engine/bench}
BUNDLES=${BUNDLES:-"current next currentB"}
mkdir -p "$OUT"
bundle_path() {
  case "$1" in
    current|currentB) echo "$(pwd)/packages/state/dist/auto.min.js" ;;
    next) echo "$(pwd)/packages/state-next/dist/auto.min.js" ;;
    *) echo "unknown bundle $1" >&2; exit 1 ;;
  esac
}
for r in $(seq 1 "$ROUNDS"); do
  for b in $BUNDLES; do
    f=$(bundle_path "$b")
    echo "=== round $r $b ($(date +%H:%M:%S))"
    (cd e2e && node bench/jsfb-verify.mjs --label "$b-r$r" --bundle "$f" --out "../$OUT/jsfb-$b-r$r.json" 2>&1 | grep -E "keyed\"|create1k|replace1k|update10k|select1k|swap1k|remove1k|append|clear")
    node scripts/audit-state-tech-warmth.mjs --bundle "$f" --raw --ops create1k,create10k,append1k,clear10k --suffix "statenext-$b-r$r" 2>&1 | tail -4 | cut -c1-110
    for v in tracked eqIndex; do
      node packages/state-next/bench/select10k.mjs --bundle "$f" --variant "$v" --label "$b-r$r" --out "$OUT/select-$b-$v-r$r.json" 2>&1 | tail -1
    done
  done
done
mv docs/research/state-next/warm-vs-cold-file-manual-plain-jsfb-statenext-*.json "$OUT/" 2>/dev/null
echo "=== DOM floor ($(date +%H:%M:%S))"
node packages/state-next/bench/dom-floor-cold.mjs --out "$OUT/dom-floor-cold-warm.json"
node packages/state-next/bench/summarize.mjs "$OUT"
echo "=== done ($(date +%H:%M:%S))"
