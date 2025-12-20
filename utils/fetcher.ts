/**
 * Custom Error class that includes the server's response body in the message.
 */
export class HttpError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly url: string;
    readonly data: unknown;

    constructor(response: Response, data: unknown) {
        const serverMessage = typeof data === "string"
            ? data
            : (data as Record<string, unknown>)?.error ??
            (data as Record<string, unknown>)?.message ??
            (data ? JSON.stringify(data) : "");

        super(
            serverMessage
                ? `Request failed (${response.status}): ${serverMessage}`
                : `Request failed with status ${response.status}: ${response.statusText}`
        );

        this.name = "HttpError";
        this.status = response.status;
        this.statusText = response.statusText;
        this.url = response.url;
        this.data = data;

        // Capture stack trace properly in V8
        Error.captureStackTrace?.(this, HttpError);
    }
}

export interface FetcherOptions extends Omit<RequestInit, "body"> {
    body?: unknown;
    parseJson?: boolean;
    timeoutMs?: number;
    params?: Record<string, string | number | boolean | undefined | null>;
}

// Pre-allocated constants
const JSON_CONTENT_TYPE = "application/json";
const CONTENT_TYPE = "Content-Type";
const ACCEPT = "Accept";

// Reusable type guards
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null &&
    typeof v === "object" &&
    !(v instanceof FormData) &&
    !(v instanceof Blob) &&
    !(v instanceof URLSearchParams) &&
    !(v instanceof ArrayBuffer);

export async function fetcher<T = unknown>(
    input: string | URL,
    options: FetcherOptions = {},
): Promise<T> {
    const {
        parseJson = true,
        timeoutMs = 10000,
        headers: initHeaders,
        params,
        body,
        method = "GET",
        signal: externalSignal,
        ...fetchOptions
    } = options;

    // 1. URL Construction
    const url = typeof input === "string" ? new URL(input) : input;

    if (params) {
        const searchParams = url.searchParams;
        for (const key in params) {
            const value = params[key];
            if (value != null) {
                searchParams.set(key, String(value));
            }
        }
    }

    // 2. Headers & Body
    const headers = new Headers(initHeaders);
    const isGet = method === "GET" || method === "get";

    let finalBody: BodyInit | undefined;

    if (!isGet && body !== undefined) {
        if (isPlainObject(body)) {
            finalBody = JSON.stringify(body);
            if (!headers.has(CONTENT_TYPE)) {
                headers.set(CONTENT_TYPE, JSON_CONTENT_TYPE);
            }
        } else {
            finalBody = body as BodyInit;
        }
    }

    // GET requests: ensure no Content-Type
    if (isGet) {
        headers.delete(CONTENT_TYPE);
    }

    if (parseJson && !headers.has(ACCEPT)) {
        headers.set(ACCEPT, JSON_CONTENT_TYPE);
    }

    // 3. Abort Handling
    const controller = new AbortController();
    const signal = controller.signal;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Link external signal if provided
    const onExternalAbort = externalSignal
        ? () => controller.abort()
        : undefined;

    if (onExternalAbort) {
        externalSignal!.addEventListener("abort", onExternalAbort);
    }

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            method,
            headers,
            body: finalBody,
            signal,
        });

        if (!response.ok) {
            const contentType = response.headers.get("content-type");
            let errorData: unknown;

            try {
                errorData = contentType?.includes("json")
                    ? await response.json()
                    : (await response.text()).trim();
            } catch {
                errorData = "Unknown error (could not parse body)";
            }

            throw new HttpError(response, errorData);
        }

        // 204 No Content
        if (response.status === 204) {
            return null as T;
        }

        if (!parseJson) {
            return response as unknown as T;
        }

        return await response.json() as T;

    } catch (err) {
        if ((err as Error).name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
        if (onExternalAbort) {
            externalSignal!.removeEventListener("abort", onExternalAbort);
        }
    }
}

/**
 * Fire-and-forget fetch - doesn't wait for response body
 * Useful for logging endpoints, webhooks, etc.
 */
export function fetcherFireAndForget(
    input: string | URL,
    options: FetcherOptions = {},
): void {
    fetcher(input, { ...options, parseJson: false }).catch(() => { });
}

/**
 * Fetch with automatic retry and exponential backoff
 */
export async function fetcherWithRetry<T = unknown>(
    input: string | URL,
    options: FetcherOptions & {
        retries?: number;
        retryDelay?: number;
        retryOn?: (error: unknown, attempt: number) => boolean;
    } = {},
): Promise<T> {
    const {
        retries = 3,
        retryDelay = 1000,
        retryOn = (err) => err instanceof HttpError && err.status >= 500,
        ...fetcherOptions
    } = options;

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetcher<T>(input, fetcherOptions);
        } catch (err) {
            lastError = err;

            if (attempt < retries && retryOn(err, attempt)) {
                await new Promise(r => setTimeout(r, retryDelay * (2 ** attempt)));
                continue;
            }

            throw err;
        }
    }

    throw lastError;
}
