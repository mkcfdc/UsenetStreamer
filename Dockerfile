FROM denoland/deno:alpine

WORKDIR /app

COPY . .

RUN mkdir -p /app/data && deno cache main.ts && chown -R deno:deno /app
RUN echo '#!/bin/sh' > /usr/local/bin/manage && \
    echo 'cd /app' >> /usr/local/bin/manage && \
    echo 'exec deno task manage "$@"' >> /usr/local/bin/manage && \
    chmod +x /usr/local/bin/manage

USER deno
EXPOSE 7000

ENV FORCE_COLOR=1

CMD ["deno", "run", "--no-check", "--unstable-otel", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]