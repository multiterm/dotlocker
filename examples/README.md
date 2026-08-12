# dot.locker examples

[`file-sync/run.sh`](./file-sync/run.sh) demonstrates a token-authenticated push/pull round trip. Set `DOTLOCKER_TOKEN`, `DOTLOCKER_ORG`, and `DOTLOCKER_REPO`, then run it from a directory containing the files to synchronize.

```sh
sh examples/file-sync/run.sh
```

[`sandblocks`](./sandblocks/) contains local-only client and managed-environment templates for preview and production deployments. Copy these into the ignored `.sandblocks/` directory; never edit the examples with real credentials.
