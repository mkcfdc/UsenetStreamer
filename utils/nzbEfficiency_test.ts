import { assertEquals, assertFalse, assert } from "jsr:@std/assert@1";
import {
    internalAddonBaseUrl,
    internalNzbProxyUrl,
    isNzbCheckEnabled,
    isNzbCheckKeyUsable,
    startRank,
} from "./nzbEfficiency.ts";

Deno.test("dummy NZBCheck keys are disabled", () => {
    assertFalse(isNzbCheckKeyUsable(""));
    assertFalse(isNzbCheckKeyUsable("SECURE_TRUSTED_KEY"));
    assertFalse(isNzbCheckKeyUsable("SUPER_SECURE_KEY_NO_ONE_KNOWS"));
    assertFalse(isNzbCheckKeyUsable("your-api-key"));
    assertFalse(isNzbCheckEnabled("https://nzbcheck.filmwhisper.dev", "SECURE_TRUSTED_KEY"));
    assert(isNzbCheckKeyUsable("d35e0a0349ad428fbee48629881d6523"));
    assert(isNzbCheckEnabled("https://nzbcheck.example", "d35e0a0349ad428fbee48629881d6523"));
});

Deno.test("internal addon URL prefers compose DNS over LAN/HTTPS", () => {
    assertEquals(
        internalAddonBaseUrl("", "http://192.168.0.215:7001", 7000),
        "http://usenetstreamer:7000",
    );
    assertEquals(
        internalAddonBaseUrl("", "https://usenet.inter.ian.rocks", 7000),
        "http://usenetstreamer:7000",
    );
    assertEquals(
        internalAddonBaseUrl("http://usenetstreamer:7000", "https://public.example", 7000),
        "http://usenetstreamer:7000",
    );
    assertEquals(
        internalAddonBaseUrl("", "http://usenetstreamer:7000", 7000),
        "http://usenetstreamer:7000",
    );
});

Deno.test("proxy URL stays on internal host", () => {
    assertEquals(
        internalNzbProxyUrl("http://usenetstreamer:7000", "abc"),
        "http://usenetstreamer:7000/nzb/proxy/abc.nzb",
    );
});

Deno.test("1080p ranks above 2160p for cold start", () => {
    assert(startRank("1080p", 4e9) > startRank("2160p", 20e9));
    assert(startRank("1080p", 5e9) > startRank("720p", 2e9));
    assert(startRank("2160p", 8e9) > startRank("2160p", 25e9));
});
