import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

export function StremioSection({ config, onChange }: Props) {
    const [showSecret, setShowSecret] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const generateSecret = () => {
        const uuid = crypto.randomUUID();

        const event = {
            target: {
                name: "ADDON_SHARED_SECRET",
                value: uuid,
                type: "text",
            }
        } as unknown as Event;

        onChange(event);
        setShowSecret(true);
    };

    const handleTestManifest = async () => {
        setTesting(true);
        setTestResult(null);

        if (!config.ADDON_BASE_URL || !config.ADDON_SHARED_SECRET) {
            alert("Please enter Base URL and Secret before testing.");
            setTesting(false);
            return;
        }

        if (!config.ADDON_BASE_URL.startsWith("https://")) {
            setTestResult({
                success: false,
                message: "Stremio requires HTTPS. Your URL starts with http://"
            });
            setTesting(false);
            return;
        }

        try {
            const response = await fetch("/api/test_manifest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ADDON_BASE_URL: config.ADDON_BASE_URL,
                    ADDON_SHARED_SECRET: config.ADDON_SHARED_SECRET
                }),
            });

            const data = await response.json();
            setTestResult(data);

        } catch (error: any) {
            console.error("Test failed", error);
            setTestResult({ success: false, message: "Server Error: " + error.message });
        } finally {
            setTesting(false);
        }
    };

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <div class="flex items-center justify-between mb-6">
                <legend class="text-xl font-bold text-teal-400">Stremio Addon</legend>
                <button
                    type="button"
                    onClick={handleTestManifest}
                    disabled={testing || !config.ADDON_BASE_URL}
                    class="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-all text-sm font-medium disabled:opacity-50"
                >
                    {testing ? (
                        <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    )}
                    Test Manifest
                </button>
            </div>

            {/* Test Result Display */}
            {testResult && (
                <div class={`mb-6 p-3 rounded-lg border ${testResult.success ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                    <div class="flex items-center gap-2 font-bold text-sm mb-1">
                        {testResult.success ? (
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        ) : (
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        )}
                        {testResult.success ? "Verification Successful" : "Verification Failed"}
                    </div>
                    <div class="text-xs opacity-90">{testResult.message}</div>
                </div>
            )}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="ADDON_BASE_URL" class="block text-sm font-medium text-slate-300 mb-2">Base URL</label>
                    <input type="url" id="ADDON_BASE_URL" name="ADDON_BASE_URL" value={config.ADDON_BASE_URL} onChange={onChange} required
                        placeholder="https://my-addon.duckdns.org"
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none" />
                    <p class="mt-2 text-xs text-slate-500">Must be public HTTPS (e.g., via DuckDNS + Nginx/Traefik).</p>
                </div>
                <div>
                    <label htmlFor="ADDON_SHARED_SECRET" class="block text-sm font-medium text-slate-300 mb-2">Shared Secret</label>
                    <div class="flex gap-2">
                        <div class="relative flex-1">
                            <input
                                type={showSecret ? "text" : "password"}
                                id="ADDON_SHARED_SECRET"
                                name="ADDON_SHARED_SECRET"
                                value={config.ADDON_SHARED_SECRET}
                                onChange={onChange}
                                required
                                class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => setShowSecret(!showSecret)}
                                class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                                title={showSecret ? "Hide" : "Show"}
                            >
                                {showSecret ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="m2.929 2.929 18.142 18.142"></path></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                )}
                            </button>
                        </div>

                        {/* Generate Button */}
                        <button
                            type="button"
                            onClick={generateSecret}
                            class="px-4 py-2 rounded-lg bg-teal-600/20 text-teal-400 border border-teal-600/30 hover:bg-teal-600/30 transition-all whitespace-nowrap font-medium text-sm flex items-center gap-2"
                            title="Generate a new UUID"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21h5v-5"></path></svg>
                            Generate
                        </button>
                    </div>
                    <p class="mt-2 text-xs text-slate-500">Your API Key for Stremio addon manifest.</p>
                </div>
            </div>
        </fieldset>
    );
}