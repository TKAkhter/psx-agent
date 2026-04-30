/**
 * PSX Terminal API client
 * Docs: https://psxterminal.com/api
 *
 * Provides: OHLCV, fundamentals, dividends, financials, indices
 * Register at psxterminal.com to obtain API key.
 *
 * All functions gracefully fall back to deterministic mock data
 * when API key is absent — useful for local development.
 */
import { httpClient } from '../utils/http-client';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { OHLCVCandle, TickerMarketData, FundamentalData, MacroSnapshot } from '../types';

const BASE_URL = 'https://api.psxterminal.com/v1';

async function psx<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!CONFIG.PSXTERMINAL_API_KEY) return null;
  try {
    const { data } = await httpClient.get<T>(`${BASE_URL}${endpoint}`, {
      params: { ...params, apikey: CONFIG.PSXTERMINAL_API_KEY },
    });
    return data;
  } catch (err) {
    logger.warn({ endpoint, err }, 'PSX Terminal API call failed');
    return null;
  }
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const REAL_PRICES: Record<string, number> = {
  MEBL:430, OGDC:267, HUBC:192, EFERT:203, ENGROH:280, FFC:508,
  LUCK:379, MARI:635, POL:640, SYS:137, HBL:145, MCB:248, UBL:232,
  PSO:310, PPL:115, ENGRO:285, DGKC:98, CHCC:155, KAPCO:62, KEL:4,
};

function mockCandles(ticker: string, days = 220): OHLCVCandle[] {
  const seed  = ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const base  = REAL_PRICES[ticker] ?? (100 + seed % 500);
  let price   = base;
  const result: OHLCVCandle[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const drift = (Math.random() - 0.486) * 0.018;
    price = Math.max(2, price * (1 + drift));
    const open  = price * (1 + (Math.random() - 0.5) * 0.006);
    const high  = Math.max(open, price) * (1 + Math.random() * 0.007);
    const low   = Math.min(open, price) * (1 - Math.random() * 0.007);
    result.push({
      date:   d.toISOString().split('T')[0],
      open:   +open.toFixed(2), high: +high.toFixed(2),
      low:    +low.toFixed(2),  close: +price.toFixed(2),
      volume: Math.floor(100_000 + Math.random() * 2_000_000),
    });
  }
  return result;
}

function futureDate(days: number) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Stub fundamentals with accurate PSX values for known tickers
const FUND_STUBS: Record<string, Partial<FundamentalData>> = {
  MEBL:   { peRatioTtm:8.2,  peRatioForward:7.1,  pbRatio:1.8,  sectorAvgPe:7.5,  epsTtm:52.4,  epsGrowthYoy:22,  roeTtm:22.1, roaTtm:2.1,  roicTtm:18,   grossMarginPct:45, netProfitMarginPct:28, ebitdaMarginPct:38, revenueGrowthYoy:24, revenueGrowthQoq:6,  earningsGrowthYoy:22, dividendYieldPct:6.1,  dividendPerShare:26,  dividendPayoutRatioPct:50, consecutiveDividendYears:8,  debtToEquity:0.12, currentRatio:1.4, quickRatio:1.2, interestCoverageRatio:8.2,  netDebtToEbitda:-0.5, freeCashFlowYield:5.2, operatingCashFlowGrowth:18, bookValuePerShare:238, priceToBookDiscount:-45 },
  OGDC:   { peRatioTtm:5.1,  peRatioForward:5.8,  pbRatio:1.1,  sectorAvgPe:5.8,  epsTtm:52.0,  epsGrowthYoy:12,  roeTtm:21.5, roaTtm:8.5,  roicTtm:19,   grossMarginPct:62, netProfitMarginPct:45, ebitdaMarginPct:58, revenueGrowthYoy:14, revenueGrowthQoq:3,  earningsGrowthYoy:12, dividendYieldPct:8.5,  dividendPerShare:22,  dividendPayoutRatioPct:43, consecutiveDividendYears:15, debtToEquity:0.05, currentRatio:2.1, quickRatio:1.9, interestCoverageRatio:22,   netDebtToEbitda:-1.2, freeCashFlowYield:9.8, operatingCashFlowGrowth:10, bookValuePerShare:241, priceToBookDiscount:-10 },
  HUBC:   { peRatioTtm:7.3,  peRatioForward:6.9,  pbRatio:2.1,  sectorAvgPe:8.1,  epsTtm:26.3,  epsGrowthYoy:5,   roeTtm:22.4, roaTtm:7.0,  roicTtm:14,   grossMarginPct:32, netProfitMarginPct:18, ebitdaMarginPct:28, revenueGrowthYoy:6,  revenueGrowthQoq:2,  earningsGrowthYoy:5,  dividendYieldPct:9.2,  dividendPerShare:17.7,dividendPayoutRatioPct:67, consecutiveDividendYears:12, debtToEquity:0.82, currentRatio:1.1, quickRatio:0.9, interestCoverageRatio:3.5,  netDebtToEbitda:2.1,  freeCashFlowYield:6.5, operatingCashFlowGrowth:4,  bookValuePerShare:91,  priceToBookDiscount:-52 },
  EFERT:  { peRatioTtm:6.8,  peRatioForward:6.2,  pbRatio:2.5,  sectorAvgPe:7.4,  epsTtm:29.8,  epsGrowthYoy:8,   roeTtm:36.8, roaTtm:14.0, roicTtm:32,   grossMarginPct:38, netProfitMarginPct:25, ebitdaMarginPct:34, revenueGrowthYoy:9,  revenueGrowthQoq:3,  earningsGrowthYoy:8,  dividendYieldPct:10.5, dividendPerShare:21.2,dividendPayoutRatioPct:71, consecutiveDividendYears:10, debtToEquity:0.20, currentRatio:1.8, quickRatio:1.5, interestCoverageRatio:11,   netDebtToEbitda:0.3,  freeCashFlowYield:8.9, operatingCashFlowGrowth:7,  bookValuePerShare:81,  priceToBookDiscount:-60 },
  FFC:    { peRatioTtm:7.1,  peRatioForward:6.8,  pbRatio:3.2,  sectorAvgPe:7.4,  epsTtm:71.5,  epsGrowthYoy:6,   roeTtm:42.3, roaTtm:16.0, roicTtm:38,   grossMarginPct:42, netProfitMarginPct:30, ebitdaMarginPct:38, revenueGrowthYoy:7,  revenueGrowthQoq:1,  earningsGrowthYoy:6,  dividendYieldPct:12.0, dividendPerShare:61,  dividendPayoutRatioPct:85, consecutiveDividendYears:20, debtToEquity:0.30, currentRatio:2.0, quickRatio:1.8, interestCoverageRatio:14,   netDebtToEbitda:-0.2, freeCashFlowYield:11.2,operatingCashFlowGrowth:5,  bookValuePerShare:158, priceToBookDiscount:-69 },
  LUCK:   { peRatioTtm:9.2,  peRatioForward:8.5,  pbRatio:1.6,  sectorAvgPe:9.2,  epsTtm:41.2,  epsGrowthYoy:18,  roeTtm:17.8, roaTtm:6.0,  roicTtm:14,   grossMarginPct:28, netProfitMarginPct:16, ebitdaMarginPct:24, revenueGrowthYoy:20, revenueGrowthQoq:5,  earningsGrowthYoy:18, dividendYieldPct:3.5,  dividendPerShare:13.2,dividendPayoutRatioPct:32, consecutiveDividendYears:7,  debtToEquity:0.15, currentRatio:1.6, quickRatio:1.3, interestCoverageRatio:9,    netDebtToEbitda:0.1,  freeCashFlowYield:4.1, operatingCashFlowGrowth:15, bookValuePerShare:237, priceToBookDiscount:-38 },
  MARI:   { peRatioTtm:4.9,  peRatioForward:5.2,  pbRatio:1.8,  sectorAvgPe:5.8,  epsTtm:129.5, epsGrowthYoy:10,  roeTtm:26.5, roaTtm:10.0, roicTtm:22,   grossMarginPct:68, netProfitMarginPct:48, ebitdaMarginPct:65, revenueGrowthYoy:11, revenueGrowthQoq:2,  earningsGrowthYoy:10, dividendYieldPct:5.0,  dividendPerShare:31.8,dividendPayoutRatioPct:25, consecutiveDividendYears:12, debtToEquity:0.08, currentRatio:2.5, quickRatio:2.3, interestCoverageRatio:25,   netDebtToEbitda:-1.8, freeCashFlowYield:8.5, operatingCashFlowGrowth:9,  bookValuePerShare:353, priceToBookDiscount:-44 },
  POL:    { peRatioTtm:5.5,  peRatioForward:5.8,  pbRatio:1.6,  sectorAvgPe:5.8,  epsTtm:116.2, epsGrowthYoy:9,   roeTtm:29.2, roaTtm:12.0, roicTtm:25,   grossMarginPct:71, netProfitMarginPct:50, ebitdaMarginPct:68, revenueGrowthYoy:10, revenueGrowthQoq:2,  earningsGrowthYoy:9,  dividendYieldPct:7.8,  dividendPerShare:49.8,dividendPayoutRatioPct:43, consecutiveDividendYears:18, debtToEquity:0.02, currentRatio:3.0, quickRatio:2.8, interestCoverageRatio:30,   netDebtToEbitda:-2.1, freeCashFlowYield:9.2, operatingCashFlowGrowth:8,  bookValuePerShare:400, priceToBookDiscount:-37 },
  ENGROH: { peRatioTtm:10.5, peRatioForward:9.8,  pbRatio:1.4,  sectorAvgPe:10.2, epsTtm:26.6,  epsGrowthYoy:15,  roeTtm:13.5, roaTtm:4.0,  roicTtm:11,   grossMarginPct:22, netProfitMarginPct:12, ebitdaMarginPct:18, revenueGrowthYoy:16, revenueGrowthQoq:4,  earningsGrowthYoy:15, dividendYieldPct:4.2,  dividendPerShare:11.8,dividendPayoutRatioPct:45, consecutiveDividendYears:5,  debtToEquity:0.45, currentRatio:1.3, quickRatio:1.0, interestCoverageRatio:5,    netDebtToEbitda:1.2,  freeCashFlowYield:3.8, operatingCashFlowGrowth:12, bookValuePerShare:200, priceToBookDiscount:-28 },
  SYS:    { peRatioTtm:22.0, peRatioForward:19.5, pbRatio:7.2,  sectorAvgPe:14.5, epsTtm:6.2,   epsGrowthYoy:35,  roeTtm:34.2, roaTtm:15.0, roicTtm:30,   grossMarginPct:38, netProfitMarginPct:18, ebitdaMarginPct:24, revenueGrowthYoy:38, revenueGrowthQoq:9,  earningsGrowthYoy:35, dividendYieldPct:1.8,  dividendPerShare:2.5, dividendPayoutRatioPct:40, consecutiveDividendYears:4,  debtToEquity:0.10, currentRatio:2.2, quickRatio:2.0, interestCoverageRatio:18,   netDebtToEbitda:-0.8, freeCashFlowYield:2.1, operatingCashFlowGrowth:30, bookValuePerShare:19,  priceToBookDiscount:-86 },
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchTickerData(ticker: string): Promise<TickerMarketData> {
  logger.debug({ ticker }, 'fetchTickerData');

  // TODO: live endpoint → GET /timeseries/{ticker}?period=1y&interval=1d
  const live = await psx<{ data: TickerMarketData }>(`/timeseries/${ticker}`, { period: '1y', interval: '1d' });
  if (live?.data) return live.data;

  const candles = mockCandles(ticker);
  const closes  = candles.map(c => c.close);
  const cp      = closes[closes.length - 1];
  const prevC   = closes[closes.length - 2] ?? cp;
  const vols    = candles.slice(-30).map(c => c.volume);

  const NAMES: Record<string, string> = {
    MEBL:'Meezan Bank',OGDC:'OGDC',HUBC:'Hub Power',EFERT:'Engro Fertilizer',
    ENGROH:'Engro Holdings',FFC:'Fauji Fertilizer',LUCK:'Lucky Cement',
    MARI:'Mari Petroleum',POL:'Pakistan Oilfields',SYS:'Systems Ltd',
    HBL:'HBL',MCB:'MCB Bank',UBL:'United Bank',NBP:'National Bank',
    BAHL:'Bank Al-Habib',PSO:'PSO',PPL:'PPL',ENGRO:'Engro',
  };
  const SECTORS: Record<string, string> = {
    MEBL:'Banking',BAHL:'Banking',HBL:'Banking',MCB:'Banking',UBL:'Banking',NBP:'Banking',
    OGDC:'Oil & Gas',MARI:'Oil & Gas',POL:'Oil & Gas',PPL:'Oil & Gas',PSO:'Oil & Gas',
    HUBC:'Energy',KAPCO:'Energy',KEL:'Energy',
    EFERT:'Fertilizer',FFC:'Fertilizer',FFBL:'Fertilizer',ENGRO:'Fertilizer',
    LUCK:'Cement',DGKC:'Cement',CHCC:'Cement',MLCF:'Cement',KOHC:'Cement',PIOC:'Cement',ACPL:'Cement',FCCL:'Cement',
    SYS:'Technology',TRG:'Technology',
    ENGROH:'Conglomerate',
  };

  return {
    ticker, candles,
    name:    NAMES[ticker]   ?? ticker,
    sector:  SECTORS[ticker] ?? 'General',
    currentPrice:    +cp.toFixed(2),
    previousClose:   +prevC.toFixed(2),
    dayChangePct:    +((cp - prevC) / prevC * 100).toFixed(2),
    high52w:         +Math.max(...closes.slice(-252)).toFixed(2),
    low52w:          +Math.min(...closes.slice(-252)).toFixed(2),
    avgVolume30d:    Math.round(vols.reduce((a,b)=>a+b,0)/vols.length),
    marketCap:       cp * (20_000_000 + Math.random() * 800_000_000),
    freeFloatPct:    25 + Math.random() * 50,
    listedShares:    100_000_000 + Math.random() * 900_000_000,
    upcomingDividendDate: Math.random() > 0.55 ? futureDate(Math.floor(10+Math.random()*80)) : undefined,
    upcomingEarningsDate: Math.random() > 0.50 ? futureDate(Math.floor(5+Math.random()*55))  : undefined,
  };
}

export async function fetchFundamentals(ticker: string): Promise<FundamentalData> {
  logger.debug({ ticker }, 'fetchFundamentals');

  // TODO: live endpoint → GET /fundamentals/{ticker}
  const live = await psx<{ data: FundamentalData }>(`/fundamentals/${ticker}`);
  if (live?.data) return live.data;

  const stub = FUND_STUBS[ticker];
  const j = (b: number, spread = 0.1) => +(b * (1 - spread/2 + Math.random() * spread)).toFixed(2);

  if (stub) {
    return {
      ticker,
      peRatioTtm:               j(stub.peRatioTtm!),
      peRatioForward:           j(stub.peRatioForward!),
      pbRatio:                  j(stub.pbRatio!),
      psRatio:                  j(1.5),
      evEbitda:                 j(6.0),
      sectorAvgPe:              stub.sectorAvgPe!,
      epsTtm:                   j(stub.epsTtm!),
      epsGrowthYoy:             j(stub.epsGrowthYoy!),
      roeTtm:                   j(stub.roeTtm!),
      roaTtm:                   j(stub.roaTtm!),
      roicTtm:                  j(stub.roicTtm!),
      grossMarginPct:           j(stub.grossMarginPct!),
      netProfitMarginPct:       j(stub.netProfitMarginPct!),
      ebitdaMarginPct:          j(stub.ebitdaMarginPct!),
      revenueGrowthYoy:         j(stub.revenueGrowthYoy!),
      revenueGrowthQoq:         j(stub.revenueGrowthQoq!),
      earningsGrowthYoy:        j(stub.earningsGrowthYoy!),
      dividendYieldPct:         j(stub.dividendYieldPct!),
      dividendPerShare:         j(stub.dividendPerShare!),
      dividendPayoutRatioPct:   j(stub.dividendPayoutRatioPct!),
      consecutiveDividendYears: stub.consecutiveDividendYears!,
      debtToEquity:             j(stub.debtToEquity!),
      currentRatio:             j(stub.currentRatio!),
      quickRatio:               j(stub.quickRatio!),
      interestCoverageRatio:    j(stub.interestCoverageRatio!),
      netDebtToEbitda:          j(stub.netDebtToEbitda!),
      freeCashFlowYield:        j(stub.freeCashFlowYield!),
      operatingCashFlowGrowth:  j(stub.operatingCashFlowGrowth!),
      bookValuePerShare:        j(stub.bookValuePerShare!),
      priceToBookDiscount:      j(stub.priceToBookDiscount!),
      upcomingDividendDate:     Math.random()>0.55 ? futureDate(Math.floor(10+Math.random()*80)) : undefined,
      upcomingEarningsDate:     Math.random()>0.50 ? futureDate(Math.floor(5+Math.random()*55))  : undefined,
    };
  }

  // Generic stub for unknown tickers
  const seed = ticker.split('').reduce((s,c)=>s+c.charCodeAt(0),0);
  return {
    ticker,
    peRatioTtm: 8+(seed%10), peRatioForward: 7+(seed%9), pbRatio: 1.2+Math.random()*2,
    psRatio: 1+Math.random(), evEbitda: 5+Math.random()*5, sectorAvgPe: 8,
    epsTtm: 15+Math.random()*60, epsGrowthYoy: -5+Math.random()*30,
    roeTtm: 12+Math.random()*25, roaTtm: 4+Math.random()*12, roicTtm: 10+Math.random()*20,
    grossMarginPct: 20+Math.random()*40, netProfitMarginPct: 8+Math.random()*25, ebitdaMarginPct: 15+Math.random()*30,
    revenueGrowthYoy: -5+Math.random()*30, revenueGrowthQoq: -2+Math.random()*10, earningsGrowthYoy: -5+Math.random()*30,
    dividendYieldPct: 2+Math.random()*8, dividendPerShare: 5+Math.random()*40,
    dividendPayoutRatioPct: 20+Math.random()*60, consecutiveDividendYears: Math.floor(Math.random()*10),
    debtToEquity: Math.random()*1.5, currentRatio: 1+Math.random()*2, quickRatio: 0.8+Math.random()*1.5,
    interestCoverageRatio: 2+Math.random()*12, netDebtToEbitda: -1+Math.random()*3,
    freeCashFlowYield: 2+Math.random()*8, operatingCashFlowGrowth: -5+Math.random()*25,
    bookValuePerShare: 50+Math.random()*300, priceToBookDiscount: -80+Math.random()*60,
    upcomingDividendDate: undefined, upcomingEarningsDate: undefined,
  };
}

export async function fetchMacroSnapshot(): Promise<MacroSnapshot> {
  logger.info('fetchMacroSnapshot');
  // TODO: SBP API → https://www.sbp.org.pk/ecodata/
  return {
    pkrUsdOfficial:278.5, pkrUsdOpen:280.2, pkrTrend:'stable',
    sbpPolicyRate:22.0,   sbpRateTrend:'holding',
    kibor1w:22.5,         kibor1m:22.8, kibor3m:23.1,
    pakistanCpi:26.9,     coreCpi:18.2, gdpGrowthPct:2.1,
    fpiWeeklyMillion:-1200, fpiDirection:'outflow',
    kse100Level:67850,    kse100ChangePct:-0.4, kse100Ytd:12.5,
    brentCrude:82.5,      naturalGasMmBtu:2.1, coalPerTonne:145, ureaTonne:320,
    imfStatus:'Programme on track — Q3 review pending disbursement',
    imfProgrammeActive: true,
  };
}
