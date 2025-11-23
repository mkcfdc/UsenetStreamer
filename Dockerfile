FROM denoland/deno:alpine

WORKDIR /app

# Copy only what’s needed
COPY . .

# Pre-cache dependencies
RUN deno cache main.ts

# Expose the port (can match your .env PORT)
EXPOSE 7001

# Run the app (no type checking for faster startup)
CMD ["deno", "run", "--no-check", "--unstable-otel", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]