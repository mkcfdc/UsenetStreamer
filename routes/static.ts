import { join } from "@std/path/posix";
import type { RouteMatch } from "./types.ts";

// In-Memory Asset Cache
let ICON_CACHE: Uint8Array | null = null;

export const staticIconRoute: RouteMatch = {
  pattern: new URLPattern({ pathname: "/assets/icon.png" }),
  methods: ["GET"],
  handler: async (_req: Request, _match: URLPatternResult): Promise<Response> => {
    try {
      if (!ICON_CACHE) {
        const iconPath = join(Deno.cwd(), "public", "assets", "icon.png");
        ICON_CACHE = await Deno.readFile(iconPath);
      }
      // Ensure Blob receives an ArrayBuffer-backed view by copying into a new Uint8Array
      const blobData = Uint8Array.from(ICON_CACHE!);
      return new Response(new Blob([blobData], { type: "image/png" }), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      console.error("Failed to load icon.png:", err);
      return new Response("Not found", { status: 404 });
    }
  },
};

// Also handle the path with apiKey prefix for backwards compatibility
export const staticIconRouteWithPrefix: RouteMatch = {
  pattern: new URLPattern({ pathname: "/:apiKey/assets/icon.png" }),
  methods: ["GET"],
  handler: async (req: Request, match: URLPatternResult): Promise<Response> => {
    return staticIconRoute.handler(req, match);
  },
};
