import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="UsenetStreamer is a self-hosted Stremio addon. It searches your indexers, queues NZBs, and proxies playback. Nothing is hosted here."
        />
        <meta name="theme-color" content="#0b0a08" />
        <title>UsenetStreamer</title>
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.bunny.net" />
        <link rel="preconnect" href="https://images.unsplash.com" />
        <link
          rel="stylesheet"
          href="https://fonts.bunny.net/css?family=ibm-plex-sans:400,500,600|instrument-serif:400,400i&display=swap"
        />
      </head>
      <body class="bg-night text-ink antialiased font-sans">
        <div class="min-h-screen flex flex-col">
          <header class="sticky top-0 z-50 border-b border-line bg-night/90 backdrop-blur-sm">
            <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
              <a href="/" class="flex items-baseline gap-2 no-underline">
                <span class="font-serif text-xl text-ink tracking-tight">UsenetStreamer</span>
                <span class="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-faint">addon</span>
              </a>
              <nav class="flex items-center gap-6 text-[13px] text-mute">
                <a href="/#how" class="hidden sm:inline hover:text-ink">How it works</a>
                <a
                  href="https://github.com/mkcfdc/usenetstreamer"
                  target="_blank"
                  rel="noreferrer"
                  class="hover:text-ink"
                >
                  Source
                </a>
                <a
                  href="/configure"
                  class="rounded-sm bg-brass px-3 py-1.5 text-[12px] font-medium text-night hover:bg-brass-soft"
                >
                  Open console
                </a>
              </nav>
            </div>
          </header>

          <main class="flex-1">
            <Component />
          </main>

          <footer class="border-t border-line">
            <div class="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-3">
              <div>
                <p class="font-serif text-lg text-ink">UsenetStreamer</p>
                <p class="mt-2 max-w-xs text-sm leading-relaxed text-mute">
                  A local Stremio addon. It talks to your indexers and InfiniDysk.
                  It does not host or ship media.
                </p>
              </div>
              <div class="text-sm text-mute space-y-2">
                <p class="kicker">Product</p>
                <a href="/configure" class="block hover:text-ink">Configuration console</a>
                <a href="/login" class="block hover:text-ink">Sign in</a>
                <a href="https://github.com/mkcfdc/usenetstreamer" class="block hover:text-ink">GitHub</a>
              </div>
              <div class="text-sm text-mute space-y-2">
                <p class="kicker">Notes</p>
                <p>Not affiliated with any Usenet provider, indexer, or Stremio.</p>
                <p>Photos from Unsplash. Type from Bunny Fonts.</p>
                <p class="text-faint">© {new Date().getFullYear()}</p>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
});
