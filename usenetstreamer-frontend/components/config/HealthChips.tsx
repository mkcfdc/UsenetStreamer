import { useEffect, useState } from "preact/hooks";

type Chip = { ok: boolean; label: string; detail: string };

const empty: Chip = { ok: false, label: "…", detail: "Checking" };

export function HealthChips() {
    const [chips, setChips] = useState<Chip[]>([
        { ...empty, label: "Redis" },
        { ...empty, label: "NZBDav" },
        { ...empty, label: "Indexers" },
    ]);
    const [loading, setLoading] = useState(true);

    const refresh = async () => {
        try {
            const res = await fetch("/api/health");
            if (!res.ok) throw new Error("health failed");
            const data = await res.json();
            setChips([data.redis, data.nzbdav, data.indexers]);
        } catch {
            setChips([
                { ok: false, label: "Redis", detail: "Health API failed" },
                { ok: false, label: "NZBDav", detail: "Health API failed" },
                { ok: false, label: "Indexers", detail: "Health API failed" },
            ]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 15000);
        return () => clearInterval(id);
    }, []);

    return (
        <div class="mb-8 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
                <span
                    key={chip.label}
                    title={chip.detail}
                    class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                        loading
                            ? "border-slate-700 bg-slate-800/80 text-slate-400"
                            : chip.ok
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                >
                    <span class={`h-1.5 w-1.5 rounded-full ${loading ? "bg-slate-500" : chip.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                    {chip.label}
                    <span class="font-normal text-slate-400">{chip.detail}</span>
                </span>
            ))}
            <button
                type="button"
                onClick={() => { setLoading(true); refresh(); }}
                class="ml-auto text-xs text-slate-500 hover:text-sky-400"
            >
                Refresh
            </button>
        </div>
    );
}
