import { useState, useEffect } from "preact/hooks";
import { Config, IndexingMethod } from "../utils/configTypes.ts";
import { IndexingSection } from "../components/config/IndexingSection.tsx";
import { NzbDavSection } from "../components/config/NzbDavSection.tsx";
import { StremioSection } from "../components/config/StremioSection.tsx";
import { NzbCheckSection } from "../components/config/NzbCheckSection.tsx";
import { InstallSection } from "../components/config/InstallSection.tsx";
import { RedisSection } from "../components/config/RedisSection.tsx";
import { StremioNNTPSection } from "../components/config/StremioNntpSection.tsx";

const FeatureFlagsSection = ({ config, onChange }: { config: Config, onChange: (e: Event) => void }) => (
    <fieldset class="mb-10 pb-8 border-b border-white/5">
        <legend class="text-xl font-bold text-teal-400 mb-6">Feature Flags</legend>
        <div class="flex items-center justify-between p-4 bg-slate-800 rounded-lg border border-white/10">
            <label htmlFor="USE_STRM_FILES" class="text-sm font-medium text-slate-300">Enable .strm File Support (Experimental)</label>
            <div class="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                <input type="checkbox" name="USE_STRM_FILES" id="USE_STRM_FILES" checked={config.USE_STRM_FILES} onChange={onChange}
                    class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label htmlFor="USE_STRM_FILES" class="toggle-label block overflow-hidden h-6 rounded-full bg-slate-700 cursor-pointer"></label>
            </div>
        </div>
        <div class="flex items-center justify-between p-4 bg-slate-800 rounded-lg border border-white/10">
            <label htmlFor="USE_STREMIO_NNTP" class="text-sm font-medium text-slate-300">Enable Stremio NNTP support (Experimental)</label>
            <div class="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                <input type="checkbox" name="USE_STREMIO_NNTP" id="USE_STREMIO_NNTP" checked={config.USE_STREMIO_NNTP} onChange={onChange}
                    class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer" />
                <label htmlFor="USE_STREMIO_NNTP" class="toggle-label block overflow-hidden h-6 rounded-full bg-slate-700 cursor-pointer"></label>
            </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: `.toggle-checkbox:checked { right: 0; border-color: #06b6d4; } .toggle-checkbox:checked + .toggle-label { background-color: #06b6d4; } .toggle-label { box-shadow: inset 0 0 0 9999px #1e293b; }` }} />
    </fieldset>
);

export default function ConfigForm() {
    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/config");
            if (!res.ok) throw new Error("Failed");
            setConfig(await res.json());
        } catch (e: any) { setMessage({ text: e.message, type: "error" }); }
        finally { setLoading(false); }
    };

    const handleChange = (e: Event) => {
        const { name, value, type } = e.target as HTMLInputElement;
        setConfig((prev) => ({ ...prev!, [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value }));
    };

    const handleIndexingMethodChange = (method: IndexingMethod) => {
        setConfig((prev) => {
            if (!prev) return null;

            const updated = { ...prev, INDEXING_METHOD: method };

            if (method === 'direct') {
                updated.PROWLARR_URL = "";
                updated.PROWLARR_API_KEY = "";
                updated.NZBHYDRA_URL = "";
                updated.NZBHYDRA_API_KEY = "";
            }
            else if (method === 'prowlarr') {
                updated.NZBHYDRA_URL = "";
                updated.NZBHYDRA_API_KEY = "";
            }
            else if (method === 'nzbhydra2') {
                // If Hydra: Clear Prowlarr
                updated.PROWLARR_URL = "";
                updated.PROWLARR_API_KEY = "";
            }

            return updated;
        });
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok) throw new Error("Failed to save");
            setMessage({ text: "Configuration saved successfully!", type: "success" });
        } catch (e: any) { setMessage({ text: e.message, type: "error" }); }
        finally { setSaving(false); setTimeout(() => setMessage(null), 3000); }
    };

    if (loading) return <div class="text-center text-sky-400 py-12">Loading...</div>;
    if (!config) return <div class="text-center text-red-400">Failed to load. <button type="button" onClick={fetchConfig} class="underline">Retry</button></div>;

    return (
        <form onSubmit={handleSubmit} class="bg-slate-900 rounded-2xl shadow-xl border border-white/10 p-8 sm:p-10">
            {message && (
                <div class={`mb-6 p-4 rounded-lg text-sm font-medium ${message.type === "success" ? "bg-green-500/20 text-green-300 border-green-500/30 border" : "bg-red-500/20 text-red-300 border-red-500/30 border"}`}>
                    {message.text}
                </div>
            )}

            <RedisSection config={config} onChange={handleChange} />
            <IndexingSection config={config} onChange={handleChange} onMethodChange={handleIndexingMethodChange} />
            {!config.USE_STREMIO_NNTP ? (
                <NzbDavSection config={config} onChange={handleChange} />
            ) : (
                <StremioNNTPSection config={config} />
            )}
            <StremioSection config={config} onChange={handleChange} />
            <NzbCheckSection config={config} onChange={handleChange} />
            <FeatureFlagsSection config={config} onChange={handleChange} />

            <InstallSection config={config} />

            <div class="flex justify-end gap-4 mt-8">
                <button type="button" onClick={fetchConfig} class="rounded-xl border border-slate-700 bg-slate-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Reset</button>
                <button type="submit" disabled={saving} class="rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 hover:bg-sky-500 disabled:opacity-50">
                    {saving ? "Saving..." : "Save Changes"}
                </button>
            </div>
        </form>
    );
}
