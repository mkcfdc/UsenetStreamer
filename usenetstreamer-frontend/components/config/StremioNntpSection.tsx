import { useState, useEffect } from "preact/hooks";
import { Config } from "../../utils/configTypes.ts";
import type { NntpServer } from "../../utils/sqlite.ts";

interface Props {
    config: Config;
}

export function StremioNNTPSection({ config }: Props) {
    const [servers, setServers] = useState<NntpServer[]>([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

    // Form State
    const [newServer, setNewServer] = useState({
        name: "",
        host: "",
        port: 563,
        username: "",
        password: "",
        ssl: true,
        connection_count: 4,
        priority: 0
    });

    useEffect(() => {
        if (config.USE_STREMIO_NNTP) {
            fetchServers();
        }
    }, [config.USE_STREMIO_NNTP]);

    const fetchServers = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/nntp");
            if (res.ok) setServers(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const value = target.type === 'checkbox' ? target.checked : target.value;
        setNewServer(prev => ({ ...prev, [target.name]: value }));
    };

    const handleAddServer = async (e: Event) => {
        e.preventDefault();
        setSubmitting(true);
        setMessage(null);

        try {
            const res = await fetch("/api/nntp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newServer),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message);

            setMessage({ text: "Server added successfully!", type: "success" });
            // Reset form
            setNewServer({ name: "", host: "", port: 563, username: "", password: "", ssl: true, connection_count: 4, priority: 0 });
            fetchServers();
        } catch (e: any) {
            setMessage({ text: e.message, type: "error" });
        } finally {
            setSubmitting(false);
            setTimeout(() => setMessage(curr => curr?.type === 'success' ? null : curr), 3000);
        }
    };

    const handleToggle = async (id: number, currentStatus: number) => {
        await fetch(`/api/nntp/${id}/toggle`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: currentStatus !== 1 }), // Note: 1 = Active, anything else = inactive
        });
        fetchServers();
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Remove this server?")) return;
        await fetch(`/api/nntp/${id}`, { method: "DELETE" });
        fetchServers();
    };

    if (!config.USE_STREMIO_NNTP) return null;

    return (
        <fieldset class="mb-10 pb-8 border-b border-white/5">
            <legend class="text-2xl font-bold text-violet-400 mb-8">Usenet Providers</legend>

            <div class="bg-slate-800 rounded-xl border border-white/10 p-6">

                <form onSubmit={handleAddServer} class="mb-8">
                    <h3 class="text-lg font-semibold text-white mb-4">Add New Server</h3>
                    {message && (
                        <div class={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                            {message.text}
                        </div>
                    )}

                    <div class="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div class="md:col-span-4">
                            <label class="block text-xs text-slate-400 mb-1">Name</label>
                            <input type="text" name="name" placeholder="Provider Name" value={newServer.name} onChange={handleInputChange} required
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>
                        <div class="md:col-span-6">
                            <label class="block text-xs text-slate-400 mb-1">Host</label>
                            <input type="text" name="host" placeholder="news.provider.com" value={newServer.host} onChange={handleInputChange} required
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-xs text-slate-400 mb-1">Port</label>
                            <input type="number" name="port" placeholder="563" value={newServer.port} onChange={handleInputChange} required
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>

                        <div class="md:col-span-4">
                            <label class="block text-xs text-slate-400 mb-1">Username</label>
                            <input type="text" name="username" placeholder="Username" value={newServer.username} onChange={handleInputChange}
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>
                        <div class="md:col-span-4">
                            <label class="block text-xs text-slate-400 mb-1">Password</label>
                            <input type="password" name="password" placeholder="Password" value={newServer.password} onChange={handleInputChange}
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-xs text-slate-400 mb-1">Connections</label>
                            <input type="number" name="connection_count" placeholder="4" value={newServer.connection_count} onChange={handleInputChange}
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>

                        {/* Priority and SSL */}
                        <div class="md:col-span-1">
                            <label class="block text-xs text-slate-400 mb-1">Pri</label>
                            <input type="number" name="priority" placeholder="0" value={newServer.priority} onChange={handleInputChange}
                                class="w-full p-2.5 rounded bg-slate-900 border border-white/10 text-white focus:border-violet-500 outline-none" />
                        </div>

                        <div class="md:col-span-1 flex flex-col justify-end">
                            <label class="flex items-center justify-center h-[42px] bg-slate-900 rounded border border-white/10 cursor-pointer">
                                <input type="checkbox" name="ssl" checked={newServer.ssl} onChange={handleInputChange} class="accent-violet-500 w-4 h-4" />
                                <span class="text-xs text-slate-300 ml-1">SSL</span>
                            </label>
                        </div>
                    </div>

                    <div class="mt-4 text-right">
                        <button type="submit" disabled={submitting} class="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                            {submitting ? "Adding..." : "Add Server"}
                        </button>
                    </div>
                </form>

                <hr class="border-white/10 mb-6" />

                <div class="space-y-3">
                    {loading ? (
                        <div class="text-center text-slate-500 py-4">Loading servers...</div>
                    ) : servers.length === 0 ? (
                        <div class="text-center text-slate-500 py-4">No servers configured.</div>
                    ) : (
                        servers.map(server => (
                            <div key={server.id} class={`flex flex-col md:flex-row items-center justify-between p-4 rounded-lg border ${server.active === 1 ? 'bg-slate-700/50 border-white/10' : 'bg-slate-800/50 border-white/5 opacity-75'}`}>
                                <div class="flex-1">
                                    <div class="flex items-center gap-3">
                                        <h4 class="font-bold text-white text-lg">{server.name}</h4>
                                        <span class="text-xs px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/10" title="Connections">Conn: {server.connection_count}</span>
                                        <span class="text-xs px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/10" title="Priority">Pri: {server.priority}</span>
                                        {server.ssl === 1 && <span class="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">SSL</span>}
                                    </div>
                                    <div class="text-sm text-slate-400 font-mono mt-1 flex items-center gap-2">
                                        <span>{server.host}:{server.port}</span>
                                        <span class="text-slate-600">|</span>
                                        <span>{server.username || 'No Auth'}</span>
                                    </div>
                                </div>

                                <div class="flex items-center gap-3 mt-3 md:mt-0">
                                    <button
                                        type="button"
                                        onClick={() => handleToggle(server.id, server.active)}
                                        class={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${server.active === 1 ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                                    >
                                        {server.active === 1 ? 'Active' : 'Disabled'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(server.id)}
                                        class="p-2 text-slate-400 hover:text-red-400 transition-colors"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </fieldset>
    );
}
