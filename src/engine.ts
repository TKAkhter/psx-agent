import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';

import { CONFIG } from './config';
import { logger } from './utils/logger';

// ── Ingestion ─────────────────────────────────────────────────────────────────
import { fetchNationalNews, fetchInternationalNews } from './ingestion/news-fetcher';
import { fetchTickerData, fetchMacroSnapshot, fetchFundamentals } from './ingestion/market-data-fetcher';

// ── Preprocessing ─────────────────────────────────────────────────────────────
import { analyseSentiment } from './preprocessing/sentiment-analyser';
import { passesShariahFilter, isShariahCompliant } from './preprocessing/shariah-filter';
import { assessDataQuality, forwardFillCandles } from './preprocessing/data-quality';

// ── Analysis ──────────────────────────────────────────────────────────────────
import { computeTechnicalIndicators } from './analysis/technical-indicators';
import { generateSignals } from './analysis/signal-engine';

// ── Scoring ───────────────────────────────────────────────────────────────────
import { computeCompositeScore, computePriceTargets, computePositionSizing } from './scoring/composite-scorer';
import { evaluateAlerts, computeSectorConcentration, isCircuitBreakerActive } from './scoring/alert-evaluator';

// ── AI Review ─────────────────────────────────────────────────────────────────
import { runAiReview } from './ai-review/ai-client';

// ── Notifications ─────────────────────────────────────────────────────────────
import { dispatchNotifications } from './notifications/notification-dispatcher';

// ── DB ────────────────────────────────────────────────────────────────────────
import { PortfolioRepository } from './db/portfolio-repository';

import type {
  Holding, NewsArticle, MacroSnapshot,
  StockRecommendation, EnrichedHolding,
  RunOutput, ConfigSnapshot,
} from './types';

// ─── KSE-100 Discovery Universe ───────────────────────────────────────────────

const KSE100_UNIVERSE: string[] = [
  'MEBL', 'OGDC', 'HUBC', 'EFERT', 'ENGROH', 'FFC', 'LUCK', 'MARI', 'POL', 'SYS',
  'HBL',  'MCB',  'UBL',  'NBP',   'BAHL',  'PSO', 'PPL', 'ENGRO', 'DGKC', 'CHCC',
  'KAPCO','KEL',  'HCAR', 'PSMC',  'AGTL',  'MLCF','KOHC', 'PIOC', 'ACPL', 'FCCL',
];

// ─── Analyse One Ticker ───────────────────────────────────────────────────────

async function analyseOneTicker(
  ticker:              string,
  holding:             Holding | undefined,
  allNews:             NewsArticle[],
  macro:               MacroSnapshot,
  totalPortfolioValue: number,
  circuitBreakerOn:    boolean,
): Promise<StockRecommendation | null> {
  try {
    // Layer 1c: Market data
    let marketData = await fetchTickerData(ticker);

    // Layer 2d: Data quality gate
    const quality = assessDataQuality(marketData);
    if (!quality.valid) {
      logger.warn({ ticker, flags: quality.flags }, 'Skipping — data quality gate');
      return null;
    }
    if (quality.warnings.length > 0) {
      marketData = forwardFillCandles(marketData);
    }

    // Layer 3a–f: Technical analysis
    const technicals   = computeTechnicalIndicators(marketData.candles);

    // Layer 3g: Signal generation
    const signalResult = generateSignals(technicals, circuitBreakerOn);

    // Layer 1e: Fundamentals
    const fundamentals = await fetchFundamentals(ticker);

    // Layer 2a: Sentiment
    const sentiment = analyseSentiment(ticker, allNews);

    // Layer 4a: Composite scoring
    const compositeScore = computeCompositeScore(signalResult, sentiment, fundamentals, macro);

    // Layer 4b–c: Price targets
    const priceTargets = computePriceTargets(technicals, marketData.currentPrice, holding?.avgCost);

    // Layer 4d: Position sizing
    const positionSizing = computePositionSizing(priceTargets, totalPortfolioValue);

    // Layer 3h: Portfolio enrichment
    let enrichedHolding:    EnrichedHolding | undefined;
    let unrealisedPlPkr:    number | undefined;
    let unrealisedPlPct:    number | undefined;
    let portfolioWeightPct: number | undefined;

    if (holding) {
      unrealisedPlPkr    = (marketData.currentPrice - holding.avgCost) * holding.shares;
      unrealisedPlPct    = ((marketData.currentPrice - holding.avgCost) / holding.avgCost) * 100;
      const posValue     = marketData.currentPrice * holding.shares;
      portfolioWeightPct = totalPortfolioValue > 0 ? (posValue / totalPortfolioValue) * 100 : 0;

      enrichedHolding = {
        ...holding,
        currentPrice:       marketData.currentPrice,
        unrealisedPlPkr,
        unrealisedPlPct,
        positionValue:      posValue,
        portfolioWeightPct,
        shariah:            isShariahCompliant(ticker),
      };
    }

    const flags: string[] = [...quality.flags];
    if (quality.warnings.length > 0) flags.push(...quality.warnings);
    if (circuitBreakerOn && (signalResult.overallSignal === 'BUY' || signalResult.overallSignal === 'STRONG_BUY')) {
      flags.push('CIRCUIT_BREAKER_ACTIVE');
    }

    return {
      ticker,
      name:               holding?.name   ?? ticker,
      sector:             holding?.sector ?? 'Unknown',
      shariah:            isShariahCompliant(ticker),
      currentPrice:       marketData.currentPrice,
      signal:             signalResult.overallSignal,
      compositeScore,
      priceTargets,
      positionSizing,
      technicals,
      signalResult,
      fundamentals,
      sentiment,
      flags,
      holding:            enrichedHolding,
      unrealisedPlPkr,
      unrealisedPlPct,
      portfolioWeightPct,
    };
  } catch (err) {
    logger.error({ ticker, err }, 'analyseOneTicker failed');
    return null;
  }
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

export async function runAnalysisEngine(): Promise<RunOutput> {
  const runId  = uuidv4();
  const runAt  = new Date();
  const t0     = Date.now();

  logger.info({ runId, runMode: CONFIG.RUN_MODE }, '=== PSX Analysis Engine Starting ===');

  // ── Layer 0: Config snapshot ─────────────────────────────────────────────
  const config: ConfigSnapshot = {
    shariahMode: CONFIG.SHARIAH_MODE,
    indexFilter: CONFIG.INDEX_FILTER,
    runMode:     CONFIG.RUN_MODE,
    aiModel:     CONFIG.AI_MODEL,
    weights:     CONFIG.WEIGHTS,
  };

  // ── Layer 1: Parallel ingestion ──────────────────────────────────────────
  logger.info('Layer 1 — ingesting data');
  const [nationalNews, intlNews, macro] = await Promise.all([
    fetchNationalNews(),
    fetchInternationalNews(),
    fetchMacroSnapshot(),
  ]);
  const allNews = [...nationalNews, ...intlNews];
  logger.info(
    { national: nationalNews.length, intl: intlNews.length },
    'News ingested',
  );

  // ── Layer 2e: Circuit breaker ────────────────────────────────────────────
  const circuitBreakerActive = isCircuitBreakerActive(macro.kse100ChangePct);
  if (circuitBreakerActive) {
    logger.warn(
      { kse100ChangePct: macro.kse100ChangePct },
      'CIRCUIT BREAKER ACTIVE — BUY signals paused',
    );
  }

  // ── Load portfolio from DB ───────────────────────────────────────────────
  const repo     = new PortfolioRepository();
  const holdings = await repo.getHoldings();
  await repo.close();

  const filteredHoldings = holdings.filter(
    (h) => passesShariahFilter(h.ticker, CONFIG.SHARIAH_MODE),
  );
  logger.info(
    { total: holdings.length, afterFilter: filteredHoldings.length },
    'Portfolio loaded',
  );

  // Rough portfolio value using avgCost for initial sizing calcs
  const roughPortfolioValue = filteredHoldings.reduce(
    (sum, h) => sum + h.avgCost * h.shares,
    0,
  );

  // ── Layers 3–4: Analyse portfolio holdings ───────────────────────────────
  logger.info('Layers 3–4 — analysing portfolio holdings');
  const limit  = pLimit(5); // max 5 concurrent ticker analyses

  const portfolioResults = await Promise.all(
    filteredHoldings.map((h) =>
      limit(() =>
        analyseOneTicker(
          h.ticker, h, allNews, macro, roughPortfolioValue, circuitBreakerActive,
        ),
      ),
    ),
  );

  const portfolioRecommendations = portfolioResults.filter(
    (r): r is StockRecommendation => r !== null,
  );

  // Recompute totals with live prices
  const totalPortfolioValue = portfolioRecommendations.reduce(
    (sum, r) => sum + (r.holding ? r.currentPrice * r.holding.shares : 0),
    0,
  );
  const totalUnrealisedPl = portfolioRecommendations.reduce(
    (sum, r) => sum + (r.unrealisedPlPkr ?? 0),
    0,
  );

  // ── Discovery engine ─────────────────────────────────────────────────────
  let discoveryPicks: StockRecommendation[] = [];

  if (CONFIG.RUN_MODE === 'full' || CONFIG.RUN_MODE === 'discovery_only') {
    logger.info('Discovery — scanning KSE-100 universe');

    const portfolioTickers = new Set(filteredHoldings.map((h) => h.ticker));

    const universe = KSE100_UNIVERSE.filter(
      (t) =>
        !portfolioTickers.has(t) &&
        passesShariahFilter(t, CONFIG.SHARIAH_MODE),
    );

    const discoveryResults = await Promise.all(
      universe.map((ticker) =>
        limit(() =>
          analyseOneTicker(
            ticker, undefined, allNews, macro, totalPortfolioValue, circuitBreakerActive,
          ),
        ),
      ),
    );

    const sectorCheck = computeSectorConcentration(
      portfolioRecommendations,
      totalPortfolioValue,
    );

    discoveryPicks = discoveryResults
      .filter((r): r is StockRecommendation => r !== null)
      .filter((r) => r.compositeScore.composite > 65)
      .filter((r) => r.signal === 'BUY' || r.signal === 'STRONG_BUY')
      .filter((r) => r.priceTargets.riskRewardRatio >= 1.5)
      .filter((r) => !r.flags.includes('ILLIQUID'))
      .filter((r) => (sectorCheck[r.sector] ?? 0) < 35)
      .sort((a, b) => b.compositeScore.composite - a.compositeScore.composite)
      .slice(0, 10);

    logger.info({ count: discoveryPicks.length }, 'Discovery picks found');
  }

  // ── Layer 4b: Alerts ─────────────────────────────────────────────────────
  const alerts = evaluateAlerts(portfolioRecommendations);
  const sectorConcentration = computeSectorConcentration(
    portfolioRecommendations,
    totalPortfolioValue,
  );
  logger.info({ alertCount: alerts.length }, 'Alerts evaluated');

  // ── Build partial output for AI prompt ──────────────────────────────────
  const partialOutput: RunOutput = {
    runId,
    runAt,
    config,
    macroSnapshot:            macro,
    portfolioRecommendations,
    discoveryPicks,
    alerts,
    sectorConcentration,
    aiReview:                 {} as RunOutput['aiReview'], // filled below
    circuitBreakerActive,
    totalPortfolioValue,
    totalUnrealisedPl,
  };

  // ── Layer 5: AI review ───────────────────────────────────────────────────
  logger.info('Layer 5 — running AI review');
  const aiReview = await runAiReview(partialOutput);
  const fullOutput: RunOutput = { ...partialOutput, aiReview };

  // ── Layer 7: Notifications ───────────────────────────────────────────────
  logger.info('Layer 7 — dispatching notifications');
  const deliveryLogs = await dispatchNotifications(fullOutput);

  // ── Layer 8: Audit log ───────────────────────────────────────────────────
  const signalCounts = [...portfolioRecommendations, ...discoveryPicks].reduce<
    Record<string, number>
  >((acc, r) => {
    acc[r.signal] = (acc[r.signal] ?? 0) + 1;
    return acc;
  }, {});

  logger.info(
    {
      runId,
      durationMs:          Date.now() - t0,
      tickersAnalysed:     portfolioRecommendations.length + discoveryPicks.length,
      signals:             signalCounts,
      alerts:              alerts.length,
      circuitBreakerActive,
      aiAccuracyRating:    aiReview.algorithmAccuracyRating.score,
      totalPortfolioValue: Math.round(totalPortfolioValue),
      totalUnrealisedPl:   Math.round(totalUnrealisedPl),
      notifications:       deliveryLogs.map((l) => ({
        channel: l.channel, status: l.status,
      })),
    },
    '=== PSX Analysis Engine Complete ===',
  );

  return fullOutput;
}
