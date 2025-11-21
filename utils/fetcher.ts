// deno-lint-ignore-file no-explicit-any

/**
 * Custom Error class to expose status codes and API error responses
 */
export class HttpError extends Error {
    public status: number;
    public statusText: string;
    public url: string;
    public response: Response;
    public data: any;

    constructor(response: Response, data: any) {
        super(`Request failed with status ${response.status}: ${response.statusText}`);
        this.name = "HttpError";
        this.status = response.status;
        this.statusText = response.statusText;
        this.url = response.url;
        this.response = response;
        this.data = data;
    }
}

export interface FetcherOptions extends Omit<RequestInit, "body"> {
    // Allow body to be an object which will be auto-stringified
    body?: any;
    parseJson?: boolean;
    timeoutMs?: number;
    // Helper for query parameters
    params?: Record<string, string | number | boolean | undefined | null>;
}

export async function fetcher<T = any>(
    input: string | URL,
    options: FetcherOptions = {}
): Promise<T> {
    const {
        parseJson = true,
        timeoutMs = 10000,
        headers: initHeaders,
        params,
        body,
        ...fetchOptions
    } = options;

    // 1. Construct URL with Params
    const url = new URL(input.toString());
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value));
            }
        });
    }

    // 2. Prepare Headers (Auto-set JSON headers)
    const headers = new Headers(initHeaders);

    // 3. Handle Body transformation (Auto-stringify plain objects)
    let finalBody = body;
    const isPlainObject = body && typeof body === "object" &&
        !(body instanceof FormData) &&
        !(body instanceof Blob) &&
        !(body instanceof URLSearchParams);

    if (isPlainObject) {
        finalBody = JSON.stringify(body);
        if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
    }

    if (parseJson && !headers.has("Accept")) {
        headers.set("Accept", "application/json");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
    }

    try {
        const response = await fetch(url.toString(), {
            ...fetchOptions,
            headers,
            body: finalBody,
            signal: controller.signal,
        });

        // 5. Unified Error Handling
        if (!response.ok) {
            let errorData;
            try {
                const contentType = response.headers.get("content-type");
                if (contentType?.includes("application/json")) {
                    errorData = await response.json();
                } else {
                    errorData = await response.text();
                }
            } catch {
                errorData = null;
            }
            throw new HttpError(response, errorData);
        }

        if (response.status === 204) {
            return null as T;
        }

        if (!parseJson) {
            return response as unknown as T;
        }

        return await response.json();

    } catch (err: any) {
        if (err.name === "AbortError") {
            throw new Error(`Request timed out or was aborted after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}
