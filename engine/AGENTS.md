# Engine — Mo.Blend Python / bpy

In-process logic inside headless Blender (4.2 LTS+). PRD 1 (compute) + PRD 2 (platform).

## Runtime

Production code runs only inside Blender's bundled Python:

```
blender --background --factory-startup --python engine/bootstrap.py -- ...
```

Host Python may import for static analysis only—not for bpy execution.

## Broker threading (critical)

- Network handlers enqueue work to `queue.Queue`.
- `bpy.app.timers` consumer executes all bpy on the main thread.
- Bounded queue; 429 on flood; stale frame drop for scrubbing.

## Package layout

```
engine/
├── bootstrap.py       # Entry: --serve, --load, --set, --save
├── moblend/           # load_template, set_parameter, save_project, manifest, nodes
└── tests/             # m1_roundtrip, m2_broker_client, m2_viewport_tester.html
```

## Verification

After engine changes, run `/engine-verify` or the commands in [engine/README.md](README.md).

## Persistence (M3a)

- **`broker.db`** — broker-owned index: `export_jobs`, `catalog_cache` stub. Package: `engine/moblend/store.py`.
- **`suite_logs.db`** — shared append-only logs via `engine/moblend/log.py` (`component=broker`). WAL + short transactions.
- Never store manifest JSON, bpy session state, or frames in SQLite. See [M3a spec](../specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md).

## Security

Force `use_scripts_auto_execute = False` early. Validate manifest types before queueing. Bind broker to `127.0.0.1` by default.