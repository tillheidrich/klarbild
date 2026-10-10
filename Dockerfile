# Klarbild — two stages. The first builds, the second only runs: no compiler,
# no dev dependencies, no source tree in the image that ends up on your server.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# The lockfile comes first and `npm ci` honours it, so the image is built from
# the exact versions CI tested — not from whatever `^` resolved to today.
# Native modules (argon2, sharp) ship prebuilt binaries for amd64 and arm64,
# so no compiler is needed in either stage.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4321 HOST=0.0.0.0 STORAGE_DIR=/data

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Read at runtime, on every boot.
COPY --from=build --chown=node:node /app/migrations ./migrations

# Not root. A fresh named volume mounted at /data takes over this ownership;
# for a bind mount, give the directory to uid 1000 (`chown 1000:1000 ./data`).
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4321
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./dist/server/entry.mjs"]
