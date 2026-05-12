import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import pRetry from 'p-retry';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { SYSTEM_PROMPT, buildPrompt } from './prompt-builder';
import type { RunOutput, AiReviewResult, AiStockReview, AiValidation, Confidence, Signal } from '../types';

function cleanRaw(raw: string): string {
  return raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function tryFixJson(input: string): string {
  let s = input;

  // Cut at last complete closing brace
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace !== -1) {
    s = s.slice(0, lastBrace + 1);
  }

  return s;
}

function extractArray(raw: string, key: string): unknown[] {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*\\[(.*?)\\]`, 's'));
  if (!match) return [];

  const arrStr = `[${match[1]}]`;

  try {
    return JSON.parse(arrStr);
  } catch {
    return [];
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  const clean = cleanRaw(raw);

  try {
    return JSON.parse(clean);
  } catch {
    try {
      const repaired = tryFixJson(clean);
      const parsed = JSON.parse(repaired);
      logger.warn('Recovered truncated AI JSON');
      return parsed;
    } catch {
      logger.warn('Full JSON parse failed, attempting partial extraction');
      return null;
    }
  }
}

function parseReview(raw: string, runId: string): AiReviewResult {
  const parsed = safeParse(raw);
  const clean = cleanRaw(raw);

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
      keyRisks:             Array.isArray(r.key_risks) ? r.key_risks as string[] : [],
      keyCatalysts:         Array.isArray(r.key_catalysts) ? r.key_catalysts as string[] : [],
      buyPriceView:         r.buy_price_view != null ? Number(r.buy_price_view) : null,
      sellPriceView:        r.sell_price_view != null ? Number(r.sell_price_view) : null,
      stopLossView:         r.stop_loss_view != null ? Number(r.stop_loss_view) : null,
      shariahNote:          r.shariah_note ? String(r.shariah_note) : null,
      suggestedReplacement: r.suggested_replacement ? String(r.suggested_replacement) : undefined,
    };
  });

  if (parsed) {
  return {
    runId,
    timestamp:            String(parsed.timestamp ?? new Date().toISOString()),
    marketStance:         (parsed.market_stance as AiReviewResult['marketStance']) ?? 'neutral',
    marketSummary:        String(parsed.market_summary ?? ''),
    keyMarketDrivers:     Array.isArray(parsed.key_market_drivers) ? parsed.key_market_drivers as string[] : [],
    portfolioReview:      mapReview((parsed.portfolio_review as unknown[]) ?? []),
    discoveryReview:      mapReview((parsed.discovery_review as unknown[]) ?? []),
    sectorOutlook:        (parsed.sector_outlook as Record<string,string>) ?? {},
    concentrationRisks:   (parsed.concentration_risks as string[]) ?? [],
    macroRisks:           (parsed.macro_risks as string[]) ?? [],
    macroOpportunities:   (parsed.macro_opportunities as string[]) ?? [],
    algorithmScore:       Number(parsed.algorithm_score ?? 5),
    algorithmFeedback:    String(parsed.algorithm_feedback ?? ''),
    globalRiskFlags:      (parsed.global_risk_flags as string[]) ?? [],
    notificationHeadline: String(parsed.notification_headline ?? 'PSX Analysis Complete'),
    emailSubject:         String(parsed.email_subject ?? `PSX Analysis — ${new Date().toDateString()}`),
  };
}

  const portfolio = extractArray(clean, 'portfolio_review');
  const discovery = extractArray(clean, 'discovery_review');

  if (portfolio.length > 0 || discovery.length > 0) {
  logger.warn({
    portfolio: portfolio.length,
    discovery: discovery.length,
  }, 'Using partially recovered AI data');

  return {
    runId,
    timestamp: new Date().toISOString(),
    marketStance: 'neutral',
    marketSummary: 'Partial AI response recovered.',
    keyMarketDrivers: [],
    portfolioReview: mapReview(portfolio),
    discoveryReview: mapReview(discovery),
    sectorOutlook: {},
    concentrationRisks: [],
    macroRisks: [],
    macroOpportunities: [],
    algorithmScore: 0,
    algorithmFeedback: 'Partial parse',
    globalRiskFlags: ['AI_PARTIAL_RECOVERY'],
    notificationHeadline: 'PSX Analysis — Partial AI data',
    emailSubject: `PSX Analysis — ${new Date().toDateString()} (Partial)`,
  };
}

logger.error({ preview: clean.slice(0, 200) }, 'AI non-JSON response');
return fallback(runId);
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
