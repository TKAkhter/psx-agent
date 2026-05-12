/**
 * PSX Analysis Engine v3
 *
 * Orchestrates all layers:
 *  1. Data ingestion (news, market data, macro)
 *  2. Portfolio load (MongoDB → seed defaults if empty)
 *  3. Technical + fundamental analysis per ticker
 *  4. Composite scoring + alert evaluation
 *  5. Discovery of new buy candidates
 *  6. AI review + signal overrides
 *  7. Notification dispatch (PDF → email + WhatsApp)
 *  8. Audit log to MongoDB
 */
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';

import { CONFIG } from './config';
import { logger, logPhase, logPhaseOk, logWarn, logSignal, logError } from './utils/logger';
import { round, formatDuration, formatPkrCompact, formatPct, buildNotificationSubject, signalEmoji } from './utils/helpers';

// Ingestion
import { fetchTickerData, fetchFundamentals, fetchMacroSnapshot, fetchMarketBreadth, fetchSectorPerformance } from './ingestion/psxterminal-client';
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
import { getHoldings, saveRunLog, savePriceSnapshots, getPriceHistory } from './db/portfolio-repository';
import { disconnectDb } from './db/prisma-client';

import type {
  Holding, StockRecommendation, PortfolioPosition, RunOutput, NewsArticle, MacroSnapshot,
} from './types';

const KSE100_UNIVERSE: string[] = [
  'MEBL','OGDC','HUBC','EFERT','ENGROH','FFC','LUCK','MARI','POL','SYS',
  'HBL','MCB','UBL','NBP','BAHL','PSO','PPL','ENGRO','DGKC','CHCC',
  'KAPCO','KEL','HCAR','PSMC','AGTL','MLCF','KOHC','PIOC','ACPL','FCCL',
];

// ─── Analyse one ticker ────────────────────────────────────────────────────────

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
      logWarn(`Skipping ${ticker}`, { flags: quality.flags });
      return null;
    }
    if (quality.warnings.length > 0) marketData = forwardFill(marketData);

    // Technical analysis
    const technicals   = computeTechnicalIndicators(marketData.candles);
    const signalResult = generateSignals(technicals, circuitBreaker);

    // Fundamentals (DB cache → live → stub)
    const fundamentals = await fetchFundamentals(ticker);

    // Sentiment from news
    const sentiment = buildSentiment(ticker, allNews);

    // DB price history for trend enrichment
    const history = await getPriceHistory(ticker, 10);
    if (history) {
      // Boost/penalise score slightly based on historical trend
      logger.debug({ ticker, histTrend: history.trend, avgScore: history.avgScore }, 'Using DB history');
    }

    // Composite scoring
    const compositeScore = computeCompositeScore(signalResult, sentiment, fundamentals, macro);
    const priceTargets   = computePriceTargets(technicals, fundamentals, marketData.currentPrice, holding?.avgCost);
    const positionSizing = computePositionSizing(priceTargets, totalPortfolioValue);

    // Portfolio enrichment
    let position: PortfolioPosition | undefined;
    if (holding) {
      const marketValue     = marketData.currentPrice * holding.shares;
      const costBasis       = holding.avgCost * holding.shares;
      const unrealisedPlPkr = marketValue - costBasis;
      const unrealisedPlPct = ((marketData.currentPrice - holding.avgCost) / holding.avgCost) * 100;
      position = {
        ...holding,
        currentPrice:       marketData.currentPrice,
        marketValue:        round(marketValue),
        costBasis:          round(costBasis),
        unrealisedPlPkr:    round(unrealisedPlPkr),
        unrealisedPlPct:    round(unrealisedPlPct),
        portfolioWeightPct: totalPortfolioValue > 0 ? round((marketValue / totalPortfolioValue) * 100) : 0,
        shariah:            isShariahCompliant(ticker),
      };
    }

    const flags: string[] = [...quality.flags];
    if (quality.warnings.length > 0)  flags.push(...quality.warnings);
    if (circuitBreaker && (signalResult.overallSignal === 'BUY' || signalResult.overallSignal === 'STRONG_BUY')) {
      flags.push('CIRCUIT_BREAKER_PAUSED');
    }
    if (history?.trend === 'down' && signalResult.overallSignal === 'BUY') {
      flags.push('HISTORICAL_DOWNTREND_CAUTION');
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
    logError(`Analysis failed for ${ticker}`, err);
    return null;
  }
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export async function runAnalysisEngine(): Promise<RunOutput> {
  const runId = uuidv4();
  const runAt = new Date();
  const t0    = Date.now();

  logger.info('');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  PSX Analyzer — Run ${runId.slice(0,8)}`);
  logger.info(`  ${runAt.toLocaleString('en-PK', { timeZone:'Asia/Karachi' })}`);
  logger.info('═══════════════════════════════════════════════════');

  const config = {
    shariahMode: CONFIG.SHARIAH_MODE,
    indexFilter: CONFIG.INDEX_FILTER,
    aiModel:     CONFIG.AI_MODEL,
    weights:     CONFIG.WEIGHTS as unknown as Record<string, number>,
  };

  // ── Layer 1: Ingest data ─────────────────────────────────────────────────
  logPhase('Data Ingestion');
  const [allNews, macro, holdings, marketBreadth, sectorPerformance] = await Promise.all([
    fetchAllNews(),
    fetchMacroSnapshot(),
    getHoldings(),
    fetchMarketBreadth(),
    fetchSectorPerformance(),
  ]);

  // Log market breadth context
  logger.info({
    advancers:  marketBreadth.advancers,
    decliners:  marketBreadth.decliners,
    adRatio:    marketBreadth.advanceDeclineRatio,
    newHighs:   marketBreadth.newHighs,
    newLows:    marketBreadth.newLows,
  }, 'Market breadth');

  // Log sector performance context
  const sortedSectors = [...sectorPerformance].sort((a, b) => b.dayChangePct - a.dayChangePct);
  logger.info({
    top: sortedSectors[0]?.sector,
    bot: sortedSectors[sortedSectors.length - 1]?.sector,
  }, 'Sector leaders/laggards');

  const filteredHoldings = holdings.filter(h => passesFilter(h.ticker, CONFIG.SHARIAH_MODE));
  logPhaseOk('Data Ingestion', {
    news:      allNews.length,
    holdings:  filteredHoldings.length,
    kse100:    `${macro.kse100Level.toLocaleString()} (${formatPct(macro.kse100ChangePct)})`,
    pkrUsd:    macro.pkrUsdOfficial,
    sbpRate:   `${macro.sbpPolicyRate}%`,
    fpi:       `${macro.fpiDirection} ${macro.fpiWeeklyMillion}M PKR/wk`,
    adRatio:   marketBreadth.advanceDeclineRatio,
  });

  // ── Circuit breaker ──────────────────────────────────────────────────────
  const circuitBreakerActive = isCircuitBreakerActive(macro.kse100ChangePct);
  if (circuitBreakerActive) {
    logWarn('CIRCUIT BREAKER ACTIVE', {
      kse100Change: `${formatPct(macro.kse100ChangePct)}`,
      action: 'All BUY signals paused',
    });
  }

  // Rough value for initial sizing
  const roughValue = filteredHoldings.reduce((s, h) => s + h.avgCost * h.shares, 0);

  // ── Layer 3–4: Portfolio analysis ────────────────────────────────────────
  logPhase('Portfolio Analysis', { tickers: filteredHoldings.map(h => h.ticker).join(', ') });
  const limit = pLimit(5);

  const portResults = await Promise.all(
    filteredHoldings.map(h =>
      limit(() => analyseTicker(h.ticker, h, allNews, macro, roughValue, circuitBreakerActive))
    )
  );
  const portfolioRecs = portResults.filter((r): r is StockRecommendation => r !== null);

  // Recalculate totals with live prices
  const totalPortfolioValue = portfolioRecs.reduce(
    (s, r) => s + (r.position ? r.currentPrice * r.position.shares : 0), 0
  );
  const totalCostBasis    = portfolioRecs.reduce((s, r) => s + (r.position?.costBasis ?? 0), 0);
  const totalUnrealisedPl = portfolioRecs.reduce((s, r) => s + (r.position?.unrealisedPlPkr ?? 0), 0);
  const totalUnrealisedPlPct = totalCostBasis > 0 ? (totalUnrealisedPl / totalCostBasis) * 100 : 0;

  // Log each portfolio signal
  logger.info('');
  logger.info('  PORTFOLIO SIGNALS:');
  for (const r of portfolioRecs) {
    const pos = r.position;
    const plStr = pos ? ` (P&L ${formatPct(pos.unrealisedPlPct)})` : '';
    logSignal(r.ticker, r.signal, r.compositeScore.composite, 'algo');
    logger.debug({ ticker: r.ticker, buyAt: r.priceTargets.aggressiveBuyAt, target1: r.priceTargets.target1, stopLoss: r.priceTargets.stopLoss, rr: r.priceTargets.riskRewardRatio }, '    └─ Targets');
  }
  logger.info('');
  logPhaseOk('Portfolio Analysis', {
    value:       formatPkrCompact(totalPortfolioValue),
    unrealisedPl: `${formatPct(totalUnrealisedPlPct)} (${formatPkrCompact(totalUnrealisedPl)})`,
  });

  // ── Discovery ────────────────────────────────────────────────────────────
  logPhase('Market Discovery', { universe: KSE100_UNIVERSE.length });
  const portfolioTickers = new Set(filteredHoldings.map(h => h.ticker));
  const discoveryUniverse = KSE100_UNIVERSE.filter(
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

  if (discoveryPicks.length > 0) {
    logger.info('  NEW BUY CANDIDATES:');
    for (const r of discoveryPicks.slice(0, 5)) {
      logSignal(r.ticker, r.signal, r.compositeScore.composite, 'algo');
    }
    logger.info('');
  }
  logPhaseOk('Market Discovery', { found: discoveryPicks.length });

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alerts = evaluateAlerts(portfolioRecs);
  const sectorConcentration = computeSectorConcentration(portfolioRecs, totalPortfolioValue);

  if (alerts.length > 0) {
    logWarn(`${alerts.filter(a=>a.severity==='CRITICAL').length} CRITICAL · ${alerts.filter(a=>a.severity==='WARNING').length} WARNING alerts`, {
      tickers: [...new Set(alerts.map(a => a.ticker))].join(', '),
    });
  }

  // Attach sell → replacement suggestions
  for (const rec of portfolioRecs) {
    if ((rec.signal === 'SELL' || rec.signal === 'STRONG_SELL') && !rec.suggestedReplacement) {
      rec.suggestedReplacement = suggestReplacement(rec.ticker, portfolioRecs, discoveryPicks);
    }
  }

  // ── Build counts for notification subject ─────────────────────────────────
  const buyCount  = portfolioRecs.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY').length;
  const sellCount = portfolioRecs.filter(r => r.signal === 'SELL' || r.signal === 'STRONG_SELL').length;
  const notifSubject = buildNotificationSubject(runAt, buyCount, sellCount, totalUnrealisedPlPct);

  // ── Partial output for AI ─────────────────────────────────────────────────
  const partialOutput: RunOutput = {
    runId, runAt, config, macro,
    portfolioRecs, discoveryPicks, alerts, sectorConcentration,
    aiReview: {} as RunOutput['aiReview'],
    circuitBreakerActive,
    totalPortfolioValue: round(totalPortfolioValue),
    totalCostBasis:      round(totalCostBasis),
    totalUnrealisedPl:   round(totalUnrealisedPl),
    totalUnrealisedPlPct: round(totalUnrealisedPlPct),
    notifSubject,
  };

  // ── AI review ────────────────────────────────────────────────────────────
  logPhase('AI Review', { model: CONFIG.AI_MODEL });
  const aiReview = await runAiReview(partialOutput);
  const fullOutput: RunOutput = { ...partialOutput, aiReview };

  // Log AI overrides
  const overrides = aiReview.portfolioReview.filter(r => r.aiValidation !== 'AGREE');
  if (overrides.length > 0) {
    logger.info('  AI OVERRIDES/CAUTIONS:');
    for (const r of overrides) {
      const rec = portfolioRecs.find(p => p.ticker === r.ticker);
      logger.info({ ticker: r.ticker, algo: r.algorithmSignal, ai: r.finalSignal, validation: r.aiValidation },
        `  ${r.aiValidation === 'DISAGREE' ? '🔄' : '⚠️ '} ${r.ticker.padEnd(8)} ${r.algorithmSignal} → ${r.finalSignal} (${r.aiValidation})`);
    }
    logger.info('');
  }
  logPhaseOk('AI Review', { score: `${aiReview.algorithmScore}/10`, stance: aiReview.marketStance });

  // ── Notifications ─────────────────────────────────────────────────────────
  logPhase('Notifications', { subject: notifSubject });
  const deliveryLogs = await dispatchNotifications(fullOutput);
  const sent   = deliveryLogs.filter(l => l.status === 'sent').length;
  const failed = deliveryLogs.filter(l => l.status === 'failed').length;
  logPhaseOk('Notifications', {
    sent,
    failed,
    channels: deliveryLogs.map(l => `${l.channel}:${l.status}`).join(', '),
  });

  // ── Save to DB ────────────────────────────────────────────────────────────
  logPhase('Saving to DB');
  const signalCounts = [...portfolioRecs, ...discoveryPicks].reduce<Record<string, number>>(
    (acc, r) => { acc[r.signal] = (acc[r.signal] ?? 0) + 1; return acc; }, {}
  );
  await Promise.all([
    saveRunLog({
      runId, runAt,
      durationMs:          Date.now() - t0,
      tickersAnalysed:     portfolioRecs.length + discoveryPicks.length,
      portfolioValue:      totalPortfolioValue,
      unrealisedPl:        totalUnrealisedPl,
      unrealisedPlPct:     totalUnrealisedPlPct,
      alertCount:          alerts.length,
      aiAccuracyRating:    aiReview.algorithmScore,
      circuitBreakerActive,
      signals:             signalCounts,
      topBuys:             portfolioRecs.filter(r=>r.signal.includes('BUY')).map(r=>r.ticker),
      topSells:            portfolioRecs.filter(r=>r.signal.includes('SELL')).map(r=>r.ticker),
      errors:              deliveryLogs.filter(l=>l.status==='failed').map(l=>l.error ?? 'unknown'),
    }),
    savePriceSnapshots([...portfolioRecs, ...discoveryPicks], runId),
  ]);
  logPhaseOk('Saving to DB');

  // ── Final summary ─────────────────────────────────────────────────────────
  const durationMs = Date.now() - t0;
  logger.info('');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  ✅ Run Complete — ${formatDuration(durationMs)}`);
  logger.info(`  Portfolio:  ${formatPkrCompact(totalPortfolioValue)}  P&L ${formatPct(totalUnrealisedPlPct)}`);
  logger.info(`  Signals:    ${Object.entries(signalCounts).map(([k,v])=>`${signalEmoji(k)}${k}×${v}`).join('  ')}`);
  logger.info(`  Alerts:     ${alerts.filter(a=>a.severity==='CRITICAL').length} critical · ${alerts.filter(a=>a.severity==='WARNING').length} warning`);
  logger.info(`  AI:         ${aiReview.marketStance.toUpperCase()} · accuracy ${aiReview.algorithmScore}/10`);
  logger.info(`  Delivery:   ${notifSubject}`);
  logger.info('═══════════════════════════════════════════════════');
  logger.info('');

  return fullOutput;
}
