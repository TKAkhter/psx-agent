import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pRetry from 'p-retry';

import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { SYSTEM_PROMPT, buildAnalysisPrompt } from './prompt-builder';
import type { RunOutput, AiReviewResult, AiPortfolioReview, AiDiscoveryReview, AiAlertCommentary } from '../types';

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseAiResponse(raw: string, runId: string): AiReviewResult {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    logger.error({ preview: cleaned.slice(0, 300) }, 'AI returned non-JSON — using fallback');
    return buildFallbackReview(runId, raw);
  }

  const portfolioReview: AiPortfolioReview[] =
    ((parsed.portfolio_review as unknown[]) ?? []).map((r) => {
      const p = r as Record<string, unknown>;
      return {
        ticker:                  String(p.ticker ?? ''),
        name:                    String(p.name ?? ''),
        algorithmSignal:         (p.algorithm_signal as AiPortfolioReview['algorithmSignal']) ?? 'HOLD',
        algorithmCompositeScore: Number(p.algorithm_composite_score ?? 0),
        aiValidation:            (p.ai_validation as AiPortfolioReview['aiValidation']) ?? 'AGREE',
        aiSuggestedSignal:       (p.ai_suggested_signal as AiPortfolioReview['aiSuggestedSignal']) ?? 'HOLD',
        confidence:              (p.confidence as AiPortfolioReview['confidence']) ?? 'Medium',
        reasoning:               String(p.reasoning ?? ''),
        shariahNote:             (p.shariah_note as string | null) ?? null,
        riskFlags:               (p.risk_flags as string[]) ?? [],
        upcomingCatalysts:       (p.upcoming_catalysts as string[]) ?? [],
        buyPriceView:            (p.buy_price_view as number | null) ?? null,
        sellPriceView:           (p.sell_price_view as number | null) ?? null,
        stopLossView:            (p.stop_loss_view as number | null) ?? null,
      };
    });

  const discoveryPicksReview: AiDiscoveryReview[] =
    ((parsed.discovery_picks_review as unknown[]) ?? []).map((r) => {
      const d = r as Record<string, unknown>;
      return {
        ticker:                String(d.ticker ?? ''),
        name:                  String(d.name ?? ''),
        aiEndorsement:         (d.ai_endorsement as AiDiscoveryReview['aiEndorsement']) ?? 'NEUTRAL',
        confidence:            (d.confidence as AiDiscoveryReview['confidence']) ?? 'Medium',
        reasoning:             String(d.reasoning ?? ''),
        sectorFitForPortfolio: String(d.sector_fit_for_portfolio ?? ''),
      };
    });

  const activeAlertsCommentary: AiAlertCommentary[] =
    ((parsed.active_alerts_commentary as unknown[]) ?? []).map((a) => {
      const c = a as Record<string, unknown>;
      return {
        ticker:                  String(c.ticker ?? ''),
        alertType:               String(c.alert_type ?? ''),
        aiActionRecommendation:  String(c.ai_action_recommendation ?? ''),
      };
    });

  const omv = (parsed.overall_market_view ?? {}) as Record<string, unknown>;
  const aar = (parsed.algorithm_accuracy_rating ?? {}) as Record<string, unknown>;
  const mo  = (parsed.macro_overlay ?? {}) as Record<string, unknown>;
  const sa  = (parsed.sector_analysis ?? {}) as Record<string, unknown>;

  return {
    runId,
    analysisTimestamp:       String(parsed.analysis_timestamp ?? new Date().toISOString()),
    overallMarketView: {
      stance:     (omv.stance as AiReviewResult['overallMarketView']['stance']) ?? 'neutral',
      summary:    String(omv.summary ?? ''),
      keyDrivers: (omv.key_drivers as string[]) ?? [],
    },
    algorithmAccuracyRating: {
      score:        Number(aar.score ?? 5),
      rationale:    String(aar.rationale ?? ''),
      strongAreas:  (aar.strong_areas as string[]) ?? [],
      weakAreas:    (aar.weak_areas as string[]) ?? [],
    },
    macroOverlay: {
      pkrUsdView:        String(mo.pkr_usd_view ?? ''),
      sbpRateView:       String(mo.sbp_rate_view ?? ''),
      commodityImpact:   String(mo.commodity_impact ?? ''),
      imfRisk:           String(mo.imf_risk ?? ''),
      overallMacroScore: Number(mo.overall_macro_score ?? 0),
    },
    portfolioReview,
    discoveryPicksReview,
    sectorAnalysis: {
      concentrationWarnings:  (sa.concentration_warnings as string[]) ?? [],
      rebalancingSuggestions: (sa.rebalancing_suggestions as string[]) ?? [],
      sectorMacroOutlook:     ((sa.sector_macro_outlook as Record<string, string>) ?? {}),
    },
    activeAlertsCommentary,
    globalRiskFlags:      (parsed.global_risk_flags as string[]) ?? [],
    notificationHeadline: String(parsed.notification_headline ?? 'PSX Analysis Complete'),
    emailSubjectLine:     String(parsed.email_subject_line ?? `PSX Analysis — ${new Date().toDateString()}`),
  };
}

function buildFallbackReview(runId: string, rawText: string): AiReviewResult {
  return {
    runId,
    analysisTimestamp:       new Date().toISOString(),
    overallMarketView:       { stance: 'neutral', summary: 'AI review unavailable.', keyDrivers: [] },
    algorithmAccuracyRating: { score: 0, rationale: 'Parse error', strongAreas: [], weakAreas: [] },
    macroOverlay:            { pkrUsdView: '', sbpRateView: '', commodityImpact: '', imfRisk: '', overallMacroScore: 0 },
    portfolioReview:         [],
    discoveryPicksReview:    [],
    sectorAnalysis:          { concentrationWarnings: [], rebalancingSuggestions: [], sectorMacroOutlook: {} },
    activeAlertsCommentary:  [],
    globalRiskFlags:         ['AI_REVIEW_PARSE_ERROR'],
    notificationHeadline:    'PSX Analysis — AI review unavailable',
    emailSubjectLine:        `PSX Analysis — ${new Date().toDateString()} — AI error`,
  };
}

// ─── Model Callers ────────────────────────────────────────────────────────────

async function callClaude(userPrompt: string): Promise<string> {
  const client   = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model:       'claude-opus-4-5',
    max_tokens:  CONFIG.AI_MAX_TOKENS,
    temperature: CONFIG.AI_MODEL_TEMP,
    system:      SYSTEM_PROMPT,
    messages:    [{ role: 'user', content: userPrompt }],
  });
  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Claude returned non-text block');
  return block.text;
}

async function callGpt4o(userPrompt: string): Promise<string> {
  const client   = new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model:           'gpt-4o',
    max_tokens:      CONFIG.AI_MAX_TOKENS,
    temperature:     CONFIG.AI_MODEL_TEMP,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

async function callGemini(userPrompt: string): Promise<string> {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
    generationConfig: {
      maxOutputTokens:  CONFIG.AI_MAX_TOKENS,
      temperature:      CONFIG.AI_MODEL_TEMP,
      responseMimeType: 'application/json',
    },
  };
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0].content.parts.map((p) => p.text).join('');
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runAiReview(output: RunOutput): Promise<AiReviewResult> {
  const userPrompt = buildAnalysisPrompt(output);
  logger.info({ model: CONFIG.AI_MODEL, promptChars: userPrompt.length }, 'Calling AI model');

  const rawText = await pRetry(
    async () => {
      switch (CONFIG.AI_MODEL) {
        case 'claude': return callClaude(userPrompt);
        case 'gpt4o':  return callGpt4o(userPrompt);
        case 'gemini': return callGemini(userPrompt);
        default:       throw new Error(`Unknown AI_MODEL: ${CONFIG.AI_MODEL}`);
      }
    },
    {
      retries:     2,
      minTimeout:  5_000,
      onFailedAttempt: (err) =>
        logger.warn({ attempt: err.attemptNumber, msg: err.message }, 'AI call failed — retrying'),
    },
  );

  const result = parseAiResponse(rawText, output.runId);

  // Apply overrides back into the portfolio recommendations
  for (const review of result.portfolioReview) {
    const rec = output.portfolioRecommendations.find((r) => r.ticker === review.ticker);
    if (!rec) continue;
    if (review.aiValidation === 'DISAGREE') {
      logger.info(
        { ticker: rec.ticker, from: rec.signal, to: review.aiSuggestedSignal },
        'AI override applied',
      );
      rec.signal = review.aiSuggestedSignal;
      rec.flags.push('AI_OVERRIDE');
    } else if (review.aiValidation === 'PARTIALLY_AGREE') {
      rec.flags.push('AI_CAUTION');
    }
  }

  logger.info({ aiScore: result.algorithmAccuracyRating.score }, 'AI review complete');
  return result;
}
