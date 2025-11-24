export interface Preset {
    name: string;
    url: string;
}


const PRESETS_URL =
    "https://raw.githubusercontent.com/mkcfdc/UsenetStreamer/refs/heads/master/indexer_presets.json";

const DEFAULT_PRESETS: Preset[] = [
    { name: "NZBGeek", url: "https://api.nzbgeek.info" },
    { name: "DrunkenSlug", url: "https://api.drunkenslug.com" },
    { name: "NZBPlanet", url: "https://api.nzbplanet.net" },
    { name: "SimplyNZBs", url: "https://simplynzbs.com" },
];


export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = 5000,
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

export async function getPresets(): Promise<Preset[]> {
    try {
        const response = await fetchWithTimeout(PRESETS_URL, {}, 3000);
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                return data as Preset[];
            }
        }
    } catch {
        // Fallback silently
    }
    return DEFAULT_PRESETS;
}

export async function validateIndexer(url: string, key: string): Promise<boolean> {
    try {
        const baseUrl = url.replace(/\/$/, "");
        const testUrl = `${baseUrl}/api?t=caps&apikey=${key}`;

        const response = await fetchWithTimeout(testUrl);
        if (!response.ok) return false;

        const text = await response.text();
        if (text.includes("<error")) return false;
        return text.includes("<caps") || text.includes("<rss");
    } catch {
        return false;
    }
}