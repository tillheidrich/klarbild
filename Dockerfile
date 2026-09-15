FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=4321 HOST=0.0.0.0

# Build tools for the native modules (argon2). sharp ships a prebuilt libvips.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The lockfile comes first and `npm ci` honours it, so the image is built from
# the exact versions CI tested — not from whatever `^` resolved to today.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./dist/server/entry.mjs"]
