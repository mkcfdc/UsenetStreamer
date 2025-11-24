import { useState, useEffect } from "preact/hooks";
import { Config, IndexingMethod } from "../../utils/configTypes.ts";
import type { Indexer } from "../../../utils/sqlite.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
    onMethodChange: (method: IndexingMethod) => void;
}

export function IndexingSection({ config, onChange, onMethodChange }: Props) {
    const [showProwlarrKey, setShowProwlarrKey] = useState(false);
    const [showNzbHydraKey, setShowNzbHydraKey] = useState(false);

    const [indexers, setIndexers] = useState<Indexer[]>([]);
    const [newIndexer, setNewIndexer] = useState({ name: '', url: '', api_key: '' });
    const [addingIndexer, setAddingIndexer] = useState(false);
    const [localMessage, setLocalMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

    useEffect(() => {
        if (config.INDEXING_METHOD === 'direct') {
            fetchIndexers();
        }
    }, [config.INDEXING_METHOD]);

    const fetchIndexers = async () => {
        try {
            const response = await fetch("/api/indexers");
            if (!response.ok) throw new Error("Failed");
            const data = await response.json();
            setIndexers(data);
        } catch (e) { console.error(e); }
    };

    const handleNewIndexerChange = (e: Event) => {
        const { name, value } = e.target as HTMLInputElement;
        setNewIndexer((prev) => ({ ...prev, [name]: value }));
    };

    const handleAddIndexer = async (e: Event) => {
        e.preventDefault();

        if (!newIndexer.name || !newIndexer.url || !newIndexer.api_key) {
            setLocalMessage({ text: "All fields are required.", type: "error" });
            return;
        }

        setAddingIndexer(true);
        setLocalMessage(null);

        try {
            const testRes = await fetch("/api/test_indexer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: newIndexer.url, api_key: newIndexer.api_key }),
            });

            const testData = await testRes.json();

            if (!testData.success) {
                throw new Error(`Connection failed: ${testData.message}`);
            }

            const res = await fetch("/api/indexers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newIndexer),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to save indexer");
            }

            // Success!
            setLocalMessage({ text: "✓ Verified & Added Successfully!", type: "success" });
            setNewIndexer({ name: '', url: '', api_key: '' }); // Clear form
            fetchIndexers(); // Refresh list

        } catch (error: any) {
            setLocalMessage({ text: error.message, type: "error" });
        } finally {
            setAddingIndexer(false);
            // Clear success message after a few seconds
            setTimeout(() => {
                setLocalMessage((current) => current?.type === 'success' ? null : current);
            }, 3000);
        }
    };

    const handleToggleIndexer = async (id: number, enabled: boolean) => {
        await fetch(`/api/indexers/${id}/toggle`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !enabled }),
        });
        fetchIndexers();
    };

    const handleRemoveIndexer = async (id: number) => {
        if (!confirm("Remove this indexer?")) return;
        await fetch(`/api/indexers/${id}`, { method: "DELETE" });
        fetchIndexers();
    };

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-2xl font-bold text-sky-400 mb-8">Indexing Method</legend>
            <div class="space-y-6">

                {/* ... Prowlarr Section (Unchanged) ... */}
                <div class="group rounded-xl border border-white/10 bg-slate-800 transition-colors duration-200 focus-within:border-sky-500/40 hover:border-white/20">
                    <label class="block cursor-pointer p-5" htmlFor="indexing-prowlarr">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <input type="radio" id="indexing-prowlarr" name="indexingMethod" value="prowlarr"
                                    checked={config.INDEXING_METHOD === 'prowlarr'}
                                    onChange={() => onMethodChange('prowlarr')}
                                    class="h-5 w-5 text-sky-500 border-slate-600 bg-slate-700 focus:ring-sky-500" />
                                <span class="text-xl font-semibold text-white">Prowlarr</span>
                            </div>
                        </div>
                    </label>
                    {config.INDEXING_METHOD === 'prowlarr' && (
                        <div class="border-t border-white/5 p-5 pt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="PROWLARR_URL" class="block text-sm font-medium text-slate-300 mb-2">Prowlarr URL</label>
                                <input type="url" id="PROWLARR_URL" name="PROWLARR_URL" value={config.PROWLARR_URL} onChange={onChange} required
                                    class="w-full p-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-sky-500 outline-none" />
                            </div>
                            <div>
                                <label htmlFor="PROWLARR_API_KEY" class="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                                <div class="relative">
                                    <input type={showProwlarrKey ? "text" : "password"} id="PROWLARR_API_KEY" name="PROWLARR_API_KEY" value={config.PROWLARR_API_KEY} onChange={onChange} required
                                        class="w-full p-3 pr-10 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-sky-500 outline-none" />
                                    <button type="button" onClick={() => setShowProwlarrKey(!showProwlarrKey)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white">
                                        {showProwlarrKey ? "Hide" : "Show"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ... NZBHydra2 Section (Unchanged) ... */}
                <div class="group rounded-xl border border-white/10 bg-slate-800 transition-colors duration-200 focus-within:border-cyan-500/40 hover:border-white/20">
                    <label class="block cursor-pointer p-5" htmlFor="indexing-nzbhydra2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <input type="radio" id="indexing-nzbhydra2" name="indexingMethod" value="nzbhydra2"
                                    checked={config.INDEXING_METHOD === 'nzbhydra2'}
                                    onChange={() => onMethodChange('nzbhydra2')}
                                    class="h-5 w-5 text-cyan-500 border-slate-600 bg-slate-700 focus:ring-cyan-500" />
                                <span class="text-xl font-semibold text-white">NZBHydra2 (Optional)</span>
                            </div>
                        </div>
                    </label>
                    {config.INDEXING_METHOD === 'nzbhydra2' && (
                        <div class="border-t border-white/5 p-5 pt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="NZBHYDRA_URL" class="block text-sm font-medium text-slate-300 mb-2">URL</label>
                                <input type="url" id="NZBHYDRA_URL" name="NZBHYDRA_URL" value={config.NZBHYDRA_URL || ""} onChange={onChange}
                                    class="w-full p-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                            </div>
                            <div>
                                <label htmlFor="NZBHYDRA_API_KEY" class="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                                <div class="relative">
                                    <input type={showNzbHydraKey ? "text" : "password"} id="NZBHYDRA_API_KEY" name="NZBHYDRA_API_KEY" value={config.NZBHYDRA_API_KEY || ""} onChange={onChange}
                                        class="w-full p-3 pr-10 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                                    <button type="button" onClick={() => setShowNzbHydraKey(!showNzbHydraKey)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white">
                                        {showNzbHydraKey ? "Hide" : "Show"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Direct Indexing */}
                <div class="group rounded-xl border border-white/10 bg-slate-800 transition-colors duration-200 focus-within:border-teal-500/40 hover:border-white/20">
                    <label class="block cursor-pointer p-5" htmlFor="indexing-direct">
                        <div class="flex items-center gap-3">
                            <input type="radio" id="indexing-direct" name="indexingMethod" value="direct"
                                checked={config.INDEXING_METHOD === 'direct'}
                                onChange={() => onMethodChange('direct')}
                                class="h-5 w-5 text-teal-500 border-slate-600 bg-slate-700 focus:ring-teal-500" />
                            <span class="text-xl font-semibold text-white">Direct Indexing</span>
                        </div>
                    </label>
                    {config.INDEXING_METHOD === 'direct' && (
                        <div class="border-t border-white/5 p-5 pt-8">
                            {localMessage && (
                                <div class={`mb-6 p-3 rounded-lg border ${localMessage.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                                    {localMessage.text}
                                </div>
                            )}

                            {/* Add New Form */}
                            <form onSubmit={handleAddIndexer} class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-8">
                                <input type="text" name="name" value={newIndexer.name} onChange={handleNewIndexerChange} placeholder="Name" required class="w-full p-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />
                                <input type="url" name="url" value={newIndexer.url} onChange={handleNewIndexerChange} placeholder="URL" required class="w-full p-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />
                                <input type="text" name="api_key" value={newIndexer.api_key} onChange={handleNewIndexerChange} placeholder="API Key" required class="w-full p-3 rounded-lg bg-slate-900 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />

                                <div class="md:col-span-3 text-right">
                                    <button
                                        type="submit"
                                        disabled={addingIndexer}
                                        class="w-full bg-teal-600 py-2 rounded-lg text-white font-bold hover:bg-teal-500 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {addingIndexer ? (
                                            <>
                                                <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                                                Verifying & Adding...
                                            </>
                                        ) : (
                                            "Verify & Add Indexer"
                                        )}
                                    </button>
                                </div>
                            </form>

                            {/* List */}
                            <ul class="space-y-4">
                                {indexers.map((idx) => (
                                    <li key={idx.id} class="bg-slate-900 rounded-lg p-4 border border-white/10 flex justify-between items-center">
                                        <div>
                                            <div class="font-bold text-white">{idx.name}</div>
                                            <div class="text-xs text-slate-500">{idx.url}</div>
                                        </div>
                                        <div class="flex gap-2">
                                            <button type="button" onClick={() => handleToggleIndexer(idx.id, idx.enabled === 1)} class={`text-xs px-2 py-1 rounded ${idx.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                {idx.enabled ? 'On' : 'Off'}
                                            </button>
                                            <button type="button" onClick={() => handleRemoveIndexer(idx.id)} class="text-red-400 hover:text-red-300">✕</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </fieldset>
    );
}
