import { useState } from "preact/hooks";
import { Config } from "../utils/configTypes.ts";

interface Props {
    config: Config;
}

export function InstallSection({ config }: Props) {
    const [copied, setCopied] = useState(false);

    const baseUrl = config.ADDON_BASE_URL?.replace(/\/+$/, "") || "";
    const manifestUrl = `${baseUrl}/${config.ADDON_SHARED_SECRET}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?:\/\//, "stremio://");
    const webUrl = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`;

    const handleCopy = async () => {
        const text = manifestUrl;
        let isSuccess = false;

        // 1. Try Modern API (Secure Contexts like HTTPS/Localhost)
        // We check specifically for the writeText function availability
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                isSuccess = true;
            } catch (err) {
                console.warn("Clipboard API failed, attempting fallback...", err);
            }
        }

        // 2. Fallback (HTTP / Non-Secure Contexts)
        // If the modern API failed or didn't exist, we use the textarea hack
        if (!isSuccess) {
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;

                // Make it invisible but part of the DOM so it can be selected
                textArea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                // Execute the copy command
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) isSuccess = true;
            } catch (err) {
                console.error("Fallback copy failed", err);
            }
        }

        // 3. Feedback
        if (isSuccess) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else {
            // Ultimate fallback if even the textarea hack fails (rare)
            prompt("Could not auto-copy. Please copy this link manually:", text);
        }
    };

    const isReady = config.ADDON_BASE_URL && config.ADDON_SHARED_SECRET;

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-xl font-bold text-indigo-400 mb-6">Installation</legend>

            {!isReady ? (
                <div class="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-sm">
                    Please configure the <strong>Stremio Addon</strong> section (Base URL & Secret) to generate installation links.
                </div>
            ) : (
                <div class="space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* 1. One-Click Install */}
                        <a
                            href={stremioUrl}
                            class="flex flex-col items-center justify-center p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition-all group text-center text-decoration-none"
                        >
                            <div class="mb-3 p-3 rounded-full bg-indigo-500/20 text-indigo-300 group-hover:scale-110 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
                            </div>
                            <span class="font-bold text-white">Launch Stremio</span>
                            <span class="text-xs text-indigo-200/70 mt-1">App on Device</span>
                        </a>

                        {/* 2. Web Install */}
                        <a
                            href={webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex flex-col items-center justify-center p-4 rounded-xl border border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20 transition-all group text-center text-decoration-none"
                        >
                            <div class="mb-3 p-3 rounded-full bg-pink-500/20 text-pink-300 group-hover:scale-110 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>
                            </div>
                            <span class="font-bold text-white">Stremio Web</span>
                            <span class="text-xs text-pink-200/70 mt-1">Browser Version</span>
                        </a>

                        {/* 3. Copy Link */}
                        <button
                            type="button"
                            onClick={handleCopy}
                            class="flex flex-col items-center justify-center p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all group"
                        >
                            <div class={`mb-3 p-3 rounded-full transition-transform ${copied ? 'bg-green-500 text-white scale-110' : 'bg-emerald-500/20 text-emerald-300 group-hover:scale-110'}`}>
                                {copied ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                                )}
                            </div>
                            <span class="font-bold text-white">{copied ? "Copied!" : "Copy Link"}</span>
                            <span class="text-xs text-emerald-200/70 mt-1">Manual Install</span>
                        </button>
                    </div>

                    {/* URL Preview */}
                    <div class="bg-black/30 rounded-lg p-3 border border-white/5 flex items-center justify-between gap-4 overflow-hidden">
                        <code class="text-xs text-slate-400 font-mono truncate">{manifestUrl}</code>
                    </div>
                </div>
            )}
        </fieldset>
    );
}
