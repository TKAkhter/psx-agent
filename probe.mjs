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

function decodeSuperJSON(apiResponse) {
  // 1. Safely extract the inner data array from the nodes array
  const dataNode = apiResponse?.nodes?.find(node => node.type === "data" && node.data);
  const rawData = dataNode?.data;
  
  if (!rawData || !Array.isArray(rawData)) {
    console.error("Could not find the flat data array in your response.");
    return null;
  }

  // 2. Initialize identical structural layouts
  const resolved = rawData.map(item => {
    if (item && typeof item === 'object') {
      return Array.isArray(item) ? [] : {};
    }
    return item;
  });

  // Helper to trace indices back to their structural counterparts
  function resolveValue(val) {
    if (Number.isInteger(val) && val >= 0 && val < rawData.length) {
      const target = rawData[val];
      if (target && typeof target === 'object') {
        return resolved[val];
      }
      return target;
    }
    return val;
  }

  // 3. Rebuild relationships across references
  rawData.forEach((original, i) => {
    if (!original || typeof original !== 'object') return;

    if (Array.isArray(original)) {
      original.forEach(item => {
        resolved[i].push(resolveValue(item));
      });
    } else {
      Object.keys(original).forEach(key => {
        resolved[i][key] = resolveValue(original[key]);
      });
    }
  });

  // Position 0 holds your fully reassembled company data object
  return resolved[0];
}

// === RUN TEST ===
const result = decodeSuperJSON(raw);
console.log(JSON.stringify(result));

