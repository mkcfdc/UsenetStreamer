import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

export function RedisSection({ config, onChange }: Props) {
    const [showPassword, setShowPassword] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleTestRedis = async () => {
        setTesting(true);
        setTestResult(null);

        if (!config.REDIS_URL) {
            alert("Please enter a Redis URL before testing.");
            setTesting(false);
            return;
        }

        // Basic format validation
        if (!config.REDIS_URL.startsWith("redis://") && !config.REDIS_URL.startsWith("rediss://")) {
            setTestResult({
                success: false,
                message: "Invalid format. URL must start with redis:// or rediss://"
            });
            setTesting(false);
            return;
        }

        try {
            // Assuming you have an endpoint to test redis connectivity
            const response = await fetch("/api/test_redis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    REDIS_URL: config.REDIS_URL,
                }),
            });

            const data = await response.json();
            setTestResult(data);

        } catch (error: any) {
            console.error("Redis Test failed", error);
            setTestResult({ success: false, message: "Server Error: " + error.message });
        } finally {
            setTesting(false);
        }
    };

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <div class="flex items-center justify-between mb-6">
                <legend class="text-xl font-bold text-teal-400">Redis Database</legend>
                <button
                    type="button"
                    onClick={handleTestRedis}
                    disabled={testing || !config.REDIS_URL}
                    class="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-all text-sm font-medium disabled:opacity-50"
                >
                    {testing ? (
                        <div class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"></div>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s 9-1.34 9-3V5"></path></svg>
                    )}
                    Test Connection
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
                        {testResult.success ? "Connected Successfully" : "Connection Failed"}
                    </div>
                    <div class="text-xs opacity-90">{testResult.message}</div>
                </div>
            )}

            <div>
                <label htmlFor="REDIS_URL" class="block text-sm font-medium text-slate-300 mb-2">Connection String</label>
                <div class="relative">
                    <input
                        type={showPassword ? "text" : "password"}
                        id="REDIS_URL"
                        name="REDIS_URL"
                        value={config.REDIS_URL}
                        onChange={onChange}
                        required
                        placeholder="redis://:password@localhost:6379"
                        class="w-full p-3 pr-10 rounded-lg bg-slate-800 border border-white/10 text-white focus:ring-2 focus:ring-teal-500 outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                        title={showPassword ? "Hide" : "Show"}
                    >
                        {showPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="m2.929 2.929 18.142 18.142"></path></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        )}
                    </button>
                </div>
                <p class="mt-2 text-xs text-slate-500">
                    Format: <code class="bg-slate-700/50 px-1 py-0.5 rounded text-teal-400">redis://:password@host:port</code> or <code class="bg-slate-700/50 px-1 py-0.5 rounded text-teal-400">rediss://</code> for TLS.
                </p>
            </div>
        </fieldset>
    );
}
