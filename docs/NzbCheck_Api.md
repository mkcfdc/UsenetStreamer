### How to use nzbcheck.filmwhisper.dev

First create an API key by making a curl request to
https://nzbcheck.filmwhisper.dev

```sh
curl --request POST \
  --url https://nzbcheck.filmwhisper.dev/api-key
```

This will give you an API Key.

```json
{
  "success": true,
  "message": "API Key created successfully. Save this key now; it cannot be retrieved later.",
  "api_key": "30fe1f53-0ef1-4689-bef3-7c31a1ab432b",
  "account_id": null,
  "trust_score": 50
}
```

Now you can make requests to the global API

Search the database like this:

```sh
curl --request POST \
  --url https://nzbcheck.filmwhisper.dev/status/search \
  --header 'X-API-KEY: 50fe1f53-0ef1-4689-bef3-7c31a1ab432b' \
  --header 'content-type: application/json' \
  --data '{
  "items": [
    {
      "source_indexer": "nzbgeek",
      "file_id": "e10af01fb317b7869f02482c0bc7eade"
    },
    {
      "source_indexer": "nzbplanet",
      "file_id": "d1103f9fc33b22af4da726ddd6af290e"
    },
    {
      "source_indexer": "nzbplanet",
      "file_id": "db1103f9fc33b22af4da726ddd6af290e"
    }
  ]
}'
```

Submit to the database like this:

```sh
curl -X POST "https://nzbcheck.filmwhisper.dev/status" \
     -H "Content-Type: application/json" \
     -H "X-API-KEY: 50fe1f53-0ef1-4689-bef3-7c31a1ab432b" \
     -d '{
           "file_id": "THIS_IS_THE_GUID",
           "indexer": "nzbgeek",
           "is_complete": true,
           "status_message": "YOUR_MESSAGE"
         }'
```

"is_complete" should be false if the nzb fails. "file_id" is the guid of the
file on the indexer. "indexer" is the name of the indexer. Do not include
https:// or the .tld; Just the basic name.

If the file does not exist in the database, no response is given.

Using this API will allow all of use to keep track of active files and keep
streams clean and fast! Without putting any extra load on your indexers & the
usenet.
