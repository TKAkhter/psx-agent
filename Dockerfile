# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Install Puppeteer system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release wget xdg-utils --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release wget xdg-utils --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

USER appuser

ENV NODE_ENV=production
ENV TZ=Asia/Karachi
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=2 \
  CMD node -e "process.exit(0)" || exit 1

CMD ["node", "dist/index.js"]
