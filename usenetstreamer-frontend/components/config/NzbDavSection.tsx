// components/config/NzbDavSection.tsx
// components/config/NzbDavSection.tsx
import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

interface TestResult {
    success: boolean;
    message: string;
}

interface TestResults {
    nzbdav: TestResult;
    webdav: TestResult;
}

export function NzbDavSection({ config, onChange }: Props) {
    const [showKey, setShowKey] = useState(false);
    const [showPass, setShowPass] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResults, setTestResults] = useState<TestResults | null>(null);

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResults(null);

        // Validate we have minimal data to test
        if (!config.NZBDAV_URL || !config.NZBDAV_WEBDAV_URL) {
            alert("Please enter URLs before testing.");
            setTesting(false);
            return;
        }

        try {
            const response = await fetch("/api/test_nzbdav", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // We send the current config state, not just saved DB state
                body: JSON.stringify({
                    NZBDAV_URL: config.NZBDAV_URL,
                    NZBDAV_API_KEY: config.NZBDAV_API_KEY,
                    NZBDAV_WEBDAV_URL: config.NZBDAV_WEBDAV_URL,
                    NZBDAV_WEBDAV_USER: config.NZBDAV_WEBDAV_USER,
                    NZBDAV_WEBDAV_PASS: config.NZBDAV_WEBDAV_PASS
                }),
            });

            const data = await response.json();
            setTestResults(data);

        } catch (error) {
            console.error("Test failed", error);
            alert("Failed to run test. Check console.");
        } finally {
            setTesting(false);
        }
    };

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <div class="flex items-center justify-between mb-6">
                <legend class="text-xl font-bold text-cyan-400">NZBDav / altMount</legend>
                <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testing}
                    class="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all text-sm font-medium disabled:opacity-50"
                >
                    {testing ? (
                        <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    )}
                    Test Connectivity
                </button>
            </div>

            {/* Test Results Display */}
            {testResults && (
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div class={`p-3 rounded-lg border ${testResults.nzbdav.success ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                        <div class="flex items-center gap-2 font-bold text-sm mb-1">
                            {testResults.nzbdav.success ? (
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                            ) : (
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            )}
                            NZBDav API
                        </div>
                        <div class="text-xs opacity-80">{testResults.nzbdav.message}</div>
                    </div>
                    <div class={`p-3 rounded-lg border ${testResults.webdav.success ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                        <div class="flex items-center gap-2 font-bold text-sm mb-1">
                            {testResults.webdav.success ? (
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                            ) : (
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            )}
                            WebDAV
                        </div>
                        <div class="text-xs opacity-80">{testResults.webdav.message}</div>
                    </div>
                </div>
            )}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                    <label htmlFor="NZBDAV_URL" class="block text-sm font-medium text-slate-300 mb-2">NZBDav URL</label>
                    <input type="url" id="NZBDAV_URL" name="NZBDAV_URL" value={config.NZBDAV_URL} onChange={onChange} required
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                </div>
                <div>
                    <label htmlFor="NZBDAV_API_KEY" class="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                    <div class="relative">
                        <input type={showKey ? "text" : "password"} id="NZBDAV_API_KEY" name="NZBDAV_API_KEY" value={config.NZBDAV_API_KEY} onChange={onChange} required
                            class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                        <button type="button" onClick={() => setShowKey(!showKey)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white">
                            {showKey ? "Hide" : "Show"}
                        </button>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label htmlFor="NZBDAV_WEBDAV_URL" class="block text-sm font-medium text-slate-300 mb-2">WebDAV URL</label>
                    <input type="url" id="NZBDAV_WEBDAV_URL" name="NZBDAV_WEBDAV_URL" value={config.NZBDAV_WEBDAV_URL} onChange={onChange} required
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                </div>
                <div>
                    <label htmlFor="NZBDAV_WEBDAV_USER" class="block text-sm font-medium text-slate-300 mb-2">Username</label>
                    <input type="text" id="NZBDAV_WEBDAV_USER" name="NZBDAV_WEBDAV_USER" value={config.NZBDAV_WEBDAV_USER} onChange={onChange} required
                        class="w-full p-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                </div>
                <div>
                    <label htmlFor="NZBDAV_WEBDAV_PASS" class="block text-sm font-medium text-slate-300 mb-2">Password</label>
                    <div class="relative">
                        <input type={showPass ? "text" : "password"} id="NZBDAV_WEBDAV_PASS" name="NZBDAV_WEBDAV_PASS" value={config.NZBDAV_WEBDAV_PASS} onChange={onChange} required
                            class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-cyan-500 outline-none" />
                        <button type="button" onClick={() => setShowPass(!showPass)} class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white">
                            {showPass ? "Hide" : "Show"}
                        </button>
                    </div>
                </div>
            </div>
        </fieldset>
    );
}

