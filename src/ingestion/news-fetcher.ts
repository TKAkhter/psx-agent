import RssParser from 'rss-parser';
import { logger } from '../utils/logger';
import { recencyDecay } from '../utils/helpers';
import type { NewsArticle } from '../types';

const RSS = new RssParser({ timeout: 20_000 });

const NATIONAL_FEEDS = [
  'https://profit.pakistantoday.com.pk/feed/',
  'https://businessrecorder.com/feed/',
  'https://www.thenews.com.pk/rss/2/7',   // business section
  'https://arynews.net/tag/business/feed/',
];
const INTL_FEEDS = [
  'https://feeds.reuters.com/reuters/PKbusinessNews',
  'https://rss.ft.com/rss/home/emerging-markets',
];

const TICKER_MAP: Record<string, string[]> = {
  MEBL:['meezan bank','meezan'],OGDC:['ogdcl','oil and gas development'],
  HUBC:['hub power','hubco'],EFERT:['engro fertilizer','engro fertilizers'],
  ENGROH:['engro holdings','engro corp'],FFC:['fauji fertilizer','fauji'],
  LUCK:['lucky cement'],MARI:['mari petroleum','mari gas'],
  POL:['pakistan oilfields'],SYS:['systems limited','systems ltd'],
  HBL:['habib bank'],MCB:['mcb bank'],UBL:['united bank'],NBP:['national bank'],
  PSO:['pakistan state oil'],PPL:['pakistan petroleum'],
  ENGRO:['engro corporation'],SBP:['state bank of pakistan','central bank'],
};
const POSITIVE = ['profit','gain','growth','surge','rally','bullish','record','dividend','expansion','increase','strong','beat','exceed','upgrade','recovery','upbeat','rise','soar','opportunity','outperform','robust','healthy'];
const NEGATIVE = ['loss','decline','fall','drop','crash','bearish','deficit','debt','decrease','weak','miss','downgrade','recession','crisis','default','negative','plunge','collapse','risk','concern','underperform','pressure','slowdown','cut','penalty'];
const INTENSIFIERS = ['very','highly','extremely','significantly','sharply'];

function extractTickers(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(TICKER_MAP)
    .filter(([t, aliases]) => lower.includes(t.toLowerCase()) || aliases.some(a => lower.includes(a)))
    .map(([t]) => t);
}

function scoreText(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  let score = 0; let negated = false; let amp = 1;
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g,'');
    if (['not','no','never','without'].includes(clean)) { negated = true; continue; }
    if (INTENSIFIERS.includes(clean)) { amp = 1.5; continue; }
    let pts = POSITIVE.includes(clean) ? 1 : NEGATIVE.includes(clean) ? -1 : 0;
    if (pts) { score += (negated ? -pts : pts) * amp; negated = false; amp = 1; }
  }
  return Math.max(-1, Math.min(1, score / 4));
}

function categorise(text: string): NewsArticle['category'] {
  const t = text.toLowerCase();
  if (/crude|oil|gas|coal|lng|fertiliz|commodity|urea/.test(t)) return 'commodity';
  if (/secp|regulation|policy|government|law|ordinance/.test(t)) return 'regulatory';
  if (/imf|sbp|inflation|gdp|budget|rupee|pkr|interest rate|fiscal/.test(t)) return 'economy';
  if (/results|earnings|dividend|profit|revenue|quarterly|annual report/.test(t)) return 'corporate';
  if (/prime minister|parliament|election|minister|geopolitical/.test(t)) return 'political';
  return 'general';
}

async function parseFeed(url: string): Promise<NewsArticle[]> {
  try {
    const feed = await RSS.parseURL(url);
    return feed.items.map(item => {
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
      return {
        headline: item.title ?? '',
        body: item.contentSnippet ?? '',
        source: feed.title ?? url,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        url: item.link ?? '',
        tickersMentioned: extractTickers(text),
        category: categorise(text),
        sentimentScore: scoreText(text),
      };
    });
  } catch { return []; }
}

export async function fetchAllNews(): Promise<NewsArticle[]> {
  const results = await Promise.allSettled([
    ...NATIONAL_FEEDS.map(u => parseFeed(u)),
    ...INTL_FEEDS.map(u => parseFeed(u)),
  ]);
  const all = results
    .filter((r): r is PromiseFulfilledResult<NewsArticle[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicate by headline
  const seen = new Set<string>();
  const deduped = all.filter(a => {
    const k = a.headline.toLowerCase().trim().slice(0,80);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  logger.info({ total: deduped.length }, 'News fetched and deduped');
  return deduped;
}

export function buildSentiment(ticker: string, articles: NewsArticle[]) {
  const relevant = articles.filter(a => a.tickersMentioned.includes(ticker));
  const pool = relevant.length >= 2 ? relevant : articles.slice(0, 15);
  if (!pool.length) return { ticker, score: 0, articleCount: 0, confidence: 'low' as const, topHeadlines: [], recentCatalysts: [] };

  const weights = pool.map(a => recencyDecay(a.publishedAt));
  const wSum    = weights.reduce((s,w)=>s+w,0);
  const score   = wSum > 0 ? pool.reduce((s,a,i)=>s+a.sentimentScore*weights[i],0)/wSum : 0;

  const catalysts = relevant
    .filter(a => Math.abs(a.sentimentScore) > 0.3)
    .sort((a,b) => b.publishedAt.getTime()-a.publishedAt.getTime())
    .slice(0,3)
    .map(a => a.headline);

  return {
    ticker, score: +score.toFixed(3),
    articleCount: pool.length,
    confidence: relevant.length >= 3 ? 'high' as const : relevant.length >= 1 ? 'medium' as const : 'low' as const,
    topHeadlines: pool.slice(0,4).map(a=>a.headline),
    recentCatalysts: catalysts,
  };
}
