FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.6.1 --activate
WORKDIR /app

# Copy workspace manifests first for optimal layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile

# Copy source code across workspaces
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build shared domain library first
RUN pnpm --filter @booking-bro/shared build

# Target: API + pg-boss reminder worker
FROM base AS api
RUN pnpm --filter @booking-bro/api build
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @booking-bro/api db:migrate && pnpm --filter @booking-bro/api db:seed && pnpm --filter @booking-bro/api start"]

# Target: Next.js Web UI
FROM base AS web
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm --filter @booking-bro/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@booking-bro/web", "start"]
