export interface StreamCache {
    downloadUrl: string;
    size: number;
    guid?: string;
    indexer?: string;
    title: string;
    fileName: string;
    prowlarrId?: string;
    nzbId?: string;
    type: "series" | "movie";
    rawImdbId?: string;
    status?: "failed" | "ready" | "pending";
    failureMessage?: string;
    nzoId?: string;
}

export interface StreamResult {
    nzoId?: string;
    guid?: string;
    indexer?: string;
    category: string;
    jobName: string;
    viewPath: string;
    size?: number;
    fileName: string;
    downloadUrl?: string;
    title?: string;
    rawImdbId?: string;
    inFileSystem?: boolean;
    status: "failed" | "ready" | "pending";
}

export interface NzbHistorySlot {
    nzoId: string;
    status: string;
    failMessage?: string;
    category: string;
    jobName: string;
    name?: string;
}