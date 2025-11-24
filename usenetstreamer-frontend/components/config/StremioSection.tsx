// components/config/StremioSection.tsx
import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

export function StremioSection({ config, onChange }: Props) {
    const [showSecret, setShowSecret] = useState(false);

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-xl font-bold text-teal-400 mb-6">Stremio Addon</legend>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="ADDON_BASE_URL" class="block text-sm font-medium text-slate-300 mb-2">Base URL</label>
                    <input type="url" id="ADDON_BASE_URL" name="ADDON_BASE_URL" value={config.ADDON_BASE_URL} onChange={onChange} required
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />
                    <p class="mt-2 text-xs text-slate-500">Must be HTTPS.</p>
                </div>
                <div>
                    <label htmlFor="ADDON_SHARED_SECRET" class="block text-sm font-medium text-slate-300 mb-2">Shared Secret</label>
                    <div class="relative">
                        <input type={showSecret ? "text" : "password"} id="ADDON_SHARED_SECRET" name="ADDON_SHARED_SECRET" value={config.ADDON_SHARED_SECRET} onChange={onChange} required
                            class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />
                        <button type="button" onClick={() => setShowSecret(!showSecret)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white">
                            {showSecret ? "Hide" : "Show"}
                        </button>
                    </div>
                </div>
            </div>
        </fieldset>
    );
}
