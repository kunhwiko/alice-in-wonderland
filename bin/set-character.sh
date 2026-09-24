#!/usr/bin/env bash
# Swap the artwork in any picture slot.
#
#   bin/set-character.sh <slot> <file-or-url>
#
# Slots:  front  waiting  busy  rest  stopped  archive  empty
#
#   front     masthead portrait
#   waiting   "Waiting on you" heading
#   busy      "Terribly busy" heading
#   rest      "Resting" heading
#   stopped   "Quite stopped" heading
#   archive   "Down the rabbit-hole" heading
#   empty     the empty state, shown large
#
# Handles png/jpg/webp/gif, converts to PNG and sizes it for the slot.
# Keeps a .bak of whatever was there, so `--restore` can put it back.
#
# The four heading/portrait slots render as circles, so a square source
# works best — crop first if your image is portrait or landscape:
#   sips -c 380 380 --cropOffset <y> <x> pic.png
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$HERE/public/characters"

# Print the header comment block, stopping at the first line of code — so this
# stays correct when the header above is edited.
usage() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
  exit 1
}

case "${1:-}" in
  ""|-h|--help) usage ;;
esac

ROLE="$1"
case "$ROLE" in
  front|waiting|busy|rest|stopped|archive) TARGET="$DIR/$ROLE.png"; SIZE=160 ;;
  empty)                   TARGET="$DIR/empty.png"; SIZE=660 ;;
  *) echo "Unknown slot: $ROLE" >&2; usage ;;
esac

# --restore puts the previous image back
if [ "${2:-}" = "--restore" ]; then
  [ -f "$TARGET.bak" ] || { echo "No backup for $ROLE." >&2; exit 1; }
  mv "$TARGET.bak" "$TARGET"
  echo "Restored $ROLE."
  exit 0
fi

SRC="${2:-}"
[ -n "$SRC" ] || usage

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
IN="$TMP/in"

if [[ "$SRC" =~ ^https?:// ]]; then
  echo "Fetching $SRC"
  curl -fsSL -A "Wonderland-local/1.0" -o "$IN" "$SRC"
else
  # tolerate a path pasted with surrounding quotes or a leading ~
  SRC="${SRC%\"}"; SRC="${SRC#\"}"; SRC="${SRC/#\~/$HOME}"
  [ -f "$SRC" ] || { echo "No such file: $SRC" >&2; exit 1; }
  cp "$SRC" "$IN"
fi

MIME="$(file -b --mime-type "$IN")"
case "$MIME" in
  image/*) ;;
  *) echo "That isn't an image (got $MIME). If the URL needed a login, save the file and pass its path instead." >&2; exit 1 ;;
esac

sips -s format png "$IN" --out "$TMP/out.png" >/dev/null
sips -Z "$SIZE" "$TMP/out.png" >/dev/null

[ -f "$TARGET" ] && cp "$TARGET" "$TARGET.bak"
mv "$TMP/out.png" "$TARGET"

DIMS="$(sips -g pixelWidth -g pixelHeight "$TARGET" | tail -2 | tr -d ' \n' | sed 's/pixelWidth:/ /;s/pixelHeight:/x/')"
echo "Set $ROLE ->$(basename "$TARGET")  $DIMS  $(du -h "$TARGET" | cut -f1)"
echo "Hard-reload the page to see it. Undo with: bin/set-character.sh $ROLE --restore"
