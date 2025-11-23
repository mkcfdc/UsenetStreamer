# UsenetStreamer

<p align="center">
  <img src="public/assets/icon.png" alt="UsenetStreamer logo" width="180" />
</p>

UsenetStreamer is a Stremio addon that bridges Prowlarr and NZBDav. It hosts no
media itself; it simply orchestrates search and streaming through your existing
Usenet stack. The addon searches Usenet indexers via Prowlarr, queues NZB
downloads in NZBDav or altMount, and exposes the resulting media as Stremio
streams.

### This Version uses Deno. Not Node.

### Features added:

1. Rewrote using Deno 2.5 web ready API's where possible to reduce dependencies.
2. RedisJSON Caching for every outside API (Cinemeta, Prowlarr)
3. Auto delete bad lookups. A file fails, automatically delete it from the
   cache.
4. Secure API Keys so they are not shared in URLS.
5. Uses the redis streams: cache to prevent downloading the same thing 500
   times... ooops!
6. Code split so it's easier to follow.
7. Now ES7 compliant.
8. Uses Deno API's to stream direct to client.
9. No more Express dependency. Uses Deno.serve directly. Hopefully this will
   reduce the mem usage by quiet a bit.. we will see, I'm probably wrong.
10. As of 11-10-2025 Prowlarr no longer allows you to disable redirects for
    Usenet indexers. Built a small proxy to get around it since nzbdav does not
    play nice with redirects at the moment.
11. Added support for altMount. It supports multiple Usenet providers & 7zip
    extraction (sometimes).
12. Added .strm support. This might be removed in the future. .strm files are
    just added metadata stored on the actual system. But using .strm will make
    use of altMount's streaming functionality, testing continues.
13. Created an Open API for checking nzb files. This does not put any added
    pressure on the Usenet servers or your Indexer API calls.
    [`More information about nzbcheck API`](docs/NzbCheck_Api.md)
14. Can now work with NzbHydra2. Needs NZBHYDRA_URL & NZBHYDRA_API_KEY
    environment variables.
15. No need for external webdav module. Reducing dependancies done to the bare
    minimum!
16. No need for Prowlarr or NzbHydra. NzbHydra is a resource hog, and since most
    sites use the nzbnab standard api, we can direct query each index ourselves.
    This makes searching instant with 0 overhead.
    [How to setup direct indexing](docs/manage_cli.md)

### How to use nzbcheck.filmwhisper.dev:

1. Create an API key by making an empty POST request to:
   https://nzbcheck.filmwhisper.dev/api-key
2. Fill in the added ENV vars inside .env file.
3. This will add a green check mark to any files that have already been tested
   as working.

```env
NZB_CHECK_URL=https://nzbcheck.filmwhisper.dev
NZB_CHECK_API_KEY=SUPER_SECURE_KEY_NO_ONE_KNOWS
```

This adds no extra work to your server or to your Usenet server. It's very clean
and highly cached. Give it a try and let me know what you think.

### altMount configuration:

`NZBDAV_URL` must be set to: `http://altmount:8080/sabnzbd` `NZBDAV_WEBDAV_URL`
must be set to: `http://altmount:8080/webdav` Don't forget to setup your
categories under /config/sabnzbd. Categories: Movies, Tv; Subdirectory Movies,
Tv !!! Complete directory must be `/content`

### .strm Support

- To enable the use of .strm files, you must enable it by adding
  `USE_STRM_FILES=true` to your .env
- Under Configuration > Import Processing in altMount, set your import stratagy
  to `STRM Files`
- STRM Directory must be /strm

This is very new and experimental, it might be broken, and it might not even be
worth it.

### Features missing in this version:

1. No nzb Triage done to files. This increases hits to indexer api's by a ton. I
   have moved to an external and open api to do this check. It works very well
   and is super fast. I recommend other forks use it too so we can all take
   advantage! [`More information about nzbcheck API`](docs/NzbCheck_Api.md)

### Running stats

Something I've noticed is nzbdav will use 360%~ of CPU when first initalizing a
stream. Keep that in mind when choosing your virtual machine. I've found this
stack to run great on 4 vCPU and 6GB of RAM. It really only bursts when you
start a stream, after that, it's just above idle. docker compose stats

```sh
CONTAINER ID   NAME             CPU %     MEM USAGE / LIMIT     MEM %     NET I/O           BLOCK I/O        PIDS
be097c522f12   usenetstreamer   0.95%     47.69MiB / 22.91GiB   0.27%     15.2GB / 15.1GB   582kB / 5.17MB   8
62ab78b05567   nzbdav           63.47%    269.4MiB / 22.91GiB   1.15%     15.2GB / 15.1GB   4.1kB / 135MB    47
7d7a92a615d0   redis            1.13%     22.73MiB / 22.91GiB   0.10%     4.54MB / 2.73MB   25MB / 18.9MB    6
82a923855e25   prowlarr         0.14%     156.4MiB / 22.91GiB   0.67%     141MB / 135MB     113MB / 125MB    23
```

The above screenshot is streaming 4k 80GB file.

```sh no prowlarr dependency (using direct indexing) [How to setup direct indexing](docs/manage_cli.md)
CONTAINER ID   NAME             CPU %     MEM USAGE / LIMIT     MEM %     NET I/O           BLOCK I/O     PIDS
f38253d96e3c   usenetstreamer   0.02%     46.93MiB / 22.91GiB   0.20%     173kB / 278kB     0B / 5.8MB    10
8be644596e90   usenet_redis     0.92%     12.04MiB / 22.91GiB   0.05%     1.97MB / 1.86MB   0B / 15.7MB   6
63e2ad4d687e   nzbdav           0.72%     185.1MiB / 22.91GiB   0.79%     8.12GB / 7.29GB   0B / 7.9MB    37
```

## Features

- ID-aware search plans (IMDb/TMDB/TVDB) with automatic metadata enrichment.
- Parallel Prowlarr queries with deduplicated NZB aggregation.
- Direct WebDAV streaming from NZBDav (no local mounts required).
- Configurable via environment variables (see `.env.example`).
- Fallback failure clip when NZBDav cannot deliver media.

## Getting Started

1. Copy `.env.example` to `.env` and fill in your Prowlarr/NZBDav credentials
   and addon base URL.
2. Install dependencies:

   ```bash
   deno install
   ```

3. Start the addon:

   ```bash
   deno task dev
   ```

### Docker Usage

The image is published to the GitHub Container Registry. Pull it and run with
your environment variables:

```bash
docker pull ghcr.io/mkcfdc/usenetstreamer:latest

docker run -d \
   --name usenetstreamer \
   -p 7000:7000 \
   -e NZBDAV_URL=http://localhost:3000 \
   -e NZBDAV_API_KEY=your-nzbdav-api-key \
   -e NZBDAV_WEBDAV_URL=http://localhost:3000 \
   -e NZBDAV_WEBDAV_USER=webdav-username \
   -e NZBDAV_WEBDAV_PASS=webdav-password \
   -e ADDON_BASE_URL=https://myusenet.duckdns.org \
   -e ADDON_SHARED_SECRET=your-secret \
   ghcr.io/mkcfdc/usenetstreamer:latest
```

If you prefer to keep secrets in a file, use
`--env-file /path/to/usenetstreamer.env` instead of specifying `-e` flags.

> Need a custom build? Clone this repo, adjust the code, then run
> `docker build -t usenetstreamer .` to create your own image.

## Environment Variables

- `PROWLARR_URL`, `PROWLARR_API_KEY`,
- `NZBDAV_URL`, `NZBDAV_API_KEY`, `NZBDAV_WEBDAV_URL`, `NZBDAV_WEBDAV_USER`,
  `NZBDAV_WEBDAV_PASS`
- `ADDON_BASE_URL` `ADDON_SHARED_SECRET`

`ADDON_SHARED_SECRET` is your API Key.

See `.env.example` for the authoritative list.

### Choosing an `ADDON_BASE_URL`

`ADDON_BASE_URL` must be a **public HTTPS domain** that points to your addon
deployment. Stremio refuses insecure origins, so you must front the addon with
TLS before adding it to the catalog. DuckDNS + Let's Encrypt is an easy path,
but any domain/CA combo works.

1. **Grab a DuckDNS domain (free):**
   - Sign in at [https://www.duckdns.org](https://www.duckdns.org) with
     GitHub/Google/etc.
   - Choose a subdomain (e.g. `myusenet.duckdns.org`) and note the token DuckDNS
     gives you.
   - Run their update script (cron/systemd/timer) so the domain always resolves
     to your server’s IP.

2. **Serve the addon over HTTPS (non-negotiable):**
   - Place Nginx, Caddy, or Traefik in front of the Node server.
   - Issue a certificate:
     - **Let’s Encrypt** with certbot, lego, or Traefik’s built-in ACME
       integration for a trusted cert.
     - DuckDNS also provides an ACME helper if you prefer wildcard certificates.
   - Terminate TLS at the proxy and forward requests from
     `https://<your-domain>` to `http://127.0.0.1:7000` (or your chosen port).
   - Expose `/manifest.json`, `/stream/*`, `/nzb/*`, and `/assets/*`. Stremio
     will reject plain HTTP URLs.

3. **Update `.env`:** set `ADDON_BASE_URL=https://myusenet.duckdns.org` and
   restart the addon so manifests reference the secure URL. Stremio will only
   load the addon when `ADDON_BASE_URL` points to a valid HTTPS domain.

Tips:

- Keep port 7000 (or whichever you use) firewalled; let the reverse proxy handle
  public traffic.
- Renew certificates automatically (cron/systemd timer or your proxy’s
  auto-renew feature).
- If you deploy behind Cloudflare or another CDN, ensure WebDAV/body sizes are
  allowed and HTTPS certificates stay valid.
- Finally, add `https://myusenet.duckdns.org/<SHARED_SECRET>/manifest.json`
  (replace with your domain) to Stremio’s addon catalog. Use straight HTTPS—the
  addon will not show up over HTTP.

  ### Project Dependencies
  - [altMount](https://github.com/javi11/altmount)
  - [nzbDav](https://github.com/nzbdav-dev/nzbdav)
  - [Prowlarr](https://github.com/Prowlarr/Prowlarr)
  - [nzbHydra2](https://github.com/theotherp/nzbhydra2)
