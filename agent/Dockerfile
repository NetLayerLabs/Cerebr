# Cerebr Agent keeper. Build from the REPO ROOT (the daemon imports sdk/src/neuro/agent.ts):
#   docker build -f agent/Dockerfile -t cerebr-agent .
# or `docker compose up -d --build` from agent/ (see docker-compose.yml).
FROM node:26-slim

ENV NODE_ENV=production \
    STATE_FILE=/data/state.json \
    HEALTH_HOST=0.0.0.0 \
    HEALTH_PORT=8787

WORKDIR /app/agent
COPY agent/package.json agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Only the viem-free neuro sources the daemon needs, then the daemon itself (Node runs the .ts natively).
COPY sdk/src/neuro /app/sdk/src/neuro
COPY agent/src ./src

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "src/main.ts"]
