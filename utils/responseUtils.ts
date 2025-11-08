export function jsonResponse(data: unknown, status: number = 200, headers: HeadersInit = {}): Response {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
    };
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
            ...headers,
        },
    });
}

export function textResponse(body: string, status: number = 200, headers: HeadersInit = {}): Response {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
    };
    return new Response(body, {
        status,
        headers: {
            "Content-Type": "text/plain",
            ...corsHeaders,
            ...headers,
        },
    });
}