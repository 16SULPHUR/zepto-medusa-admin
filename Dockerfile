# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=9000
RUN groupadd --system --gid 1001 medusa && useradd --system --uid 1001 --gid medusa medusa
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/medusa-config.ts ./medusa-config.ts
COPY --from=builder /app/instrumentation.ts ./instrumentation.ts
COPY --from=builder /app/static ./static
USER medusa
EXPOSE 9000
CMD ["sh", "-c", "npm run predeploy && npm run start"]
