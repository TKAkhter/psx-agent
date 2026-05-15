import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pRetry from 'p-retry';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { SYSTEM_PROMPT, buildPrompt } from './prompt-builder';
import type { RunOutput, AiReviewResult, AiStockReview, AiValidation, Confidence, Signal } from '../types';

function parseReview(raw: string, runId: string): AiReviewResult {
  const clean = raw.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
  let p: Record<string, unknown>;
  try { p = JSON.parse(clean) as Record<string, unknown>; }
  catch { logger.error({ preview: clean.slice(0,200) }, 'AI non-JSON response'); return fallback(runId); }

  const mapReview = (arr: unknown[]): AiStockReview[] => arr.map((x) => {
    const r = x as Record<string, unknown>;
    return {
      ticker:               String(r.ticker ?? ''),
      name:                 String(r.name ?? ''),
      algorithmSignal:      (r.algorithm_signal as Signal) ?? 'HOLD',
      algorithmScore:       Number(r.algorithm_score ?? 0),
      aiValidation:         (r.ai_validation as AiValidation) ?? 'AGREE',
      finalSignal:          (r.final_signal as Signal) ?? 'HOLD',
      confidence:           (r.confidence as Confidence) ?? 'Medium',
      reasoning:            String(r.reasoning ?? ''),
      keyRisks:             (r.key_risks as string[]) ?? [],
      keyCatalysts:         (r.key_catalysts as string[]) ?? [],
      buyPriceView:         r.buy_price_view != null ? Number(r.buy_price_view) : null,
      sellPriceView:        r.sell_price_view != null ? Number(r.sell_price_view) : null,
      stopLossView:         r.stop_loss_view != null ? Number(r.stop_loss_view) : null,
      shariahNote:          r.shariah_note ? String(r.shariah_note) : null,
      suggestedReplacement: r.suggested_replacement ? String(r.suggested_replacement) : undefined,
    };
  });

  return {
    runId,
    timestamp:            String(p.timestamp ?? new Date().toISOString()),
    marketStance:         (p.market_stance as AiReviewResult['marketStance']) ?? 'neutral',
    marketSummary:        String(p.market_summary ?? ''),
    keyMarketDrivers:     (p.key_market_drivers as string[]) ?? [],
    portfolioReview:      mapReview((p.portfolio_review as unknown[]) ?? []),
    discoveryReview:      mapReview((p.discovery_review as unknown[]) ?? []),
    sectorOutlook:        (p.sector_outlook as Record<string,string>) ?? {},
    concentrationRisks:   (p.concentration_risks as string[]) ?? [],
    macroRisks:           (p.macro_risks as string[]) ?? [],
    macroOpportunities:   (p.macro_opportunities as string[]) ?? [],
    algorithmScore:       Number(p.algorithm_score ?? 5),
    algorithmFeedback:    String(p.algorithm_feedback ?? ''),
    globalRiskFlags:      (p.global_risk_flags as string[]) ?? [],
    notificationHeadline: String(p.notification_headline ?? 'PSX Analysis Complete'),
    emailSubject:         String(p.email_subject ?? `PSX Analysis — ${new Date().toDateString()}`),
  };
}

function fallback(runId: string): AiReviewResult {
  return {
    runId, timestamp: new Date().toISOString(),
    marketStance: 'neutral', marketSummary: 'AI review unavailable.',
    keyMarketDrivers: [], portfolioReview: [], discoveryReview: [],
    sectorOutlook: {}, concentrationRisks: [], macroRisks: [], macroOpportunities: [],
    algorithmScore: 0, algorithmFeedback: 'Parse error',
    globalRiskFlags: ['AI_REVIEW_ERROR'],
    notificationHeadline: 'PSX Analysis — AI review error',
    emailSubject: `PSX Analysis — ${new Date().toDateString()} — AI error`,
  };
}

async function callClaude(prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-opus-4-5', max_tokens: CONFIG.AI_MAX_TOKENS,
    temperature: CONFIG.AI_MODEL_TEMP,
    system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }],
  });
  const b = res.content[0];
  if (b.type !== 'text') throw new Error('Non-text block from Claude');
  return b.text;
}

async function callGpt4o(prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: 'gpt-4o', max_tokens: CONFIG.AI_MAX_TOKENS, temperature: CONFIG.AI_MODEL_TEMP,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
  });
  return res.choices[0]?.message?.content ?? '';
}

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }],
    generationConfig: { maxOutputTokens: CONFIG.AI_MAX_TOKENS, temperature: CONFIG.AI_MODEL_TEMP, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return data.candidates[0].content.parts.map(p=>p.text).join('');
}

export async function runAiReview(output: RunOutput): Promise<AiReviewResult> {
  const prompt = buildPrompt(output);
  logger.info({ model: CONFIG.AI_MODEL, chars: prompt.length }, 'Calling AI model');

  const raw = await pRetry(
    () => {
      switch (CONFIG.AI_MODEL) {
        case 'claude': return callClaude(prompt);
        case 'gpt4o':  return callGpt4o(prompt);
        case 'gemini': return callGemini(prompt);
        default: throw new Error(`Unknown AI_MODEL: ${CONFIG.AI_MODEL}`);
      }
    },
    { retries: 2, minTimeout: 5_000, onFailedAttempt: e => logger.warn({ attempt: e.attemptNumber }, 'AI retry') },
  );

  const result = parseReview(raw, output.runId);

  // Apply AI overrides back to portfolio recommendations
  for (const review of result.portfolioReview) {
    const rec = output.portfolioRecs.find(r => r.ticker === review.ticker);
    if (!rec) continue;
    if (review.aiValidation === 'DISAGREE') {
      logger.info({ ticker: rec.ticker, from: rec.signal, to: review.finalSignal }, 'AI override');
      rec.signal = review.finalSignal;
      rec.flags.push('AI_OVERRIDE');
    } else if (review.aiValidation === 'PARTIALLY_AGREE') {
      rec.flags.push('AI_CAUTION');
    }
    if (review.suggestedReplacement) {
      rec.suggestedReplacement = review.suggestedReplacement;
    }
  }

  logger.info({ score: result.algorithmScore, stance: result.marketStance }, 'AI review complete');
  return result;
}
