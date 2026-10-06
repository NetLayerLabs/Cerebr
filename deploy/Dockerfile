# Cerebr web: landing at /, dApp at /app. Put this folder at deploy/ in the repo and build from the repo root
# (the app imports ../sdk/src and ../launch):
#   docker build -f deploy/Dockerfile -t cerebr-web:latest .
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /src
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --no-audit --no-fund
COPY app/ app/
COPY sdk/src/ sdk/src/
COPY launch/config.json launch/config.json
COPY launch/out/196.json launch/out/196.json
# i18n:check runs the SDK sources under plain Node, which resolves 'viem' from sdk/: share the app's copy.
RUN ln -s ../app/node_modules sdk/node_modules
# Optional build-time override (app/.env.example). Empty = the public https://rpc.xlayer.tech.
# If you set it, add that origin to connect-src in security-headers.conf.
ARG VITE_RPC_196=
ENV VITE_RPC_196=${VITE_RPC_196}
RUN cd app && npm run build && npm run i18n:check

# ---- serve ----
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/app/dist /usr/share/nginx/html
# _redirects is Netlify/Cloudflare-only; nginx.conf does the same rewrite.
RUN rm -f /usr/share/nginx/html/_redirects
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
