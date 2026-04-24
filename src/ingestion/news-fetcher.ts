import RssParser from 'rss-parser';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { httpClient } from '../utils/http-client';
import type { NewsArticle } from '../types';

const rssParser = new RssParser({ timeout: 20_000 });

// Known ticker mappings for entity extraction
const TICKER_ALIASES: Record<string, string[]> = {
  MEBL:   ['meezan bank', 'meezan'],
  OGDC:   ['ogdcl', 'oil and gas development', 'oil & gas development'],
  HUBC:   ['hub power', 'hubco'],
  EFERT:  ['engro fertilizer', 'engro fertilizers'],
  ENGROH: ['engro holdings', 'engro corp'],
  FFC:    ['fauji fertilizer', 'fauji'],
  LUCK:   ['lucky cement'],
  MARI:   ['mari petroleum', 'mari gas'],
  POL:    ['pakistan oilfields'],
  SYS:    ['systems limited', 'systems ltd'],
  PSX:    ['pakistan stock exchange', 'kse', 'karachi stock'],
  SBP:    ['state bank', 'central bank of pakistan'],
};

function extractTickers(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const [ticker, aliases] of Object.entries(TICKER_ALIASES)) {
    const allTerms = [ticker.toLowerCase(), ...aliases];
    if (allTerms.some((term) => lower.includes(term))) {
      found.add(ticker);
    }
  }
  return Array.from(found);
}

function categoriseArticle(text: string): NewsArticle['category'] {
  const lower = text.toLowerCase();
  if (/crude|oil|gas|coal|lng|fertiliz|wheat|commodity/.test(lower)) return 'commodity';
  if (/imf|sbp|inflation|gdp|fiscal|budget|rupee|pkr|interest rate/.test(lower)) return 'economy';
  if (/results|earnings|dividend|profit|revenue|quarterly|annual/.test(lower)) return 'corporate';
  if (/prime minister|government|parliament|election|minister/.test(lower)) return 'political';
  return 'general';
}

async function fetchRssFeed(url: string, isNational: boolean): Promise<NewsArticle[]> {
  try {
    const feed = await rssParser.parseURL(url);
    return feed.items.map((item) => {
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
      return {
        headline: item.title ?? '',
        body: item.contentSnippet ?? '',
        source: feed.title ?? url,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        url: item.link ?? '',
        tickersMentioned: extractTickers(text),
        category: categoriseArticle(text),
      };
    });
  } catch (err) {
    logger.warn({ url, err }, 'Failed to fetch RSS feed');
    return [];
  }
}

export async function fetchNationalNews(): Promise<NewsArticle[]> {
  const results = await Promise.allSettled(
    CONFIG.PSX_NEWS_SOURCES.map((url) => fetchRssFeed(url, true))
  );
  const articles = results
    .filter((r): r is PromiseFulfilledResult<NewsArticle[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  // Deduplicate by headline
  const seen = new Set<string>();
  return articles.filter((a) => {
    const key = a.headline.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchInternationalNews(): Promise<NewsArticle[]> {
  const results = await Promise.allSettled(
    CONFIG.INTL_NEWS_SOURCES.map((url) => fetchRssFeed(url, false))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<NewsArticle[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}

export async function fetchCommodityPrices(): Promise<Record<string, number>> {
  try {
    // Using a free commodity API fallback with mock data for demo
    // In production: integrate with World Bank Commodities API or similar
    logger.info('Fetching commodity prices');
    return {
      brentCrude: 82.5,
      naturalGas: 2.1,
      urea: 320,
      dap: 580,
      coal: 145,
    };
  } catch (err) {
    logger.warn({ err }, 'Commodity price fetch failed — using defaults');
    return { brentCrude: 80, naturalGas: 2.0, urea: 300, dap: 550, coal: 140 };
  }
}
