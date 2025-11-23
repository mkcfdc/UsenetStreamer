### Usage

Do not include the `PROWLARR_` or `HYDRA_` environment variables.

```bash
  Usage:
    deno task manage <command> [options]

  Commands:
    list                Show all configured indexers
    add                 Add a new indexer
      --name, -n        Name of the indexer
      --url, -u         Base URL (e.g. https://api.nzbgeek.info)
      --key, -k         API Key
    remove <id>         Remove an indexer by ID
    enable <id>         Enable an indexer
    disable <id>        Disable an indexer
```

To use the manage CLI you must first enter your container

```sh
docker compose exec -it usenetstreamer sh
```

Then just use the cli:

```sh
deno task manage add --name <NAME OF INDEX> --url <https://api.indexer.com> --key <YOUR API KEY>
```

You can also list current indexers:

```sh
deno task manage list
```

And you can remove/enable/disable them as needed.

### Why?

Using a direct API call to the index reduces application overhead by removing
the dependency on NzbHydra or Prowlarr. The one downside to this is we lose some
telemetry, but the performance increase is awesome!
