FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER appuser

ENV NODE_ENV=production
ENV TZ=Asia/Karachi

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

ENTRYPOINT ["node", "dist/index.js"]
