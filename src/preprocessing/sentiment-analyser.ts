import { recencyDecay, weightedAverage } from '../utils/helpers';
import type { NewsArticle, SentimentResult } from '../types';

// ─── Sentiment Analyser ───────────────────────────────────────────────────────
// Uses lexicon-based scoring. In production, replace with a fine-tuned
// FinBERT model or a Pakistan-specific financial sentiment API.

const POSITIVE_TERMS = [
  'profit', 'gain', 'growth', 'surge', 'rally', 'bullish', 'record',
  'dividend', 'expansion', 'increase', 'strong', 'beat', 'exceed',
  'upgrade', 'recovery', 'breakthrough', 'positive', 'rise', 'soar',
  'investment', 'opportunity', 'outperform', 'robust', 'healthy', 'upbeat',
];

const NEGATIVE_TERMS = [
  'loss', 'decline', 'fall', 'drop', 'crash', 'bearish', 'deficit',
  'debt', 'decrease', 'weak', 'miss', 'downgrade', 'recession', 'crisis',
  'default', 'negative', 'plunge', 'collapse', 'risk', 'concern',
  'underperform', 'pressure', 'slowdown', 'cut', 'layoff', 'penalty',
];

const INTENSIFIERS = ['very', 'highly', 'extremely', 'significantly', 'sharply'];

function scoreSentence(sentence: string): number {
  const words = sentence.toLowerCase().split(/\s+/);
  let score = 0;
  let negated = false;
  let intensified = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-z]/g, '');
    if (['not', 'no', 'never', 'neither'].includes(word)) { negated = true; continue; }
    if (INTENSIFIERS.includes(word)) { intensified = true; continue; }

    let termScore = 0;
    if (POSITIVE_TERMS.includes(word)) termScore = 1;
    else if (NEGATIVE_TERMS.includes(word)) termScore = -1;

    if (termScore !== 0) {
      const multiplier = intensified ? 1.5 : 1;
      score += negated ? -termScore * multiplier : termScore * multiplier;
      negated = false;
      intensified = false;
    }
  }

  // Normalise to [-1, 1]
  return Math.max(-1, Math.min(1, score / 3));
}

function scoreArticle(article: NewsArticle): number {
  const text = `${article.headline} ${article.body}`;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  const scores = sentences.map(scoreSentence);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function analyseSentiment(
  ticker: string,
  articles: NewsArticle[]
): SentimentResult {
  const relevant = articles.filter(
    (a) => a.tickersMentioned.includes(ticker) || a.tickersMentioned.length === 0
  );

  const tickerSpecific = relevant.filter((a) => a.tickersMentioned.includes(ticker));
  const toScore = tickerSpecific.length >= 2 ? tickerSpecific : relevant.slice(0, 10);

  if (toScore.length === 0) {
    return { ticker, score: 0, articleCount: 0, confidence: 'low', articles: [] };
  }

  const scores = toScore.map(scoreArticle);
  const weights = toScore.map((a) => recencyDecay(a.publishedAt));
  const finalScore = weightedAverage(scores, weights);

  return {
    ticker,
    score: parseFloat(finalScore.toFixed(3)),
    articleCount: toScore.length,
    confidence: tickerSpecific.length >= 3 ? 'high' : 'low',
    articles: toScore.slice(0, 5).map((a) => ({
      headline: a.headline,
      source: a.source,
      publishedAt: a.publishedAt,
    })),
  };
}
