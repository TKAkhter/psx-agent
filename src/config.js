"use strict";
require("dotenv").config();

const ENV = {
    MONGODB_URI: process.env.MONGODB_URI || "",
    MONGODB_DB: process.env.MONGODB_DB || "psx-agent",
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
    TIMEZONE: "Asia/Karachi",
    GEMINI_MODEL: "gemini-2.0-flash",
};

// Default portfolio — seeded to MongoDB on first run if collection is empty
const DEFAULT_PORTFOLIO = [
    { symbol: "MEBL", ticker: "MEBL.KA", shares: 1150, avg_cost: 429.93, name: "Meezan Bank", sector: "Banking" },
    { symbol: "OGDC", ticker: "OGDC.KA", shares: 1100, avg_cost: 266.29, name: "OGDC", sector: "Oil & Gas" },
    { symbol: "HUBC", ticker: "HUBC.KA", shares: 1100, avg_cost: 191.85, name: "Hub Power", sector: "Energy" },
    { symbol: "EFERT", ticker: "EFERT.KA", shares: 900, avg_cost: 202.37, name: "Engro Fertilizer", sector: "Fertilizer" },
    { symbol: "ENGROH", ticker: "ENGROH.KA", shares: 400, avg_cost: 279.51, name: "Engro Holdings", sector: "Conglomerate" },
    { symbol: "FFC", ticker: "FFC.KA", shares: 400, avg_cost: 507.94, name: "Fauji Fertilizer", sector: "Fertilizer" },
    { symbol: "LUCK", ticker: "LUCK.KA", shares: 300, avg_cost: 378.70, name: "Lucky Cement", sector: "Cement" },
    { symbol: "MARI", ticker: "MARI.KA", shares: 200, avg_cost: 635.00, name: "Mari Petroleum", sector: "Oil & Gas" },
    { symbol: "POL", ticker: "POL.KA", shares: 200, avg_cost: 639.18, name: "Pakistan Oilfields", sector: "Oil & Gas" },
    { symbol: "SYS", ticker: "SYS.KA", shares: 750, avg_cost: 137.25, name: "Systems Ltd", sector: "Technology" },
];

// Signal scoring thresholds
const SIGNAL_THRESHOLDS = {
    STRONG_BUY: 6,
    BUY: 4,
    SELL: -4,
    STRONG_SELL: -6,
};

// RSI zones
const RSI_ZONES = {
    DEEPLY_OVERSOLD: 25,
    OVERSOLD: 35,
    MILD_OVERSOLD: 45,
    MILD_OVERBOUGHT: 55,
    OVERBOUGHT: 65,
    DEEPLY_OVERBOUGHT: 75,
};

module.exports = { ENV, DEFAULT_PORTFOLIO, SIGNAL_THRESHOLDS, RSI_ZONES };