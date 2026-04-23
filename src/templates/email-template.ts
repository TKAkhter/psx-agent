import { ENV } from "../config";
import {
  TradeSignalMap,
  PortfolioSummary,
  Signal,
  TradeSignal,
} from "../signals";
import { StockDataMap, StockData } from "../fetch-data";
import { GeminiInsight, ValidationEntry } from "../gemini";
import { PerformanceResult } from "../performance";

// ─────────────────────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────────────────────

interface Theme {
  page: string;
  card: string;
  hdr: string;
  sub: string;
  deep: string;
  bdr: string;
  txt: string;
  txtS: string;
  txtM: string;
  txtD: string;
  txtF: string;
  green: string;
  red: string;
  amber: string;
  blue: string;
  purple: string;
}

const THEMES: Record<string, Theme> = {
  dark: {
    page: "#07101a",
    card: "#0c1a2e",
    hdr: "#071120",
    sub: "#0a1520",
    deep: "#060f1a",
    bdr: "#1e3347",
    txt: "#f1f5f9",
    txtS: "#cbd5e1",
    txtM: "#94a3b8",
    txtD: "#64748b",
    txtF: "#334155",
    green: "#22c55e",
    red: "#f87171",
    amber: "#fbbf24",
    blue: "#60a5fa",
    purple: "#a78bfa",
  },
  light: {
    page: "#f0f4f8",
    card: "#ffffff",
    hdr: "#f8fafc",
    sub: "#f1f5f9",
    deep: "#e2e8f0",
    bdr: "#cbd5e1",
    txt: "#0f172a",
    txtS: "#1e293b",
    txtM: "#334155",
    txtD: "#64748b",
    txtF: "#94a3b8",
    green: "#16a34a",
    red: "#dc2626",
    amber: "#d97706",
    blue: "#2563eb",
    purple: "#7c3aed",
  },
};

const T = THEMES[ENV.EMAIL_THEME] ?? THEMES.dark;

// ─────────────────────────────────────────────────────────────
//  MINI HELPERS
// ─────────────────────────────────────────────────────────────

const esc = (v: unknown): string =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const sgn = (n: number | null | undefined): string =>
  n == null ? "" : n >= 0 ? "+" : "";
const pC = (n: number | null | undefined): string =>
  n == null ? T.txtM : n >= 0 ? T.green : T.red;
const TREND_C: Record<string, string> = {
  STRONG_BULL: T.green,
  BULL: T.green,
  SIDEWAYS: T.amber,
  BEAR: T.red,
  STRONG_BEAR: T.red,
};
const ACT: Record<string, { c: string; label: string }> = {
  STRONG_BUY: { c: T.green, label: "▲▲ STRONG BUY" },
  BUY: { c: T.green, label: "▲ BUY" },
  HOLD: { c: T.amber, label: "● HOLD" },
  SELL: { c: T.red, label: "▼ SELL" },
  STRONG_SELL: { c: T.red, label: "▼▼ STRONG SELL" },
  SKIP: { c: T.txtD, label: "— N/A" },
};
const CONF_C: Record<string, string> = {
  "Very High": T.purple,
  High: T.blue,
  Medium: T.amber,
  Low: T.txtD,
};

const pill = (text: string, color: string) =>
  `<span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;background:${color}22;color:${color};border:1px solid ${color}44;">${esc(
    text
  )}</span>`;

// RSI meter bar
const rsiBar = (rsi: number | null): string => {
  if (rsi == null) return "";
  const c = rsi < 30 ? T.green : rsi > 70 ? T.red : T.amber;
  const z =
    rsi < 20
      ? "Extreme OS"
      : rsi < 30
      ? "Oversold"
      : rsi < 45
      ? "Mild OS"
      : rsi > 80
      ? "Extreme OB"
      : rsi > 70
      ? "Overbought"
      : rsi > 55
      ? "Mild OB"
      : "Neutral";
  const w = Math.max(0, Math.min(100, rsi));
  return `<div style="margin-bottom:6px;">
  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
    <span style="color:${T.txtM};font-weight:600;">RSI-14 <b style="color:${c};">${rsi}</b></span>
    <span style="font-size:10px;color:${c};font-weight:600;">${z}</span>
  </div>
  <div style="height:6px;background:${T.sub};border-radius:4px;overflow:hidden;position:relative;">
    <div style="position:absolute;left:30%;width:1px;height:100%;background:${T.bdr};"></div>
    <div style="position:absolute;left:70%;width:1px;height:100%;background:${T.bdr};"></div>
    <div style="width:${w}%;height:100%;background:${c};border-radius:4px;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:9px;color:${T.txtF};margin-top:1px;"><span>0</span><span>30</span><span>70</span><span>100</span></div>
</div>`;
};

// Generic progress bar (MFI)
const meterBar = (
  label: string,
  val: number | null,
  loColor: string,
  hiColor: string
): string => {
  if (val == null) return "";
  const c = val < 30 ? loColor : val > 70 ? hiColor : T.amber;
  const w = Math.max(0, Math.min(100, val));
  return `<div style="margin-bottom:5px;">
  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
    <span style="color:${T.txtM};font-weight:600;">${label} <b style="color:${c};">${val}</b></span>
  </div>
  <div style="height:5px;background:${T.sub};border-radius:3px;overflow:hidden;">
    <div style="width:${w}%;height:100%;background:${c};border-radius:3px;"></div>
  </div>
</div>`;
};

// ─────────────────────────────────────────────────────────────
//  SECTION LABEL  (reused for both algo + AI sections)
// ─────────────────────────────────────────────────────────────

const sectionLabel = (icon: string, title: string, color: string) =>
  `<div style="background:${color}15;border-left:4px solid ${color};padding:6px 12px;border-radius:0 6px 6px 0;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:1px;">${icon} ${title}</span>
  </div>`;

// ─────────────────────────────────────────────────────────────
//  STOCK CARD  (two-section: 📊 Algo Numbers | 🤖 AI Feedback)
// ─────────────────────────────────────────────────────────────

function buildStockCard(
  sym: string,
  sig: TradeSignal,
  rawData: StockData | undefined,
  gv: ValidationEntry | undefined
): string {
  if (sig.action === "SKIP") return "";
  const cfg = ACT[sig.action] ?? ACT.HOLD;
  const isBuy = sig.action === "BUY" || sig.action === "STRONG_BUY";
  const isSell = sig.action === "SELL" || sig.action === "STRONG_SELL";
  const gvc = gv
    ? { Agree: T.green, Disagree: T.red, Partial: T.amber }[gv.verdict] ??
      T.txtM
    : null;

  const bullRows = sig.bullReasons
    .slice(0, 5)
    .map(
      (r) =>
        `<div style="padding:1px 0;font-size:11px;color:${T.green};">✓ ${esc(
          r
        )}</div>`
    )
    .join("");
  const bearRows = sig.bearReasons
    .slice(0, 5)
    .map(
      (r) =>
        `<div style="padding:1px 0;font-size:11px;color:${T.red};">✗ ${esc(
          r
        )}</div>`
    )
    .join("");
  const neutralRows = sig.neutralNotes
    .slice(0, 2)
    .map(
      (r) =>
        `<div style="padding:1px 0;font-size:11px;color:${T.txtD};">◦ ${esc(
          r
        )}</div>`
    )
    .join("");

  const patPills = sig.patterns
    .map((p) =>
      pill(
        p.name,
        p.bias === "BULLISH" ? T.green : p.bias === "BEARISH" ? T.red : T.amber
      )
    )
    .join(" ");

  const maRow = (
    [
      ["MA5", sig.ma5],
      ["MA10", sig.ma10],
      ["MA20", sig.ma20],
      ["MA50", sig.ma50],
      ["MA200", sig.ma200],
      ["EMA9", sig.ema9],
      ["EMA21", sig.ema21],
    ] as [string, number | null][]
  )
    .filter(([, v]) => v != null)
    .map(
      ([l, v]) =>
        `<span style="margin-right:9px;font-size:11px;"><span style="color:${
          T.txtD
        };">${l} </span><span style="color:${
          sig.price >= v! ? T.green : T.red
        };font-weight:600;">${v}</span></span>`
    )
    .join("");

  const pivotRow = sig.pivots
    ? (
        [
          ["R2", sig.pivots.r2, T.red],
          ["R1", sig.pivots.r1, "#fca5a5"],
          ["Pvt", sig.pivots.pivot, T.txtM],
          ["S1", sig.pivots.s1, "#86efac"],
          ["S2", sig.pivots.s2, T.green],
        ] as [string, number, string][]
      )
        .filter(([, v]) => v != null)
        .map(
          ([l, v, c]) =>
            `<span style="margin-right:8px;font-size:11px;color:${c};"><span style="color:${T.txtD};">${l} </span>${v}</span>`
        )
        .join("")
    : "";

  const gainAmt =
    isBuy || isSell
      ? Math.round(
          Math.abs(((sig.targetPrice ?? 0) - (sig.limitPrice ?? 0)) * sig.qty)
        )
      : 0;
  const riskAmt =
    isBuy || isSell
      ? Math.round(
          Math.abs(((sig.limitPrice ?? 0) - (sig.stopLoss ?? 0)) * sig.qty)
        )
      : 0;

  const stBadge = sig.superTrend
    ? `<span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:800;background:${
        sig.superTrend.isBull ? T.green : T.red
      }20;color:${sig.superTrend.isBull ? T.green : T.red};border:1px solid ${
        sig.superTrend.isBull ? T.green : T.red
      }44;">${sig.superTrend.isBull ? "▲" : "▼"} ST ${
        sig.superTrend.signal
      } @ ${sig.superTrend.value}</span>`
    : "";

  return `
<div style="background:${T.card};border:1px solid ${
    T.bdr
  };border-left:5px solid ${
    cfg.c
  };border-radius:14px;margin-bottom:18px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;">

  <!-- ── HEADER ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${
    T.hdr
  };border-bottom:1px solid ${T.bdr};">
    <tr>
      <td style="padding:12px 16px;">
        <span style="font-size:20px;font-weight:900;color:${T.txt};">${esc(
    sym
  )}</span>
        <span style="font-size:11px;color:${
          T.txtD
        };margin-left:8px;padding:2px 8px;background:${
    T.sub
  };border-radius:99px;">${esc(rawData?.sector ?? "")}</span>
        <div style="font-size:11px;color:${T.txtD};margin-top:2px;">${esc(
    rawData?.name ?? ""
  )}</div>
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:top;">
        ${pill(cfg.label, cfg.c)}
        <div style="margin-top:4px;">
          <span style="font-size:10px;color:${
            CONF_C[sig.confidence] ?? T.txtD
          };font-weight:700;">${esc(sig.confidence)}</span>
          <span style="font-size:10px;color:${T.txtD};margin-left:5px;">(${
    sig.score >= 0 ? "+" : ""
  }${sig.score})</span>
        </div>
        <div style="margin-top:4px;">${stBadge}</div>
      </td>
    </tr>
  </table>

  <!-- ── PRICE + P&L ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${
    T.bdr
  };">
    <tr>
      <td style="padding:12px 16px;">
        <div style="font-size:26px;font-weight:900;color:${
          T.txt
        };letter-spacing:-1px;">
          PKR ${esc(sig.price)}
          ${
            sig.changePct != null
              ? `<span style="font-size:13px;font-weight:700;color:${pC(
                  sig.changePct
                )};margin-left:8px;">${sgn(sig.changePct)}${esc(
                  sig.changePct
                )}%</span>`
              : ""
          }
        </div>
        <div style="font-size:11px;color:${T.txtD};margin-top:2px;">O:<b>${esc(
    sig.open
  )}</b> &nbsp;H:<b style="color:${T.green};">${esc(
    sig.high
  )}</b> &nbsp;L:<b style="color:${T.red};">${esc(sig.low)}</b>${
    sig.bid != null
      ? `&nbsp;·&nbsp;Bid:${esc(sig.bid)} Ask:${esc(sig.ask)}`
      : ""
  }</div>
        <div style="font-size:11px;color:${T.txtD};margin-top:2px;">
          Avg cost: <b style="color:${T.txtM};">PKR ${esc(
    sig.avgCost
  )}</b> &nbsp;·&nbsp;
          ${esc(sig.shares.toLocaleString())} shares &nbsp;·&nbsp;
          Value: <b style="color:${T.txtM};">PKR ${(
    sig.marketValue ?? 0
  ).toLocaleString()}</b>
        </div>
        ${
          rawData?.fundamentals?.peRatio != null
            ? `<div style="font-size:11px;color:${
                T.txtD
              };margin-top:2px;">P/E: <b>${
                rawData.fundamentals.peRatio
              }x</b> &nbsp;·&nbsp; Div: <b style="color:${T.green};">${
                rawData.fundamentals.dividendYield
              }%</b>${
                rawData.fundamentals.marketCap
                  ? ` &nbsp;·&nbsp; Cap: ${rawData.fundamentals.marketCap}`
                  : ""
              }</div>`
            : ""
        }
      </td>
      <td style="padding:12px 16px;text-align:right;vertical-align:middle;">
        <div style="font-size:22px;font-weight:900;color:${pC(
          sig.unrealizedPct
        )};">${sgn(sig.unrealizedPct)}${esc(sig.unrealizedPct)}%</div>
        <div style="font-size:13px;font-weight:700;color:${pC(
          sig.unrealizedPnl
        )};">${sgn(sig.unrealizedPnl)}PKR ${(
    sig.unrealizedPnl ?? 0
  ).toLocaleString()}</div>
        <div style="font-size:10px;color:${
          T.txtD
        };margin-top:2px;">Unrealised P&amp;L</div>
      </td>
    </tr>
  </table>

  <!-- ── SPARKLINE + PERFORMANCE ── -->
  <div style="padding:7px 16px;border-bottom:1px solid ${T.bdr};background:${
    T.sub
  };">
    ${
      sig.sparkline
        ? `<div style="font-family:monospace;font-size:14px;color:${pC(
            sig.perf1d
          )};letter-spacing:1px;margin-bottom:4px;">${esc(
            sig.sparkline
          )} <span style="font-size:10px;color:${T.txtD};">20-day</span></div>`
        : ""
    }
    <div style="display:flex;gap:14px;font-size:11px;flex-wrap:wrap;">
      ${(
        [
          ["1D", sig.perf1d],
          ["1W", sig.perf1w],
          ["1M", sig.perf1m],
          ["6M", sig.perf6m],
        ] as [string, number | null][]
      )
        .map(
          ([l, v]) =>
            `<span><span style="color:${
              T.txtD
            };">${l}</span> <span style="color:${pC(v)};font-weight:700;">${sgn(
              v
            )}${esc(v)}%</span></span>`
        )
        .join("")}
      <span style="margin-left:auto;"><span style="color:${
        T.txtD
      };">MaxDD</span> <span style="color:${T.red};">${esc(
    sig.maxDrawdown
  )}%</span></span>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!--  SECTION 1: 📊 ALGO ANALYSIS NUMBERS                  -->
  <!-- ══════════════════════════════════════════════════════ -->
  <div style="padding:10px 16px;border-bottom:1px solid ${T.bdr};">
    ${sectionLabel("📊", "Algo Analysis", T.blue)}
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0;width:50%;vertical-align:top;padding-right:10px;border-right:1px solid ${
          T.bdr
        };">
          <div style="font-size:9px;color:${
            T.txtD
          };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Momentum Oscillators</div>
          ${rsiBar(sig.rsi14)}
          ${meterBar("MFI-14", sig.mfi, T.green, T.red)}
          <div style="font-size:11px;margin-bottom:3px;">
            <span style="color:${T.txtD};">ROC-12: </span>
            <span style="color:${
              sig.roc != null ? (sig.roc >= 0 ? T.green : T.red) : T.txtM
            };font-weight:600;">${
    sig.roc != null ? sgn(sig.roc) + sig.roc + "%" : "—"
  }</span>
          </div>
          <div style="font-size:11px;margin-bottom:3px;">
            <span style="color:${T.txtD};">Stoch: </span>
            <span style="color:${
              sig.stoch?.zone === "OVERSOLD"
                ? T.green
                : sig.stoch?.zone === "OVERBOUGHT"
                ? T.red
                : T.txtM
            };font-weight:600;">${esc(sig.stoch?.k)}/${esc(sig.stoch?.d)}</span>
            <span style="color:${T.txtD};font-size:10px;"> (${esc(
    sig.stoch?.zone
  )})</span>
          </div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">Williams %R: </span><span style="color:${
    sig.willR != null
      ? sig.willR < -80
        ? T.green
        : sig.willR > -20
        ? T.red
        : T.txtM
      : T.txtM
  };">${esc(sig.willR)}</span></div>
          <div style="font-size:11px;"><span style="color:${
            T.txtD
          };">CCI: </span><span style="color:${
    sig.cci != null
      ? sig.cci < -100
        ? T.green
        : sig.cci > 100
        ? T.red
        : T.txtM
      : T.txtM
  };">${esc(sig.cci)}</span></div>
        </td>
        <td style="padding:0;vertical-align:top;padding-left:10px;">
          <div style="font-size:9px;color:${
            T.txtD
          };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Trend & Flow</div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">Trend: </span><span style="color:${
    TREND_C[sig.trend] ?? T.txtM
  };font-weight:700;">${esc(sig.trend)}</span></div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">ADX: </span><span style="color:${
    sig.adx?.strength?.includes("BULL")
      ? T.green
      : sig.adx?.strength?.includes("BEAR")
      ? T.red
      : T.txtM
  };">${esc(sig.adx?.adx)} (${esc(sig.adx?.strength)})</span></div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">MACD: </span><span style="color:${
    sig.macd?.crossover === "BULLISH_CROSS"
      ? T.green
      : sig.macd?.crossover === "BEARISH_CROSS"
      ? T.red
      : sig.macd?.histogram != null && sig.macd.histogram > 0
      ? T.green
      : T.red
  };">${esc(sig.macd?.crossover ?? sig.macd?.histTrend)}</span></div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">Ichimoku: </span><span style="color:${
    sig.ichi?.position === "ABOVE_CLOUD"
      ? T.green
      : sig.ichi?.position === "BELOW_CLOUD"
      ? T.red
      : T.amber
  };">${esc(sig.ichi?.position ?? "—")}</span></div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">OBV: </span><span style="color:${
    sig.obv?.trend === "ACCUMULATION"
      ? T.green
      : sig.obv?.trend === "DISTRIBUTION"
      ? T.red
      : T.txtM
  };">${esc(sig.obv?.trend)}</span></div>
          <div style="font-size:11px;margin-bottom:3px;"><span style="color:${
            T.txtD
          };">VWAP: </span><span>PKR ${esc(
    sig.vwap
  )}</span> <span style="color:${
    sig.price < (sig.vwap ?? Infinity) ? T.green : T.red
  };font-size:10px;">(${
    sig.price < (sig.vwap ?? 0) ? "below" : "above"
  })</span></div>
          <div style="font-size:11px;"><span style="color:${
            T.txtD
          };">Vol: </span><span style="color:${
    sig.vol?.volSpike ? T.amber : T.txtM
  };">${esc(sig.vol?.volRatio)}x</span> <span style="color:${T.txtD};">(${esc(
    sig.vol?.volTrend
  )})</span></div>
          ${
            sig.divergence
              ? `<div style="margin-top:4px;">${pill(
                  sig.divergence.replace(/_/g, " "),
                  sig.divergence.includes("BULLISH") ? T.green : T.red
                )}</div>`
              : ""
          }
          ${
            sig.bb?.squeeze
              ? `<div style="margin-top:4px;">${pill(
                  "BB SQUEEZE ⚡",
                  T.amber
                )}</div>`
              : ""
          }
        </td>
      </tr>
    </table>

    <!-- Moving averages -->
    <div style="margin-top:8px;padding-top:7px;border-top:1px solid ${T.bdr};">
      <span style="font-size:9px;color:${
        T.txtD
      };text-transform:uppercase;letter-spacing:.5px;font-weight:700;">MAs: </span>${maRow}
    </div>

    <!-- Pivot levels -->
    ${
      pivotRow
        ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid ${T.bdr};">
      <span style="font-size:9px;color:${T.txtD};text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Pivots: </span>${pivotRow}</div>`
        : ""
    }

    <!-- Bull / Bear reasons -->
    ${
      bullRows || bearRows || neutralRows
        ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid ${
            T.bdr
          };">${bullRows}${bearRows}${neutralRows}${
            patPills ? `<div style="margin-top:4px;">${patPills}</div>` : ""
          }</div>`
        : ""
    }

    <!-- Dividends -->
    ${
      rawData?.dividends?.length
        ? `<div style="margin-top:6px;font-size:11px;color:${
            T.txtD
          };">Dividends: ${rawData.dividends
            .map(
              (d) =>
                `<span style="color:${T.green};">PKR ${d.amount} (ex ${d.exDate})</span>`
            )
            .join(" &nbsp;·&nbsp; ")}</div>`
        : ""
    }
  </div>

  <!-- ── TRADE INSTRUCTION ── -->
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    <div style="background:${cfg.c}10;border-left:4px solid ${
    cfg.c
  };border-radius:8px;padding:11px 13px;">
      <div style="font-size:10px;font-weight:800;color:${
        cfg.c
      };text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📋 Trade Instruction</div>
      <div style="font-size:15px;font-weight:700;color:${T.txt};">${esc(
    sig.instruction
  )}</div>
      ${
        (isBuy || isSell) && sig.targetPrice != null
          ? `
      <table style="margin-top:9px;width:100%;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:${
            T.green
          };padding-right:14px;">🎯 Target: <b>PKR ${esc(
              sig.targetPrice
            )}</b></td>
          <td style="font-size:12px;color:${
            T.red
          };padding-right:14px;">🛑 Stop: <b>PKR ${esc(sig.stopLoss)}</b></td>
          <td style="font-size:12px;color:${T.purple};">⚖️ R/R: <b>1:${esc(
              sig.rrRatio
            )}</b></td>
        </tr>
        <tr>
          <td colspan="3" style="padding-top:5px;font-size:11px;color:${
            T.txtD
          };">
            Potential gain: <b style="color:${
              T.green
            };">PKR ${gainAmt.toLocaleString()}</b> &nbsp;·&nbsp; Max risk: <b style="color:${
              T.red
            };">PKR ${riskAmt.toLocaleString()}</b>
          </td>
        </tr>
      </table>`
          : ""
      }
    </div>
    <!-- Beginner note -->
    <div style="margin-top:7px;padding:8px 12px;background:${
      T.sub
    };border-radius:7px;border-left:3px solid ${T.blue};">
      <div style="font-size:10px;color:${
        T.blue
      };font-weight:700;margin-bottom:2px;">📗 SIMPLE EXPLANATION</div>
      <div style="font-size:12px;color:${T.txtS};line-height:1.6;">${esc(
    sig.beginnerNote
  )}</div>
    </div>
    <!-- Pro summary -->
    <div style="margin-top:4px;font-size:10px;color:${
      T.txtD
    };font-style:italic;padding:2px 4px;">${esc(sig.proSummary)}</div>
  </div>

  <!-- ══════════════════════════════════════════════════════ -->
  <!--  SECTION 2: 🤖 AI FEEDBACK (Gemini)                  -->
  <!-- ══════════════════════════════════════════════════════ -->
  ${
    gv
      ? `
  <div style="padding:10px 16px;background:${T.deep};">
    ${sectionLabel("🤖", "Gemini AI Feedback", T.purple)}
    <div style="font-size:11px;margin-bottom:5px;">
      <span style="color:${gvc};font-weight:800;">${esc(gv.verdict)}</span>
      <span style="color:${T.txtD};margin-left:8px;">· ${esc(
          gv.conviction
        )} conviction · ${esc(gv.time_horizon)}</span>
    </div>
    <div style="font-size:11px;color:${
      T.txtS
    };line-height:1.6;margin-bottom:5px;">${esc(gv.analyst_note)}</div>
    ${
      gv.entry_zone
        ? `<div style="font-size:11px;margin-bottom:4px;">Entry zone: <b style="color:${
            T.green
          };">PKR ${esc(
            gv.entry_zone
          )}</b> &nbsp;·&nbsp; Exit zone: <b style="color:${
            T.amber
          };">PKR ${esc(gv.exit_zone ?? "—")}</b></div>`
        : ""
    }
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;margin-bottom:5px;">
      ${
        gv.key_catalyst
          ? `<div style="color:${T.green};">⚡ ${esc(gv.key_catalyst)}</div>`
          : ""
      }
      ${
        gv.key_risk
          ? `<div style="color:${T.red};">⚠️ ${esc(gv.key_risk)}</div>`
          : ""
      }
    </div>
    ${
      gv.alt_action
        ? `<div style="font-size:11px;color:${T.amber};">↳ Alt: ${esc(
            gv.alt_action
          )}${gv.alt_price ? ` @ PKR ${esc(gv.alt_price)}` : ""}</div>`
        : ""
    }
    <!-- Gemini beginner coach -->
    <div style="margin-top:6px;padding:7px 10px;background:${
      T.sub
    };border-radius:6px;border-left:3px solid ${T.purple};">
      <div style="font-size:10px;color:${
        T.purple
      };font-weight:700;margin-bottom:2px;">🎓 AI Coach</div>
      <div style="font-size:12px;color:${T.txtS};line-height:1.5;">${esc(
          gv.beginner_explanation
        )}</div>
    </div>
  </div>`
      : ""
  }

</div>`;
}

// ─────────────────────────────────────────────────────────────
//  WEEKLY REVIEW BLOCK
// ─────────────────────────────────────────────────────────────

function weeklyBlock(weekly: GeminiInsight["weekly"]): string {
  if (!weekly || weekly.raw) return "";
  const gradeColor =
    (
      { A: T.green, B: T.green, C: T.amber, D: T.red } as Record<string, string>
    )[weekly.portfolioGrade?.[0] ?? ""] ?? T.txtM;
  return `
<div style="background:${T.card};border:1px solid ${
    T.purple
  }55;border-left:5px solid ${
    T.purple
  };border-radius:14px;margin-bottom:18px;overflow:hidden;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${
    T.hdr
  };border-bottom:1px solid ${T.bdr};">
    <tr>
      <td style="padding:12px 16px;"><span style="font-size:13px;font-weight:900;color:${
        T.purple
      };">📅 WEEKLY STRATEGIC REVIEW (AI)</span></td>
      ${
        weekly.portfolioGrade
          ? `<td style="padding:12px 16px;text-align:right;"><span style="font-size:24px;font-weight:900;color:${gradeColor};">${esc(
              weekly.portfolioGrade
            )}</span></td>`
          : ""
      }
    </tr>
  </table>
  ${
    weekly.weeklyOutlook
      ? `<div style="padding:12px 16px;border-bottom:1px solid ${
          T.bdr
        };font-size:13px;color:${T.txtS};line-height:1.6;">${esc(
          weekly.weeklyOutlook
        )}</div>`
      : ""
  }
  ${
    weekly.positionsToWatch?.length
      ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    <div style="font-size:10px;color:${
      T.txtD
    };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Positions to Watch</div>
    ${weekly.positionsToWatch
      .map(
        (p) => `
    <div style="margin-bottom:6px;padding:7px 10px;background:${
      T.sub
    };border-radius:7px;">
      <b style="color:${T.txt};font-size:12px;">${esc(p.sym)}</b>
      <span style="font-size:11px;color:${T.txtM};margin-left:8px;">${esc(
          p.reason
        )}</span>
      ${
        p.upcomingCatalyst
          ? `<div style="font-size:11px;color:${
              T.amber
            };margin-top:2px;">📌 ${esc(p.upcomingCatalyst)}</div>`
          : ""
      }
    </div>`
      )
      .join("")}
  </div>`
      : ""
  }
  <div style="padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;">
    ${
      weekly.rebalanceAdvice
        ? `<div style="flex:1;min-width:200px;padding:8px;background:${
            T.sub
          };border-radius:7px;"><div style="color:${
            T.blue
          };font-weight:700;font-size:10px;margin-bottom:3px;">⚖️ REBALANCE</div><div style="font-size:11px;color:${
            T.txtS
          };">${esc(weekly.rebalanceAdvice)}</div></div>`
        : ""
    }
    ${
      weekly.riskWarning
        ? `<div style="flex:1;min-width:200px;padding:8px;background:${
            T.sub
          };border-radius:7px;"><div style="color:${
            T.red
          };font-weight:700;font-size:10px;margin-bottom:3px;">⚠️ RISK THIS WEEK</div><div style="font-size:11px;color:${
            T.txtS
          };">${esc(weekly.riskWarning)}</div></div>`
        : ""
    }
  </div>
  ${
    weekly.weeklyTip
      ? `<div style="padding:10px 16px;background:${
          T.deep
        };font-size:12px;"><span style="color:${
          T.purple
        };font-weight:700;">🎓 Weekly Tip: </span><span style="color:${
          T.txtS
        };">${esc(weekly.weeklyTip)}</span></div>`
      : ""
  }
</div>`;
}

// ─────────────────────────────────────────────────────────────
//  MAIN EMAIL BUILDER
// ─────────────────────────────────────────────────────────────

export function buildHtmlEmail(
  stockData: StockDataMap,
  signals: TradeSignalMap,
  summary: PortfolioSummary,
  performance: PerformanceResult | null,
  gemini: GeminiInsight | null,
  timeStamp: string
): string {
  const dataMap: Record<string, StockData> = {};
  for (const [k, d] of Object.entries(stockData)) {
    if (k !== "__market__" && !("error" in d)) dataMap[k] = d as StockData;
  }

  const counts: Record<string, number> = {
    STRONG_BUY: 0,
    BUY: 0,
    HOLD: 0,
    SELL: 0,
    STRONG_SELL: 0,
    SKIP: 0,
  };
  for (const s of Object.values(signals))
    counts[s.action] = (counts[s.action] ?? 0) + 1;

  const pnlUp = (summary.totalPnl ?? 0) >= 0;
  const pnlC = pnlUp ? T.green : T.red;
  const m = gemini?.market;
  const a = gemini?.analysis;
  const w = gemini?.weekly;
  const stanceC =
    (
      {
        Bull: T.green,
        Bear: T.red,
        Neutral: T.amber,
        Bullish: T.green,
        Bearish: T.red,
      } as Record<string, string>
    )[a?.overall_stance ?? m?.overall_stance ?? ""] ?? T.txtM;

  const sectorRows = Object.entries(summary.sectorWeights)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([s, wt]) => `
    <tr>
      <td style="font-size:11px;color:${
        T.txtS
      };padding:3px 0;width:120px;">${esc(s)}</td>
      <td style="padding:3px 8px;"><div style="height:7px;background:${
        T.sub
      };border-radius:4px;overflow:hidden;"><div style="width:${Math.min(
        100,
        wt * 3
      )}%;height:100%;background:${T.blue};border-radius:4px;"></div></div></td>
      <td style="font-size:11px;color:${
        T.txtD
      };padding:3px 0;width:36px;">${esc(wt)}%</td>
    </tr>`
    )
    .join("");

  let cards = "";
  for (const [sym, sig] of Object.entries(signals)) {
    if (sig.action === "SKIP") continue;
    const gv = a?.validation?.find((v) => v.symbol === sym);
    cards += buildStockCard(sym, sig as TradeSignal, dataMap[sym], gv);
  }

  const geminiBlock =
    m || a
      ? `
<div style="background:${T.card};border:1px solid ${
          T.bdr
        };border-radius:14px;margin-bottom:18px;overflow:hidden;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${
    T.hdr
  };border-bottom:1px solid ${T.bdr};">
    <tr>
      <td style="padding:12px 16px;">
        <span style="font-size:13px;font-weight:900;color:${
          T.purple
        };">🤖 GEMINI AI MARKET INTELLIGENCE</span>
        ${
          m?.global?.oil_brent_usd
            ? `<span style="font-size:10px;color:${T.txtD};margin-left:8px;">(Google Search grounded)</span>`
            : ""
        }
      </td>
      ${
        a?.overall_stance
          ? `<td style="padding:12px 16px;text-align:right;">${pill(
              a.overall_stance,
              stanceC
            )}</td>`
          : ""
      }
    </tr>
  </table>
  ${
    m && !m.raw
      ? `
  <!-- Global -->
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    <div style="font-size:10px;color:${
      T.txtD
    };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Global Markets</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">🛢 Brent <b>$${esc(
          m.global.oil_brent_usd
        )}</b> <span style="color:${
          m.global.oil_trend === "Rising" ? T.green : T.red
        };">${esc(m.global.oil_trend)}</span></span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">💵 PKR/USD ${esc(
          m.global.usd_pkr
        )}</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">🏦 Fed ${esc(
          m.global.fed_stance
        )}</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">📈 10Y ${esc(
          m.global.us_10y_yield
        )}</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;color:${
          m.global.sentiment === "Risk-On" ? T.green : T.red
        };">${esc(m.global.sentiment)}</span>
    </div>
    ${
      m.global.key_drivers.length
        ? `<div style="margin-top:6px;font-size:11px;color:${
            T.txtD
          };">Drivers: ${m.global.key_drivers.map(esc).join(" · ")}</div>`
        : ""
    }
  </div>
  <!-- Pakistan -->
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    <div style="font-size:10px;color:${
      T.txtD
    };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Pakistan Macro</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">📊 KSE-100 <b>${esc(
          m.pakistan.kse100_level
        )}</b> <span style="color:${pC(
          parseFloat(m.pakistan.kse100_chg ?? "0")
        )};">${esc(m.pakistan.kse100_chg)}%</span></span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">🏛 SBP ${esc(
          m.pakistan.sbp_rate
        )} (${esc(m.pakistan.sbp_outlook)})</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">📉 CPI ${esc(
          m.pakistan.cpi
        )} ${esc(m.pakistan.cpi_trend)}</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">🤝 IMF ${esc(
          m.pakistan.imf_program
        )}</span>
      <span style="background:${T.sub};border:1px solid ${
          T.bdr
        };padding:4px 10px;border-radius:7px;">💰 FX $${esc(
          m.pakistan.fx_reserves
        )}bn</span>
    </div>
    <div style="margin-top:7px;display:flex;gap:14px;flex-wrap:wrap;font-size:11px;">
      ${
        m.pakistan.key_risks.length
          ? `<div style="color:${T.red};">⚠️ ${m.pakistan.key_risks
              .map(esc)
              .join(" · ")}</div>`
          : ""
      }
      ${
        m.pakistan.key_tailwinds.length
          ? `<div style="color:${T.green};">✅ ${m.pakistan.key_tailwinds
              .map(esc)
              .join(" · ")}</div>`
          : ""
      }
    </div>
  </div>
  <!-- Sectors -->
  ${
    Object.keys(m.sector_outlook).length
      ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    <div style="font-size:10px;color:${
      T.txtD
    };font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px;">Sector Outlook</div>
    <table cellpadding="0" cellspacing="0" width="100%">
    ${Object.entries(m.sector_outlook)
      .map(([s, v]) => {
        const c = String(v).includes("Bull")
          ? T.green
          : String(v).includes("Bear")
          ? T.red
          : T.amber;
        return `<tr><td style="font-size:11px;color:${
          T.txtD
        };padding:2px 0;min-width:110px;">${esc(
          s
        )}</td><td style="font-size:11px;color:${c};padding:2px 0;">${esc(
          v
        )}</td></tr>`;
      })
      .join("")}
    </table>
  </div>`
      : ""
  }
  ${
    m.today_headline
      ? `<div style="padding:10px 16px;border-bottom:1px solid ${
          T.bdr
        };font-size:13px;color:${
          T.txtS
        };font-style:italic;line-height:1.5;">"${esc(m.today_headline)}"</div>`
      : ""
  }
  `
      : m?.raw
      ? `<div style="padding:12px 16px;font-size:12px;color:${T.txtS};">${esc(
          m.raw
        )}</div>`
      : ""
  }
  <!-- Portfolio health -->
  ${
    a?.portfolio_health
      ? `
  <div style="padding:12px 16px;border-bottom:1px solid ${T.bdr};">
    ${sectionLabel("🏥", "Portfolio Health (AI Assessment)", T.purple)}
    <div style="font-size:12px;color:${T.txtS};margin-bottom:4px;">${esc(
          a.portfolio_health.pnl_comment
        )}</div>
    <div style="font-size:12px;color:${T.txtS};margin-bottom:5px;">${esc(
          a.portfolio_health.concentration_detail
        )}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;">
      ${
        a.portfolio_health.best_positioned
          ? `<div style="color:${T.green};">⭐ Best: ${esc(
              a.portfolio_health.best_positioned
            )}</div>`
          : ""
      }
      ${
        a.portfolio_health.biggest_risk
          ? `<div style="color:${T.red};">⚠️ Risk: ${esc(
              a.portfolio_health.biggest_risk
            )}</div>`
          : ""
      }
    </div>
    ${
      a.macro_impact
        ? `<div style="margin-top:5px;font-size:11px;color:${
            T.txtD
          };font-style:italic;">${esc(a.macro_impact)}</div>`
        : ""
    }
  </div>`
      : ""
  }
  <!-- Top trade / Avoid -->
  ${
    a?.top_trade_today || a?.avoid_today
      ? `
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      ${
        a?.top_trade_today
          ? `<td style="padding:11px 16px;width:50%;vertical-align:top;"><div style="background:${
              T.green
            }0d;border:1px solid ${
              T.green
            }30;border-radius:9px;padding:10px;"><div style="font-size:10px;color:${
              T.green
            };font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">⭐ TOP TRADE TODAY (AI)</div><div style="font-size:12px;color:${
              T.txtS
            };line-height:1.5;">${esc(a.top_trade_today)}</div></div></td>`
          : ""
      }
      ${
        a?.avoid_today
          ? `<td style="padding:11px 16px;vertical-align:top;"><div style="background:${
              T.red
            }0d;border:1px solid ${
              T.red
            }30;border-radius:9px;padding:10px;"><div style="font-size:10px;color:${
              T.red
            };font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🚫 AVOID TODAY (AI)</div><div style="font-size:12px;color:${
              T.txtS
            };line-height:1.5;">${esc(a.avoid_today)}</div></div></td>`
          : ""
      }
    </tr>
  </table>`
      : ""
  }
  ${
    a?.daily_tip
      ? `<div style="padding:10px 16px;background:${
          T.deep
        };font-size:12px;"><span style="color:${
          T.purple
        };font-weight:700;">🎓 AI Tip: </span><span style="color:${
          T.txtS
        };">${esc(a.daily_tip)}</span>${
          a.emotional_state
            ? `<span style="margin-left:8px;">${pill(
                a.emotional_state,
                T.purple
              )}</span>`
            : ""
        }</div>`
      : ""
  }
</div>`
      : "";

  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PSX Report · ${timeStamp}</title></head>
<body style="margin:0;padding:0;background:${
    T.page
  };-webkit-font-smoothing:antialiased;">
<div style="max-width:700px;margin:0 auto;padding:14px;font-family:'Segoe UI',system-ui,Arial,sans-serif;">

  <!-- HEADER -->
  <div style="background:${
    ENV.EMAIL_THEME === "light"
      ? "linear-gradient(140deg,#e0f2fe,#f0f9ff)"
      : "linear-gradient(140deg,#071e3d,#0a2444)"
  };border:1px solid ${
    T.bdr
  };border-radius:18px;padding:24px;margin-bottom:14px;">
    <div style="font-size:10px;color:${
      T.blue
    };font-weight:800;letter-spacing:3px;text-transform:uppercase;">Pakistan Stock Exchange · KSE-100</div>
    <div style="font-size:30px;font-weight:900;color:${
      T.txt
    };margin:6px 0 3px;letter-spacing:-1px;">📊 Trading Report</div>
    <div style="font-size:12px;color:${T.txtD};">${esc(timeStamp)}</div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
      ${
        counts.STRONG_BUY
          ? pill(`▲▲ STRONG BUY ${counts.STRONG_BUY}`, T.green)
          : ""
      }
      ${counts.BUY ? pill(`▲ BUY ${counts.BUY}`, T.green) : ""}
      ${pill(`● HOLD ${counts.HOLD}`, T.amber)}
      ${counts.SELL ? pill(`▼ SELL ${counts.SELL}`, T.red) : ""}
      ${
        counts.STRONG_SELL
          ? pill(`▼▼ STRONG SELL ${counts.STRONG_SELL}`, T.red)
          : ""
      }
      ${
        performance
          ? pill(`🎯 ${performance.accuracy}% accuracy`, T.purple)
          : ""
      }
    </div>
  </div>

  <!-- PORTFOLIO SUMMARY -->
  <div style="background:${T.card};border:1px solid ${
    T.bdr
  };border-radius:14px;padding:16px 20px;margin-bottom:14px;">
    <div style="font-size:10px;color:${
      T.txtD
    };font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Portfolio Overview</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align:left;padding-bottom:8px;"><div style="font-size:10px;color:${
          T.txtD
        };">Invested</div><div style="font-size:16px;font-weight:700;color:${
    T.txtD
  };">PKR ${(summary.totalCost ?? 0).toLocaleString()}</div></td>
        <td style="text-align:center;padding-bottom:8px;"><div style="font-size:10px;color:${
          T.txtD
        };">Market Value</div><div style="font-size:20px;font-weight:800;color:${
    T.txt
  };">PKR ${(summary.totalValue ?? 0).toLocaleString()}</div></td>
        <td style="text-align:right;padding-bottom:8px;"><div style="font-size:10px;color:${
          T.txtD
        };">Unrealised P&amp;L</div><div style="font-size:24px;font-weight:900;color:${pnlC};">${
    pnlUp ? "+" : ""
  }PKR ${(
    summary.totalPnl ?? 0
  ).toLocaleString()}</div><div style="font-size:14px;font-weight:800;color:${pnlC};">${
    pnlUp ? "+" : ""
  }${summary.totalPnlPct ?? 0}%</div></td>
      </tr>
    </table>
    <div style="margin-top:12px;border-top:1px solid ${
      T.bdr
    };padding-top:10px;">
      <div style="font-size:10px;color:${
        T.txtD
      };font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:7px;">Sector Allocation</div>
      <table width="100%" cellpadding="0" cellspacing="0">${sectorRows}</table>
    </div>
  </div>

  ${weeklyBlock(w ?? null)}
  ${geminiBlock}

  <div style="font-size:10px;color:${
    T.txtD
  };font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Individual Position Signals</div>
  ${cards}

  <div style="text-align:center;padding:20px;font-size:10px;color:${
    T.txtF
  };line-height:1.7;">
    PSX Agent · ${esc(
      timeStamp
    )}<br/>Algorithmic signals + AI feedback — not financial advice.
  </div>
</div></body></html>`;
}
