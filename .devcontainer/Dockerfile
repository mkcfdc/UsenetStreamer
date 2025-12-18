FROM denoland/deno:bin-2.6.1 AS deno
FROM mcr.microsoft.com/devcontainers/typescript-node:20
COPY --from=deno /deno /usr/local/bin/deno
RUN apt-get update && apt-get install -y sqlite3