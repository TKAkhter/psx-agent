// save as probe.mjs, run with: node probe.mjs
import axios from "axios";

const symbol = "MEBL";
const url = `https://psxterminal.com/symbol/${symbol}/__data.json?market=REG`;

const { data: raw } = await axios.get(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://psxterminal.com/",
  }
});

// resolve the sveltekit node graph
const arr = raw.nodes.find(n => n.type === "data" && Array.isArray(n.data))?.data;

function resolve(idx, memo = new Map()) {
  if (memo.has(idx)) return memo.get(idx);
  const val = arr[idx];
  if (val === null || typeof val !== "object") { memo.set(idx, val); return val; }
  if (Array.isArray(val)) {
    const a = []; memo.set(idx, a);
    for (const i of val) a.push(typeof i === "number" ? resolve(i, memo) : i);
    return a;
  }
  const o = {}; memo.set(idx, o);
  for (const [k, v] of Object.entries(val))
    o[k] = typeof v === "number" ? resolve(v, memo) : v;
  return o;
}

const resolved = resolve(0);
console.log("TOP LEVEL KEYS:", Object.keys(resolved));
for (const [k, v] of Object.entries(resolved)) {
  const preview = JSON.stringify(v)?.slice(0, 200);
  console.log(`\n--- ${k} ---\n${preview}`);
}

const mebl = resolved.marketData?.instruments?.REG?.MEBL;
console.log("\n--- MEBL full tick ---\n", JSON.stringify(mebl, null, 2));