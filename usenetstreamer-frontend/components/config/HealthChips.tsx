import { useEffect, useState } from "preact/hooks";

type Chip = { ok: boolean; label: string; detail: string };

const empty: Chip = { ok: false, label: "…", detail: "Checking" };

export function HealthChips() {
    const [chips, setChips] = useState<Chip[]>([
        { ...empty, label: "Redis" },
        { ...empty, label: "InfiniDysk" },
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
                { ok: false, label: "InfiniDysk", detail: "Health API failed" },
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
                    class={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs ${
                        loading
                            ? "border-line bg-night text-mute"
                            : chip.ok
                            ? "border-emerald-900 bg-emerald-950/40 text-emerald-300"
                            : "border-amber-900 bg-amber-950/30 text-amber-200"
                    }`}
                >
                    <span class={`h-1.5 w-1.5 rounded-full ${loading ? "bg-faint" : chip.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                    {chip.label}
                    <span class="font-normal text-faint">{chip.detail}</span>
                </span>
            ))}
            <button
                type="button"
                onClick={() => { setLoading(true); refresh(); }}
                class="ml-auto text-xs text-faint hover:text-ink"
            >
                Refresh
            </button>
        </div>
    );
}
