# ── Stage 1: deps ────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

# Copy only manifests first so this layer is cached unless deps change
COPY --chown=node:node package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install yt-dlp and its runtime dependency (ffmpeg optional but useful),
# plus python3 which yt-dlp requires on some operations.
# We use the official yt-dlp binary release to avoid pip/python overhead.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    ffmpeg \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ── HuggingFace Spaces: run as user ID 1000 ───────────────────────────────
# node:20-slim already ships a "node" user at UID 1000 — reuse it.
USER node

ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

WORKDIR /home/node/app

# Copy production node_modules from deps stage
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=node:node . .

# HuggingFace Spaces routes external traffic to this port.
# The app reads PORT at runtime; default matches app_port in README.md.
ENV PORT=7860 \
    NODE_ENV=production

EXPOSE 7860

CMD ["node", "index.js"]
