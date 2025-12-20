export interface RouteMatch {
    pattern: URLPattern;
    methods: string[];
    handler: (req: Request, match: URLPatternResult) => Promise<Response>;
}

export interface Stream {
    name: string;
    title: string;
    url?: string;
    nzbUrl?: string;
    servers?: string[];
    size: number;
    behaviorHints?: {
        notWebReady?: boolean;
        bingeGroup?: string;
        proxyHeaders?: Record<string, string>;
        countryWhitelist?: string[];
    };
}

export interface ProcessedResult {
    result: any;
    guid: string;
    indexer: string;
}
