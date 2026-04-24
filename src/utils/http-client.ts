import axios from 'axios';
import axiosRetry from 'axios-retry';

export const httpClient = axios.create({
  timeout: 30_000,
  headers: { 'User-Agent': 'PSXAnalyzer/1.0' },
});

axiosRetry(httpClient, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    (err.response?.status !== undefined && err.response.status >= 500),
});
