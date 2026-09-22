# ---- Stage 1: deps ----
# Install dependencies in their own layer so Docker only re-runs `npm ci`
# when package.json/package-lock.json change, not on every source edit.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage: dev ----
# Used by docker-compose for local development. Source is bind-mounted in at
# runtime over this, so only node_modules from this stage actually matters;
# `next dev` gives hot reload. Never used for the production image.
FROM deps AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Stage 2: builder ----
# Bring in deps + full source, then build. `next build` needs devDependencies
# too, which is fine here since this stage never ships.
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Stage 3: runner ----
# Final image: only the standalone server output, not node_modules or source.
# Requires output: "standalone" in next.config.ts.
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
