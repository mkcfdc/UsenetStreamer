import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>UsenetStreamer</title>
        <link rel="stylesheet" href="styles.css" />
      </head>
      {/* Switched selection color to sky-500 */}
      <body class="bg-slate-950 text-slate-200 antialiased selection:bg-sky-500 selection:text-white">
        <div class="min-h-screen flex flex-col">

          {/* Navigation */}
          <nav class="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
            <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="h-8 w-8 flex items-center justify-center rounded bg-sky-600 shadow-[0_0_15px_rgba(14,165,233,0.5)]">
                  <span class="font-mono text-xs font-bold text-white">US</span>
                </div>
                <span class="text-lg font-bold tracking-tight text-white">UsenetStreamer</span>
              </div>
              <div class="hidden md:flex gap-8 text-sm font-medium text-slate-400">
                <a href="#features" class="hover:text-sky-400 transition-colors">Features</a>
                <a href="/configure" class="hover:text-sky-400 transition-colors">Configure</a>
                <a href="#nzbcheck" class="hover:text-sky-400 transition-colors">NZBCheck</a>
                <a href="https://github.com/mkcfdc/usenetstreamer" target="_blank" class="hover:text-white transition-colors">GitHub</a>
              </div>
              <div>
                <a href="https://github.com/mkcfdc/usenetstreamer" class="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-mono text-slate-300 transition-colors hover:bg-white/10">
                  v2.5.0-deno
                </a>
              </div>
            </div>
          </nav>

          <main class="flex-1">
            <Component />
            {/* Footer / Disclaimer */}
            <footer class="border-t border-white/10 bg-slate-950 py-12">
              <div class="mx-auto max-w-6xl px-6 text-center">
                <p class="text-slate-500 text-sm mb-4">
                  UsenetStreamer is not affiliated with any Usenet provider or indexer.
                  It does not host or distribute media.
                </p>
                <p class="text-slate-600 text-xs">
                  Offered strictly for educational purposes. <br />
                  &copy; {new Date().getFullYear()} UsenetStreamer Project.
                </p>
              </div>
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
});