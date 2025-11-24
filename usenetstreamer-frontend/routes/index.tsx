import { define } from "../utils.ts";

export default define.page(function Home() {
  return (
    <>
      {/* Hero Section */}
      <section class="relative overflow-hidden py-20 sm:py-28">
        <div class="absolute top-0 left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/10 blur-[120px]"></div>

        <div class="mx-auto max-w-6xl px-6 text-center">
          <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
            </span>
            Now powered by Deno 2.5.6-latest
          </div>

          <h1 class="text-4xl font-extrabold tracking-tight text-white sm:text-6xl mb-6">
            The Bridge Between <br />
            <span class="bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
              Usenet & Stremio
            </span>
          </h1>

          {/* Increased mb-10 to mb-12 for more space above the buttons */}
          <p class="mx-auto max-w-2xl text-lg text-slate-400 mb-12 leading-relaxed">
            An intelligent orchestrator that searches Usenet indexers, queues downloads in NZBDav or altMount, and exposes the media as Stremio streams.
            <span class="block mt-2 text-slate-500 text-sm">No local storage required. Deno Web Ready API's where possible.</span>
          </p>

          {/* Configuration button is now the primary, larger, gradient button */}
          <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/configure"
              class="w-full sm:w-auto inline-flex items-center gap-2 rounded-xl 
                        bg-gradient-to-r from-sky-600 to-cyan-600 
                        px-8 py-3.5 text-base font-semibold text-white 
                        shadow-lg shadow-sky-500/30 
                        transition-all hover:scale-105 hover:bg-sky-500 hover:shadow-cyan-400/50
                        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-950">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.78 1.35a2 2 0 0 0 .73 2.73l.15.08a2 2 0 0 1 1 1.74v.44a2 2 0 0 0 2 2v.18a2 2 0 0 1 1 1.73l.43.25a2 2 0 0 1 2 0l.15-.08a2 2 0 0 0 2.73.73l.78-1.35a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.78-1.35a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              Configuration
            </a>
            {/* Other buttons (e.g., "View Architecture") */}
            <a href="#features" class="w-full sm:w-auto rounded-xl border border-slate-700 bg-slate-900/50 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-slate-800 hover:border-slate-600">
              View Features
            </a>
          </div>
        </div>
      </section>

      {/* Tech Stack Strip */}
      <section class="border-y border-white/5 bg-slate-900/40 py-8">
        <div class="mx-auto max-w-7xl px-6">
          <div class="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale transition-all hover:grayscale-0 hover:opacity-100">
            <div class="flex items-center gap-2 text-white font-bold"><span class="text-2xl">🦕</span> Deno 2.5</div>
            <div class="flex items-center gap-2 text-red-500 font-bold"><span class="text-2xl">🔴</span> Redis Streams</div>
            <div class="flex items-center gap-2 text-orange-500 font-bold"><span class="text-2xl">🔥</span> Prowlarr</div>
            <div class="flex items-center gap-2 text-blue-400 font-bold"><span class="text-2xl">🐳</span> Docker</div>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section id="features" class="py-24">
        <div class="mx-auto max-w-7xl px-6">
          <h2 class="text-3xl font-bold text-white mb-12">Next-Gen Performance</h2>
          <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

            {/* Feature 1 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-sky-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">Deno Web APIs</h3>
              <p class="text-sm text-slate-400">Rewritten using Deno 2.5 Web-ready APIs. No Express dependency. Direct usage of <code>Deno.serve</code> for minimal memory footprint.</p>
            </div>

            {/* Feature 2 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-cyan-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">Redis Architecture</h3>
              <p class="text-sm text-slate-400">RedisJSON caching for Cinemeta & Prowlarr API calls. Redis Streams prevent duplicate downloads of the same file.</p>
            </div>

            {/* Feature 3 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-teal-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">Security First</h3>
              <p class="text-sm text-slate-400">API Keys are never shared in URLs. Environment variables stored securely. Auto-deletion of bad lookups from cache.</p>
            </div>

            {/* Feature 4 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-emerald-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">altMount & .strm</h3>
              <p class="text-sm text-slate-400">New support for altMount (7zip extraction & multiple providers). Experimental support for .strm files metadata.</p>
            </div>

            {/* Feature 5 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-blue-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">No Redirects? No Problem.</h3>
              <p class="text-sm text-slate-400">Built-in proxy to handle Prowlarr's forced redirects for Usenet indexers. NzbHydra2 optional support added.</p>
            </div>

            {/* Feature 6 */}
            <div class="rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-purple-500/30 hover:bg-slate-800">
              <div class="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m16 16-4-4-4 4"></path></svg>
              </div>
              <h3 class="mb-2 text-lg font-semibold text-white">Direct Upload</h3>
              <p class="text-sm text-slate-400">Uses direct indexing to query sites, making searches instant with 0 overhead. No external webdav module dependencies.</p>
            </div>

          </div>
        </div>
      </section>

      {/* NZB Check Section */}
      <section id="nzbcheck" class="py-20 bg-slate-900/30 border-y border-white/5">
        <div class="mx-auto max-w-6xl px-6 flex flex-col md:flex-row items-center gap-12">
          <div class="flex-1">
            <h2 class="text-3xl font-bold text-white mb-4">New: NZBCheck API Integration</h2>
            <p class="text-slate-400 text-lg mb-6">
              Avoid bad downloads before they start. Our Open API checks nzb files instantly without pressuring your indexer or Usenet provider.
            </p>
            <ul class="space-y-4 mb-8">
              <li class="flex items-start gap-3">
                <div class="mt-1 h-5 w-5 flex items-center justify-center rounded-full bg-green-500/20 text-green-400">✓</div>
                <span class="text-slate-300">Clean, highly cached verification</span>
              </li>
              <li class="flex items-start gap-3">
                <div class="mt-1 h-5 w-5 flex items-center justify-center rounded-full bg-green-500/20 text-green-400">✓</div>
                <span class="text-slate-300">Green checkmark for verified working files</span>
              </li>
              <li class="flex items-start gap-3">
                <div class="mt-1 h-5 w-5 flex items-center justify-center rounded-full bg-green-500/20 text-green-400">✓</div>
                <span class="text-slate-300">Community driven – help us improve!</span>
              </li>
            </ul>
            <a href="https://nzbcheck.filmwhisper.dev" target="_blank" class="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-2">
              Get your API Key <span aria-hidden="true">→</span>
            </a>
          </div>
          <div class="flex-1 w-full">
            <div class="rounded-xl border border-white/10 bg-slate-950 p-6 font-mono text-xs md:text-sm text-slate-300 shadow-2xl">
              <div class="mb-4 flex gap-2">
                <div class="h-3 w-3 rounded-full bg-red-500/50"></div>
                <div class="h-3 w-3 rounded-full bg-yellow-500/50"></div>
                <div class="h-3 w-3 rounded-full bg-green-500/50"></div>
              </div>
              <div class="space-y-2">
                <p class="text-slate-500"># .env configuration</p>
                <p>NZB_CHECK_URL=<span class="text-sky-300">https://nzbcheck.filmwhisper.dev</span></p>
                <p>NZB_CHECK_API_KEY=<span class="text-emerald-300">SUPER_SECURE_KEY</span></p>
                <br />
                <p class="text-slate-500"># Result</p>
                <p><span class="text-green-400">✓ Verified</span> Matrix.Resurrections.2160p.nzb</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
});
