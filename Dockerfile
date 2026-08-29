# -----------------------------------------------------------------------------
# Stage 1: Build & Compile Monorepo
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/ai/package.json ./packages/ai/
COPY packages/cli/package.json ./packages/cli/

# Install all workspace dependencies
RUN npm ci

# Copy full source trees
COPY packages/ ./packages/

# Compile all workspace packages
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Minimal Runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy root manifests and built packages
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json /app/packages/core/
COPY --from=builder /app/packages/core/dist /app/packages/core/dist
COPY --from=builder /app/packages/server/package.json /app/packages/server/
COPY --from=builder /app/packages/server/dist /app/packages/server/dist
COPY --from=builder /app/packages/ai/package.json /app/packages/ai/
COPY --from=builder /app/packages/ai/dist /app/packages/ai/dist
COPY --from=builder /app/packages/cli/package.json /app/packages/cli/
COPY --from=builder /app/packages/cli/dist /app/packages/cli/dist

# Create symlink for edgeroute CLI executable
RUN ln -s /app/packages/cli/dist/index.js /usr/local/bin/edgeroute && \
    chmod +x /app/packages/cli/dist/index.js

# Expose standard proxy port
EXPOSE 3000

# Health check against EdgeRoute /health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run with non-privileged user for container security
USER node

# Start EdgeRoute Proxy Server in daemon mode
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["dev", "--host", "0.0.0.0", "--port", "3000"]
