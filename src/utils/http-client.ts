import axios from 'axios';
import axiosRetry from 'axios-retry';

export const httpClient = axios.create({ timeout: 30_000, headers: { 'User-Agent': 'PSXAnalyzer/2.0' } });
axiosRetry(httpClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (e) => axiosRetry.isNetworkOrIdempotentRequestError(e) || (e.response?.status ?? 0) >= 500,
});
