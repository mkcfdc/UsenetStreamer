FROM denoland/deno:alpine

WORKDIR /app

# Copy only what’s needed
COPY . .

# Pre-cache dependencies
RUN mkdir -p /app/data && deno cache main.ts

EXPOSE 7000

ENV NO_COLOR=true

CMD ["deno", "run", "--no-check", "--unstable-otel", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]