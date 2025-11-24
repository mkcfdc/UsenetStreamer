### Usage

Do not include the `PROWLARR_` or `HYDRA_` environment variables.

The manage command is now interactive, you can just type `manage` into the
container cli and it will walk you through how to add indexers.

```bash
👋 Indexer Manager
---------------------------
Please select an action:
  [L] List Indexers
  [A] Add Indexer
  [R] Remove Indexer
  [E] Enable/Disable
  [Q] Quit

>
```

```bash
  Usage:
    manage <command> [options]

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
manage manage add --name <NAME OF INDEX> --url <https://api.indexer.com> --key <YOUR API KEY>
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

### Adding to presets:

If you would like to add more presets, please make a pull request against the
[indexer_presets.json](/indexer_presets.json) file. Be sure to follow the json
format. Together we can make a really awesome list!
