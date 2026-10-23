// CSV stock import worker (module worker, spawned by <wcs-worker src="/csv-worker.js">).
// in:  { type: "parse", text, job } | "ping"
// out: "ready" once on start; "pong" for each ping (the same string every time);
//      { type: "progress", job, done, total } … then { type: "rows", job, rows: [{ sku, stock }], errors: [{ line, message }] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
self.postMessage("ready");
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg === "ping") { self.postMessage("pong"); return; }
  if (msg?.type !== "parse") { self.postMessage({ type: "error", message: "unknown message", got: typeof msg }); return; }
  const lines = String(msg.text).split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() || "").split(",").map((h) => h.trim().toLowerCase());
  const iSku = header.indexOf("sku");
  const iStock = header.indexOf("stock");
  const rows = [];
  const errors = [];
  if (iSku < 0 || iStock < 0) {
    self.postMessage({ type: "rows", job: msg.job, rows, errors: [{ line: 1, message: "header must have sku,stock" }] });
    return;
  }
  const total = lines.length;
  const CHUNK = Math.max(1, Math.ceil(total / 5));
  for (let i = 0; i < total; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const stock = Number(cells[iStock]);
    if (!cells[iSku]) errors.push({ line: i + 2, message: "sku missing" });
    else if (!Number.isInteger(stock) || stock < 0) errors.push({ line: i + 2, message: `bad stock "${cells[iStock]}"` });
    else rows.push({ sku: cells[iSku], stock });
    if ((i + 1) % CHUNK === 0 || i + 1 === total) {
      self.postMessage({ type: "progress", job: msg.job, done: i + 1, total });
      await sleep(40);
    }
  }
  self.postMessage({ type: "rows", job: msg.job, rows, errors });
};
