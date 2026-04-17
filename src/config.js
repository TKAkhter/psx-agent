"use strict";
require("dotenv").config();

// ─── Environment ──────────────────────────────────────────────
console.log(process.env);
const ENV = {
    MONGODB_URI: process.env.MONGODB_URI || "",
    MONGODB_DB: process.env.MONGODB_DB || "psx_agent",
    TWILIO_ENABLED: process.env.TWILIO_ENABLED === "true",
    EMAIL_ENABLED: process.env.EMAIL_ENABLED === "true",
    GEMINI_ENABLED: process.env.GEMINI_ENABLED === "true",
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
    TWILIO_FROM: process.env.TWILIO_FROM || "",
    TWILIO_TO: process.env.TWILIO_TO || "",
    EMAIL_USER: process.env.EMAIL_USER || "",
    EMAIL_PASS: process.env.EMAIL_PASS || "",
    EMAIL_TO: process.env.EMAIL_TO || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash-preview-04-17",
    TIMEZONE: "Asia/Karachi",
};

// ─── Signal thresholds ────────────────────────────────────────
const SIGNAL_THRESHOLDS = Object.freeze({
    STRONG_BUY: 8,
    BUY: 4,
    SELL: -4,
    STRONG_SELL: -8,
});

// ─── RSI boundary constants ───────────────────────────────────
const RSI_LEVELS = Object.freeze({
    EXTREME_OVERSOLD: 20,
    DEEPLY_OVERSOLD: 25,
    OVERSOLD: 35,
    MILD_OVERSOLD: 45,
    MILD_OVERBOUGHT: 55,
    OVERBOUGHT: 65,
    DEEPLY_OVERBOUGHT: 75,
    EXTREME_OVERBOUGHT: 80,
});

// ─── Default portfolio — seeded once to MongoDB ───────────────
const DEFAULT_PORTFOLIO = Object.freeze([
    { symbol: "MEBL", ticker: "MEBL.KA", shares: 1150, avgCost: 429.93, name: "Meezan Bank", sector: "Banking" },
    { symbol: "OGDC", ticker: "OGDC.KA", shares: 1100, avgCost: 266.29, name: "OGDC", sector: "Oil & Gas" },
    { symbol: "HUBC", ticker: "HUBC.KA", shares: 1100, avgCost: 191.85, name: "Hub Power", sector: "Energy" },
    { symbol: "EFERT", ticker: "EFERT.KA", shares: 900, avgCost: 202.37, name: "Engro Fertilizer", sector: "Fertilizer" },
    { symbol: "ENGROH", ticker: "ENGROH.KA", shares: 400, avgCost: 279.51, name: "Engro Holdings", sector: "Conglomerate" },
    { symbol: "FFC", ticker: "FFC.KA", shares: 400, avgCost: 507.94, name: "Fauji Fertilizer", sector: "Fertilizer" },
    { symbol: "LUCK", ticker: "LUCK.KA", shares: 300, avgCost: 378.70, name: "Lucky Cement", sector: "Cement" },
    { symbol: "MARI", ticker: "MARI.KA", shares: 200, avgCost: 635.00, name: "Mari Petroleum", sector: "Oil & Gas" },
    { symbol: "POL", ticker: "POL.KA", shares: 200, avgCost: 639.18, name: "Pakistan Oilfields", sector: "Oil & Gas" },
    { symbol: "SYS", ticker: "SYS.KA", shares: 750, avgCost: 137.25, name: "Systems Ltd", sector: "Technology" },
]);

module.exports = { ENV, SIGNAL_THRESHOLDS, RSI_LEVELS, DEFAULT_PORTFOLIO };