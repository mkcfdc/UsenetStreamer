FROM denoland/deno:2.5.6 AS builder

WORKDIR /workspace

COPY shared ./shared
COPY usenetstreamer-frontend ./usenetstreamer-frontend

WORKDIR /workspace/usenetstreamer-frontend

RUN deno install
RUN deno task build

FROM denoland/deno:2.5.6

WORKDIR /app

RUN mkdir -p /app/data && chown -R deno:deno /app

USER deno

COPY --from=builder --chown=deno:deno /workspace/usenetstreamer-frontend/_fresh ./_fresh
COPY --from=builder --chown=deno:deno /workspace/usenetstreamer-frontend/static ./static

EXPOSE 8000

CMD ["deno", "serve", "-A", "_fresh/server.js"]
