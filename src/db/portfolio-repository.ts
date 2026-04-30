import { prisma } from './prisma-client';
import { logger } from '../utils/logger';
import type { Holding } from '../types';

// Static fallback — used when DB is empty or unreachable
export const FALLBACK_PORTFOLIO: Holding[] = [
  { symbol:'MEBL',  ticker:'MEBL',  shares:1150, avgCost:429.93, name:'Meezan Bank',      sector:'Banking'      },
  { symbol:'OGDC',  ticker:'OGDC',  shares:1100, avgCost:266.29, name:'OGDC',              sector:'Oil & Gas'    },
  { symbol:'HUBC',  ticker:'HUBC',  shares:1100, avgCost:191.85, name:'Hub Power',         sector:'Energy'       },
  { symbol:'EFERT', ticker:'EFERT', shares:900,  avgCost:202.37, name:'Engro Fertilizer',  sector:'Fertilizer'   },
  { symbol:'ENGROH',ticker:'ENGROH',shares:400,  avgCost:279.51, name:'Engro Holdings',    sector:'Conglomerate' },
  { symbol:'FFC',   ticker:'FFC',   shares:400,  avgCost:507.94, name:'Fauji Fertilizer',  sector:'Fertilizer'   },
  { symbol:'LUCK',  ticker:'LUCK',  shares:300,  avgCost:378.70, name:'Lucky Cement',      sector:'Cement'       },
  { symbol:'MARI',  ticker:'MARI',  shares:200,  avgCost:635.00, name:'Mari Petroleum',    sector:'Oil & Gas'    },
  { symbol:'POL',   ticker:'POL',   shares:200,  avgCost:639.18, name:'Pakistan Oilfields',sector:'Oil & Gas'    },
  { symbol:'SYS',   ticker:'SYS',   shares:750,  avgCost:137.25, name:'Systems Ltd',       sector:'Technology'   },
];

export async function getHoldings(): Promise<Holding[]> {
  try {
    const rows = await prisma.holding.findMany({
      where: { shares: { gt: 0 } },
      orderBy: { ticker: 'asc' },
    });

    if (rows.length === 0) {
      logger.warn('No holdings in DB — using fallback portfolio');
      return FALLBACK_PORTFOLIO;
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
    logger.error({ err }, 'DB read failed — using fallback portfolio');
    return FALLBACK_PORTFOLIO;
  }
}

export async function saveRunLog(data: {
  runId: string; runAt: Date; durationMs: number; tickersAnalysed: number;
  portfolioValue: number; unrealisedPl: number; alertCount: number;
  aiAccuracyRating: number; circuitBreakerActive: boolean; signals: Record<string, number>;
  errors: string[];
}): Promise<void> {
  try {
    await prisma.runLog.create({
      data: {
        runId:               data.runId,
        runAt:               data.runAt,
        durationMs:          data.durationMs,
        tickersAnalysed:     data.tickersAnalysed,
        portfolioValue:      data.portfolioValue,
        unrealisedPl:        data.unrealisedPl,
        alertCount:          data.alertCount,
        aiAccuracyRating:    data.aiAccuracyRating,
        circuitBreakerActive: data.circuitBreakerActive,
        signals:             data.signals,
        errors:              data.errors,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to save run log — non-fatal');
  }
}
