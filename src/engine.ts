import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';

import { CONFIG } from './config';
import { logger } from './utils/logger';
import { round, signalLabel } from './utils/helpers';

// Ingestion
import { fetchTickerData, fetchFundamentals, fetchMacroSnapshot } from './ingestion/psxterminal-client';
import { fetchAllNews, buildSentiment } from './ingestion/news-fetcher';

// Preprocessing
import { passesFilter, isShariahCompliant } from './preprocessing/shariah-filter';
import { assessQuality, forwardFill } from './preprocessing/data-quality';

// Analysis
import { computeTechnicalIndicators } from './analysis/technical-indicators';
import { generateSignals } from './analysis/signal-engine';

// Scoring
import { computeCompositeScore, computePriceTargets, computePositionSizing, buildSignalLabel } from './scoring/composite-scorer';
import { evaluateAlerts, computeSectorConcentration, isCircuitBreakerActive, suggestReplacement } from './scoring/alert-evaluator';

// AI
import { runAiReview } from './ai-review/ai-client';

// Notifications
import { dispatchNotifications } from './notifications/dispatcher';

// DB
import { getHoldings, saveRunLog } from './db/portfolio-repository';
import { disconnectDb } from './db/prisma-client';

import type {
  Holding, StockRecommendation, PortfolioPosition,
  RunOutput, NewsArticle, MacroSnapshot,
} from './types';

// ─── Analyse one ticker ───────────────────────────────────────────────────────

async function analyseTicker(
  ticker:              string,
  holding:             Holding | undefined,
  allNews:             NewsArticle[],
  macro:               MacroSnapshot,
  totalPortfolioValue: number,
  circuitBreaker:      boolean,
): Promise<StockRecommendation | null> {
  try {
    // Market data
    let marketData = await fetchTickerData(ticker);
    const quality  = assessQuality(marketData);

    if (!quality.valid) {
      logger.warn({ ticker, flags: quality.flags }, 'Skipping — quality gate');
      return null;
    }
    if (quality.warnings.length > 0) marketData = forwardFill(marketData);

    // Technical analysis
    const technicals   = computeTechnicalIndicators(marketData.candles);
    const signalResult = generateSignals(technicals, circuitBreaker);

    // Fundamentals & sentiment
    const fundamentals = await fetchFundamentals(ticker);
    const sentiment    = buildSentiment(ticker, allNews);

    // Composite scoring
    const compositeScore = computeCompositeScore(signalResult, sentiment, fundamentals, macro);
    const priceTargets   = computePriceTargets(technicals, fundamentals, marketData.currentPrice, holding?.avgCost);
    const positionSizing = computePositionSizing(priceTargets, totalPortfolioValue);

    // Portfolio position enrichment
    let position: PortfolioPosition | undefined;
    if (holding) {
      const marketValue    = marketData.currentPrice * holding.shares;
      const costBasis      = holding.avgCost * holding.shares;
      const unrealisedPlPkr = marketValue - costBasis;
      const unrealisedPlPct = ((marketData.currentPrice - holding.avgCost) / holding.avgCost) * 100;
      const portfolioWeightPct = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;

      position = {
        ...holding,
        currentPrice:       marketData.currentPrice,
        marketValue:        round(marketValue),
        costBasis:          round(costBasis),
        unrealisedPlPkr:    round(unrealisedPlPkr),
        unrealisedPlPct:    round(unrealisedPlPct),
        portfolioWeightPct: round(portfolioWeightPct),
        shariah:            isShariahCompliant(ticker),
      };
    }

    const flags: string[] = [...quality.flags, ...quality.warnings];
    if (circuitBreaker && (signalResult.overallSignal === 'BUY' || signalResult.overallSignal === 'STRONG_BUY')) {
      flags.push('CIRCUIT_BREAKER_PAUSED');
    }

    return {
      ticker,
      name:         holding?.name ?? marketData.name,
      sector:       holding?.sector ?? marketData.sector,
      shariah:      isShariahCompliant(ticker),
      currentPrice: marketData.currentPrice,
      dayChangePct: marketData.dayChangePct,
      signal:       signalResult.overallSignal,
      signalLabel:  buildSignalLabel(signalResult.overallSignal, compositeScore.composite),
      compositeScore,
      priceTargets,
      positionSizing,
      technicals,
      signalResult,
      fundamentals,
      sentiment,
      flags,
      position,
    };
  } catch (err) {
    logger.error({ ticker, err }, 'analyseTicker failed');
    return null;
  }
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export async function runAnalysisEngine(): Promise<RunOutput> {
  const runId = uuidv4();
  const runAt = new Date();
  const t0    = Date.now();
  logger.info({ runId }, '=== PSX Analysis Engine v2 Starting ===');

  // Config snapshot
  const config = {
    shariahMode: CONFIG.SHARIAH_MODE,
    indexFilter: CONFIG.INDEX_FILTER,
    aiModel:     CONFIG.AI_MODEL,
    weights:     CONFIG.WEIGHTS as unknown as Record<string, number>,
  };

  // Layer 1: parallel ingestion ─────────────────────────────────────────────
  logger.info('Layer 1 — ingesting data');
  const [allNews, macro, holdings] = await Promise.all([
    fetchAllNews(),
    fetchMacroSnapshot(),
    getHoldings(),
  ]);

  const filteredHoldings = holdings.filter(h => passesFilter(h.ticker, CONFIG.SHARIAH_MODE));
  logger.info({ total: holdings.length, filtered: filteredHoldings.length }, 'Holdings loaded');

  // Layer 2: circuit breaker ────────────────────────────────────────────────
  const circuitBreakerActive = isCircuitBreakerActive(macro.kse100ChangePct);
  if (circuitBreakerActive) {
    logger.warn({ change: macro.kse100ChangePct }, 'CIRCUIT BREAKER ACTIVE');
  }

  // Rough portfolio value for initial sizing
  const roughValue = filteredHoldings.reduce((s, h) => s + h.avgCost * h.shares, 0);

  // Layer 3–4: analyse portfolio ─────────────────────────────────────────────
  logger.info('Layers 3–4 — analysing portfolio');
  const limit = pLimit(5);

  const portResults = await Promise.all(
    filteredHoldings.map(h =>
      limit(() => analyseTicker(h.ticker, h, allNews, macro, roughValue, circuitBreakerActive))
    )
  );
  const portfolioRecs = portResults.filter((r): r is StockRecommendation => r !== null);

  // Recompute with live prices
  const totalPortfolioValue = portfolioRecs.reduce(
    (s, r) => s + (r.position ? r.currentPrice * r.position.shares : 0), 0
  );
  const totalCostBasis = portfolioRecs.reduce(
    (s, r) => s + (r.position ? r.position.costBasis : 0), 0
  );
  const totalUnrealisedPl    = portfolioRecs.reduce((s, r) => s + (r.position?.unrealisedPlPkr ?? 0), 0);
  const totalUnrealisedPlPct = totalCostBasis > 0 ? (totalUnrealisedPl / totalCostBasis) * 100 : 0;

  // Discovery engine ─────────────────────────────────────────────────────────
  logger.info('Discovery — scanning KSE-100 universe');
  const portfolioTickers = new Set(filteredHoldings.map(h => h.ticker));
  const discoveryUniverse = CONFIG.KSE100_UNIVERSE.filter(
    t => !portfolioTickers.has(t) && passesFilter(t, CONFIG.SHARIAH_MODE)
  );

  const discResults = await Promise.all(
    discoveryUniverse.map(t =>
      limit(() => analyseTicker(t, undefined, allNews, macro, totalPortfolioValue, circuitBreakerActive))
    )
  );

  const sectorCheck = computeSectorConcentration(portfolioRecs, totalPortfolioValue);

  const discoveryPicks = discResults
    .filter((r): r is StockRecommendation => r !== null)
    .filter(r => r.compositeScore.composite > 65)
    .filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY')
    .filter(r => r.priceTargets.riskRewardRatio >= 1.5)
    .filter(r => !r.flags.includes('ILLIQUID'))
    .filter(r => (sectorCheck[r.sector] ?? 0) < 35)
    .sort((a, b) => b.compositeScore.composite - a.compositeScore.composite)
    .slice(0, 10);

  logger.info({ count: discoveryPicks.length }, 'Discovery picks identified');

  // Alerts & sector ──────────────────────────────────────────────────────────
  const alerts = evaluateAlerts(portfolioRecs);
  const sectorConcentration = computeSectorConcentration(portfolioRecs, totalPortfolioValue);

  // Attach suggested replacements for SELL signals
  for (const rec of portfolioRecs) {
    if ((rec.signal === 'SELL' || rec.signal === 'STRONG_SELL') && !rec.suggestedReplacement) {
      rec.suggestedReplacement = suggestReplacement(rec.ticker, portfolioRecs, discoveryPicks);
    }
  }

  logger.info({ alertCount: alerts.length }, 'Alerts evaluated');

  // Build partial output for AI ──────────────────────────────────────────────
  const partialOutput: RunOutput = {
    runId, runAt, config, macro,
    portfolioRecs, discoveryPicks, alerts, sectorConcentration,
    aiReview: {} as RunOutput['aiReview'],
    circuitBreakerActive,
    totalPortfolioValue: round(totalPortfolioValue),
    totalCostBasis:      round(totalCostBasis),
    totalUnrealisedPl:   round(totalUnrealisedPl),
    totalUnrealisedPlPct: round(totalUnrealisedPlPct),
  };

  // Layer 5: AI review ───────────────────────────────────────────────────────
  logger.info('Layer 5 — AI review');
  const aiReview   = await runAiReview(partialOutput);
  const fullOutput = { ...partialOutput, aiReview };

  // Layer 7: notifications ───────────────────────────────────────────────────
  logger.info('Layer 7 — dispatching notifications');
  const deliveryLogs = await dispatchNotifications(fullOutput);

  // Layer 8: audit log ───────────────────────────────────────────────────────
  const durationMs = Date.now() - t0;
  const signalCounts = [...portfolioRecs, ...discoveryPicks].reduce<Record<string, number>>(
    (acc, r) => { acc[r.signal] = (acc[r.signal] ?? 0) + 1; return acc; }, {}
  );

  await saveRunLog({
    runId, runAt, durationMs,
    tickersAnalysed: portfolioRecs.length + discoveryPicks.length,
    portfolioValue:  totalPortfolioValue,
    unrealisedPl:    totalUnrealisedPl,
    alertCount:      alerts.length,
    aiAccuracyRating: aiReview.algorithmScore,
    circuitBreakerActive,
    signals:         signalCounts,
    errors:          deliveryLogs.filter(l => l.status === 'failed').map(l => l.error ?? 'unknown'),
  });

  logger.info({
    runId, durationMs,
    portfolioValue:  Math.round(totalPortfolioValue),
    unrealisedPl:    Math.round(totalUnrealisedPl),
    unrealisedPlPct: round(totalUnrealisedPlPct),
    alerts:          alerts.length,
    aiScore:         aiReview.algorithmScore,
    stance:          aiReview.marketStance,
    signals:         signalCounts,
    notifications:   deliveryLogs.map(l => ({ channel: l.channel, status: l.status })),
  }, '=== PSX Analysis Engine Complete ===');

  return fullOutput;
}
