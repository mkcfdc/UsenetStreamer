FROM denoland/deno:2.5.6

WORKDIR /app

COPY deno.json deno.lock ./

RUN deno install

COPY . .

RUN deno task build

EXPOSE 8000

RUN mkdir -p /app/data && chown -R deno:deno /app/data

CMD ["deno", "task", "start"]