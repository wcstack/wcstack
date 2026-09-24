#!/usr/bin/env bash
# The two targets only (warm create 1,000 / cold create 10,000), more rounds, with the DOM
# floor measured twice in the same session (before and after the engine rounds), so the
# ratio is not decided by one noisy floor sample.
#   OUT=docs/research/state-engine/targets ROUNDS=3 bash packages/state-next/bench/targets.sh
set -u
ROUNDS=${ROUNDS:-3}
OUT=${OUT:-docs/research/state-engine/targets}
mkdir -p "$OUT"
node packages/state-next/bench/dom-floor-cold.mjs --out "$OUT/dom-floor-a.json"
BUNDLES=${BUNDLES:-"current next"}
for r in $(seq 1 "$ROUNDS"); do
  for b in $BUNDLES; do
    case "$b" in
      next) f="$(pwd)/packages/state-next/dist/auto.min.js" ;;
      *) f="$(pwd)/packages/state/dist/auto.min.js" ;;
    esac
    echo "=== round $r $b ($(date +%H:%M:%S))"
    node scripts/audit-state-tech-warmth.mjs --bundle "$f" --raw --ops create1k,create10k --suffix "statenext-$b-r$r" 2>&1 | tail -2 | cut -c1-110
  done
done
mv docs/research/state-next/warm-vs-cold-file-manual-plain-jsfb-statenext-*.json "$OUT/" 2>/dev/null
node packages/state-next/bench/dom-floor-cold.mjs --out "$OUT/dom-floor-b.json"
node -e '
const fs=require("fs"),d=process.argv[1];
const med=(xs)=>{const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const pool={};
for (const f of fs.readdirSync(d)) { const m=f.match(/statenext-(\w+)-r\d+\.json$/); if(!m) continue;
  for (const r of JSON.parse(fs.readFileSync(d+"/"+f)).results) { (pool[m[1]+" "+r.op+" cold"] ??= []).push(...r.cold.samples); (pool[m[1]+" "+r.op+" warm"] ??= []).push(...r.warm.samples); } }
const fa=JSON.parse(fs.readFileSync(d+"/dom-floor-a.json")), fb=JSON.parse(fs.readFileSync(d+"/dom-floor-b.json"));
const floor={ w1k: med([...fa.create1000.warmSamples,...fb.create1000.warmSamples]), c10k: med([...fa.create10000.coldSamples,...fb.create10000.coldSamples]) };
const out={ floor };
for (const b of new Set(Object.keys(pool).map((k)=>k.split(" ")[0]))) {
  const w1k=med(pool[b+" create1k warm"]), c10k=med(pool[b+" create10k cold"]);
  out[b]={ w1k, c10k, ratioW1k:+(w1k/floor.w1k).toFixed(2), ratioC10k:+(c10k/floor.c10k).toFixed(2), n: pool[b+" create10k cold"].length };
}
console.log(JSON.stringify(out)); fs.writeFileSync(d+"/targets.json", JSON.stringify(out,null,2));' "$OUT"
