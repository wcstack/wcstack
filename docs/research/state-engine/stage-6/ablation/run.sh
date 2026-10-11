#!/usr/bin/env bash
# ROUNDS rounds of VARIANTS (files $DIR/<v>.min.js), cold create10k + warm create1k, pooled.
set -u
SP=/c/Users/kikuzawa/AppData/Local/Temp/claude/c--Users-kikuzawa-Documents-git-wcstack-wcstack/8c6fa94d-b053-442c-a9bb-82439d87b652/scratchpad
DIR=${DIR:-$SP/abl}
OUT=${OUT:-$DIR/out}
ROUNDS=${ROUNDS:-2}
mkdir -p "$OUT"
for r in $(seq 1 "$ROUNDS"); do
  for v in $VARIANTS; do
    echo "=== round $r $v ($(date +%H:%M:%S))"
    node scripts/audit-state-tech-warmth.mjs --bundle "$DIR/$v.min.js" --raw --ops create1k,create10k --suffix "abl-$v-r$r" 2>&1 | tail -2 | cut -c1-100
  done
done
mv docs/research/state-next/warm-vs-cold-file-manual-plain-jsfb-abl-*.json "$OUT/"
node -e '
const fs=require("fs"),d=process.argv[1];
const med=(xs)=>{const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const pool={};
for (const f of fs.readdirSync(d)) { const m=f.match(/abl-([\w.]+)-r\d+\.json$/); if(!m) continue;
  for (const r of JSON.parse(fs.readFileSync(d+"/"+f)).results) { (pool[m[1]+" "+r.op+" cold"] ??= []).push(...r.cold.samples); (pool[m[1]+" "+r.op+" warm"] ??= []).push(...r.warm.samples); } }
for (const v of new Set(Object.keys(pool).map((k)=>k.split(" ")[0]))) console.log(v.padEnd(12), "w1k", med(pool[v+" create1k warm"]).toFixed(2), " c10k", med(pool[v+" create10k cold"]).toFixed(1), " n", pool[v+" create10k cold"].length);' "$OUT"
