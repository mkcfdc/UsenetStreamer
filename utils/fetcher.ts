// deno-lint-ignore-file no-explicit-any

/**
 * Custom Error class that includes the server's response body in the message
 * for immediate visibility in logs.
 */
export class HttpError extends Error {
    public status: number;
    public statusText: string;
    public url: string;
    public response: Response;
    public data: any;

    constructor(response: Response, data: any) {
        // Optimization: Append the actual server error text to the message
        // This ensures logs show "400: API Key Missing" instead of just "400: Bad Request"
        const serverMessage = typeof data === 'string'
            ? data
            : (data?.error || data?.message || JSON.stringify(data));

        const cleanMessage = serverMessage
            ? `Request failed (${response.status}): ${serverMessage}`
            : `Request failed with status ${response.status}: ${response.statusText}`;

        super(cleanMessage);

        this.name = "HttpError";
        this.status = response.status;
        this.statusText = response.statusText;
        this.url = response.url;
        this.response = response;
        this.data = data;
    }
}

export interface FetcherOptions extends Omit<RequestInit, "body"> {
    body?: any;
    parseJson?: boolean;
    timeoutMs?: number;
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
        method = "GET", // Default to GET explicitly to help logic below
        ...fetchOptions
    } = options;

    // 1. Construct URL with Params (Deduplication Logic)
    const url = new URL(input.toString());

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                // OPTIMIZATION: Use .set() instead of .append().
                // If 'apikey' is already in the Config.NZBDAV_URL, this prevents 
                // sending "?apikey=XYZ&apikey=XYZ", which causes 400 Errors on SABnzbd.
                url.searchParams.set(key, String(value));
            }
        });
    }

    // 2. Prepare Headers
    const headers = new Headers(initHeaders);

    // 3. Body Transformation
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

    // 4. GET Request Sanitation
    // Strict servers (like some SABnzbd/NZBGet versions) throw 400 if Content-Type is present on GET.
    if (method.toUpperCase() === "GET") {
        headers.delete("Content-Type");
        finalBody = undefined; // Ensure no body is sent on GET
    }

    if (parseJson && !headers.has("Accept")) {
        headers.set("Accept", "application/json");
    }

    // 5. Timeout Handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
    }

    try {
        const response = await fetch(url.toString(), {
            ...fetchOptions,
            method,
            headers,
            body: finalBody,
            signal: controller.signal,
        });

        if (!response.ok) {
            let errorData;
            try {
                const contentType = response.headers.get("content-type");
                // SABnzbd often returns "text/plain" for API errors even if JSON was requested
                if (contentType?.includes("application/json")) {
                    errorData = await response.json();
                } else {
                    errorData = await response.text();
                    // Clean up trailing newlines common in SABnzbd error outputs
                    errorData = errorData.trim();
                }
            } catch {
                errorData = "Unknown error (could not parse body)";
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
