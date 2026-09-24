# Picture slots

Five images, named for the role they play rather than what's in them, so the
artwork can change without the filenames going stale.

| Slot | Where it appears | Shape |
|---|---|---|
| `front.png`   | masthead portrait, beside the title | circle, 52px |
| `archive.png` | *Down the rabbit-hole* heading | circle, 42px |
| `stopped.png` | *Quite stopped* heading | circle, 42px |
| `waiting.png` | *Waiting on you* heading | circle, 42px |
| `busy.png`    | *Terribly busy* heading | circle, 42px |
| `rest.png`    | *Resting* heading | circle, 42px |
| `empty.png`   | the empty state, shown large | framed 4:3 plate |

The circular slots crop from the centre, so **square sources work best**.
Originals live in `../../assets/`, one per slot, plus `alice-main.png` which
is the source of the page background `public/bg-garden.jpg`.

## Swapping artwork

```bash
bin/set-character.sh waiting ~/Desktop/something.png   # local file
bin/set-character.sh empty   https://example.com/x.jpg # or a URL
bin/set-character.sh waiting --restore                 # undo
```

Any image format works; it converts to PNG and sizes it for the slot, keeping a
`.bak` of what it replaced. For a portrait or landscape source headed for a
circular slot, crop to square first:

```bash
sips -c 380 380 --cropOffset <y> <x> pic.png
```

## Provenance

The images currently in these slots are Disney artwork supplied by the repo
owner for personal local use. They are **not** licensed for redistribution —
don't publish this repo or deploy it anywhere public with them in place.

Earlier versions used public-domain John Tenniel engravings (1865–1890) from
Wikimedia Commons; those have been replaced.
