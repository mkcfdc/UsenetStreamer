import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

export function NzbCheckSection({ config, onChange }: Props) {
    const [showKey, setShowKey] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

    const handleGenerateKey = async () => {
        // 1. Validation
        const baseUrl = config.NZB_CHECK_URL?.replace(/\/+$/, "");
        if (!baseUrl) {
            setMessage({ text: "Please enter a valid NZBCheck URL first.", type: "error" });
            return;
        }

        setGenerating(true);
        setMessage(null);

        try {
            // 2. Make the POST request
            const res = await fetch(`${baseUrl}/api-key`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            const data = await res.json();

            if (data.success && data.api_key) {
                // 3. Auto-fill the config by creating a synthetic event
                // This allows us to reuse the parent's standard handleChange function
                const syntheticEvent = {
                    target: {
                        name: "NZB_CHECK_API_KEY",
                        value: data.api_key,
                        type: "text",
                        checked: false
                    }
                } as unknown as Event;

                onChange(syntheticEvent);
                setMessage({ text: "Key generated and applied successfully!", type: "success" });
            } else {
                throw new Error(data.message || "Failed to generate key.");
            }
        } catch (error: any) {
            console.error("Key Gen Error:", error);
            setMessage({ text: "Error: " + (error.message || "Could not reach server"), type: "error" });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-xl font-bold text-sky-400 mb-6">NZBCheck API</legend>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="NZB_CHECK_URL" class="block text-sm font-medium text-slate-300 mb-2">URL</label>
                    <input type="url" id="NZB_CHECK_URL" name="NZB_CHECK_URL" value={config.NZB_CHECK_URL} onChange={onChange} required
                        placeholder="https://nzbcheck.filmwhisper.dev"
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-sky-500 outline-none transition-colors" />
                </div>
                <div>
                    <label htmlFor="NZB_CHECK_API_KEY" class="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                    <div class="flex gap-2">
                        <div class="relative flex-1">
                            <input type={showKey ? "text" : "password"} id="NZB_CHECK_API_KEY" name="NZB_CHECK_API_KEY" value={config.NZB_CHECK_API_KEY} onChange={onChange} required
                                class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-sky-500 outline-none transition-colors" />
                            <button type="button" onClick={() => setShowKey(!showKey)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white" title={showKey ? "Hide" : "Show"}>
                                {showKey ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="m2.929 2.929 18.142 18.142"></path></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                )}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={handleGenerateKey}
                            disabled={generating || !config.NZB_CHECK_URL}
                            class="px-4 py-2 rounded-lg bg-sky-600/20 text-sky-400 border border-sky-600/30 hover:bg-sky-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap font-medium text-sm flex items-center gap-2"
                        >
                            {generating ? (
                                <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                            )}
                            Generate
                        </button>
                    </div>
                    {message && (
                        <p class={`mt-2 text-xs ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                            {message.text}
                        </p>
                    )}
                </div>
            </div>
        </fieldset>
    );
}
