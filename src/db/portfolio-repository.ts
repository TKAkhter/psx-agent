import { prisma } from './prisma-client';
import { logger } from '../utils/logger';
import type { Holding, StockRecommendation } from '../types';

// ─── Default portfolio (used when collection is empty) ────────────────────────

export const DEFAULT_PORTFOLIO: Holding[] = [
  { symbol:'MEBL',   ticker:'MEBL',   shares:1150, avgCost:429.93, name:'Meezan Bank',      sector:'Banking'      },
  { symbol:'OGDC',   ticker:'OGDC',   shares:1100, avgCost:266.29, name:'OGDC',              sector:'Oil & Gas'    },
  { symbol:'HUBC',   ticker:'HUBC',   shares:1100, avgCost:191.85, name:'Hub Power',         sector:'Energy'       },
  { symbol:'EFERT',  ticker:'EFERT',  shares:900,  avgCost:202.37, name:'Engro Fertilizer',  sector:'Fertilizer'   },
  { symbol:'ENGROH', ticker:'ENGROH', shares:400,  avgCost:279.51, name:'Engro Holdings',    sector:'Conglomerate' },
  { symbol:'FFC',    ticker:'FFC',    shares:400,  avgCost:507.94, name:'Fauji Fertilizer',  sector:'Fertilizer'   },
  { symbol:'LUCK',   ticker:'LUCK',   shares:300,  avgCost:378.70, name:'Lucky Cement',      sector:'Cement'       },
  { symbol:'MARI',   ticker:'MARI',   shares:200,  avgCost:635.00, name:'Mari Petroleum',    sector:'Oil & Gas'    },
  { symbol:'POL',    ticker:'POL',    shares:200,  avgCost:639.18, name:'Pakistan Oilfields', sector:'Oil & Gas'  },
  { symbol:'SYS',    ticker:'SYS',    shares:750,  avgCost:137.25, name:'Systems Ltd',       sector:'Technology'   },
];

// ─── Read holdings ─────────────────────────────────────────────────────────────

export async function getHoldings(): Promise<Holding[]> {
  try {
    const rows = await prisma.holding.findMany({
      where: { shares: { gt: 0 } },
      orderBy: { ticker: 'asc' },
    });

    if (rows.length === 0) {
      logger.warn('Holdings collection empty — seeding default portfolio into DB');
      await seedDefaultHoldings();
      return DEFAULT_PORTFOLIO;
    }

    logger.info({ count: rows.length }, 'Portfolio loaded from MongoDB');
    return rows.map(r => ({
      symbol:  r.symbol,
      ticker:  r.ticker,
      shares:  r.shares,
      avgCost: r.avgCost,
      name:    r.name,
      sector:  r.sector,
    }));
  } catch (err) {
    logger.error({ err }, 'DB read failed — using default portfolio');
    return DEFAULT_PORTFOLIO;
  }
}

// ─── Seed defaults into DB so future runs use DB ──────────────────────────────

async function seedDefaultHoldings(): Promise<void> {
  try {
    for (const h of DEFAULT_PORTFOLIO) {
      await prisma.holding.upsert({
        where:  { ticker: h.ticker },
        update: { shares: h.shares, avgCost: h.avgCost, name: h.name, sector: h.sector },
        create: { symbol: h.symbol, ticker: h.ticker, shares: h.shares, avgCost: h.avgCost, name: h.name, sector: h.sector },
      });
    }
    logger.info({ count: DEFAULT_PORTFOLIO.length }, 'Default portfolio seeded into MongoDB');
  } catch (err) {
    logger.warn({ err }, 'Failed to seed default holdings — non-fatal');
  }
}

// ─── Save run log ──────────────────────────────────────────────────────────────

export async function saveRunLog(data: {
  runId: string; runAt: Date; durationMs: number; tickersAnalysed: number;
  portfolioValue: number; unrealisedPl: number; unrealisedPlPct: number;
  alertCount: number; aiAccuracyRating: number; circuitBreakerActive: boolean;
  signals: Record<string, number>; topBuys: string[]; topSells: string[]; errors: string[];
}): Promise<void> {
  try {
    await prisma.runLog.create({ data });
    logger.debug({ runId: data.runId }, 'Run log saved');
  } catch (err) {
    logger.warn({ err }, 'Failed to save run log — non-fatal');
  }
}

// ─── Save price snapshots for historical analysis ─────────────────────────────

export async function savePriceSnapshots(
  recs: StockRecommendation[],
  runId: string,
): Promise<void> {
  try {
    const now = new Date();
    const docs = recs.map(r => {
      const closes = r.technicals ? [r.currentPrice] : [r.currentPrice]; // extend when candle history available
      return {
        ticker:         r.ticker,
        runId,
        capturedAt:     now,
        open:           r.currentPrice,
        high:           r.technicals.resistance1 > 0 ? r.technicals.resistance1 : r.currentPrice,
        low:            r.technicals.support1    > 0 ? r.technicals.support1    : r.currentPrice,
        close:          r.currentPrice,
        volume:         0,
        change1d:       r.dayChangePct,
        change1w:       r.technicals.roc10 ?? 0,
        change1m:       0,
        signal:         r.signal,
        compositeScore: r.compositeScore.composite,
      };
    });
    await prisma.priceSnapshot.createMany({ data: docs });
    logger.debug({ count: docs.length }, 'Price snapshots saved');
  } catch (err) {
    logger.warn({ err }, 'Failed to save price snapshots — non-fatal');
  }
}

// ─── Get recent price history for a ticker (last N snapshots) ─────────────────
// Used to enhance analysis with trend data from past runs

export async function getPriceHistory(ticker: string, lastN = 10): Promise<{
  avgClose: number; trend: 'up' | 'down' | 'sideways'; recentSignals: string[];
  avgScore: number;
} | null> {
  try {
    const snaps = await prisma.priceSnapshot.findMany({
      where: { ticker },
      orderBy: { capturedAt: 'desc' },
      take: lastN,
    });
    if (snaps.length < 2) return null;

    const closes  = snaps.map(s => s.close);
    const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
    const oldest   = closes[closes.length - 1];
    const newest   = closes[0];
    const trend: 'up' | 'down' | 'sideways' =
      newest > oldest * 1.02 ? 'up' :
      newest < oldest * 0.98 ? 'down' : 'sideways';

    return {
      avgClose: parseFloat(avgClose.toFixed(2)),
      trend,
      recentSignals: snaps.slice(0, 5).map(s => s.signal),
      avgScore: parseFloat((snaps.reduce((a, s) => a + s.compositeScore, 0) / snaps.length).toFixed(1)),
    };
  } catch {
    return null;
  }
}

// ─── Get / set fundamentals cache ─────────────────────────────────────────────
// Avoids hammering PSX Terminal API on every run for slowly-changing data

const CACHE_TTL_HOURS = 24 * 7; // 1 week

export async function getCachedFundamentals(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const row = await prisma.fundamentalsCache.findUnique({ where: { ticker } });
    if (!row) return null;
    const ageHours = (Date.now() - row.updatedAt.getTime()) / 3_600_000;
    if (ageHours > CACHE_TTL_HOURS) return null;   // stale
    return row.raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveFundamentalsCache(ticker: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.fundamentalsCache.upsert({
      where:  { ticker },
      update: {
        updatedAt:        new Date(),
        peRatioTtm:       Number(data.peRatioTtm       ?? 0),
        peRatioForward:   Number(data.peRatioForward    ?? 0),
        pbRatio:          Number(data.pbRatio           ?? 0),
        epsTtm:           Number(data.epsTtm            ?? 0),
        epsGrowthYoy:     Number(data.epsGrowthYoy      ?? 0),
        roeTtm:           Number(data.roeTtm            ?? 0),
        dividendYield:    Number(data.dividendYieldPct  ?? 0),
        dividendPerShare: Number(data.dividendPerShare  ?? 0),
        debtToEquity:     Number(data.debtToEquity      ?? 0),
        interestCoverage: Number(data.interestCoverageRatio ?? 0),
        netMargin:        Number(data.netProfitMarginPct ?? 0),
        revenueGrowthYoy: Number(data.revenueGrowthYoy  ?? 0),
        freeCashFlowYield: Number(data.freeCashFlowYield ?? 0),
        raw:              JSON.parse(JSON.stringify(data)),
      },
      create: {
        ticker,
        updatedAt:        new Date(),
        peRatioTtm:       Number(data.peRatioTtm       ?? 0),
        peRatioForward:   Number(data.peRatioForward    ?? 0),
        pbRatio:          Number(data.pbRatio           ?? 0),
        epsTtm:           Number(data.epsTtm            ?? 0),
        epsGrowthYoy:     Number(data.epsGrowthYoy      ?? 0),
        roeTtm:           Number(data.roeTtm            ?? 0),
        dividendYield:    Number(data.dividendYieldPct  ?? 0),
        dividendPerShare: Number(data.dividendPerShare  ?? 0),
        debtToEquity:     Number(data.debtToEquity      ?? 0),
        interestCoverage: Number(data.interestCoverageRatio ?? 0),
        netMargin:        Number(data.netProfitMarginPct ?? 0),
        revenueGrowthYoy: Number(data.revenueGrowthYoy  ?? 0),
        freeCashFlowYield: Number(data.freeCashFlowYield ?? 0),
        raw:              JSON.parse(JSON.stringify(data)),
      },
    });
  } catch (err) {
    logger.debug({ ticker, err }, 'Fundamentals cache write failed — non-fatal');
  }
}
