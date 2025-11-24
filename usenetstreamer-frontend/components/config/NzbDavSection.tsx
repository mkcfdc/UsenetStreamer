// components/config/NzbDavSection.tsx
import { useState } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";

interface Props {
    config: Config;
    onChange: (e: Event) => void;
}

export function NzbDavSection({ config, onChange }: Props) {
    const [showKey, setShowKey] = useState(false);
    const [showPass, setShowPass] = useState(false);

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-xl font-bold text-cyan-400 mb-6">NZBDav / altMount</legend>
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
