FROM denoland/deno:2.5.6 AS builder

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY . .
RUN deno task build


FROM denoland/deno:2.5.6

WORKDIR /app


RUN mkdir -p /app/data && chown -R deno:deno /app

USER deno

COPY --from=builder --chown=deno:deno /app/deno.json /app/deno.lock ./

COPY --from=builder --chown=deno:deno /app/_fresh ./_fresh

COPY --from=builder --chown=deno:deno /app/static ./static

EXPOSE 8000


CMD ["deno", "task", "start"]