#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/deploy/game-data"
ARCHIVE="$PROJECT_ROOT/downloads/quake106.zip"
PAK_HASH=35a9c55e5e5a284a159ad2a62e0e8def23d829561fe2f54eb402dbc0a9a946af
mkdir -p "$DATA_DIR" "$PROJECT_ROOT/downloads"
if [[ -f "$DATA_DIR/pak0.pak" ]] && [[ "$(sha256sum "$DATA_DIR/pak0.pak" | cut -d' ' -f1)" != "$PAK_HASH" ]]; then
    echo 'Existing game data is not the verified shareware PAK; leaving it untouched.' >&2
    exit 1
fi
if [[ ! -f "$ARCHIVE" ]]; then
    curl --fail --location https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake/quake106.zip -o "$ARCHIVE"
fi
echo "8cee4d03ee092909fdb6a4f84f0c1357  $ARCHIVE" | md5sum --check
echo "ec6c9d34b1ae0252ac0066045b6611a7919c2a0d78a3a66d9387a8f597553239  $ARCHIVE" | sha256sum --check
TEMPORARY="$(mktemp -d "$PROJECT_ROOT/downloads/shareware.XXXXXX")"
trap 'if [[ "$TEMPORARY" == "$PROJECT_ROOT/downloads/"* ]]; then rm -rf -- "$TEMPORARY"; fi' EXIT
unzip -q "$ARCHIVE" -d "$TEMPORARY/installer"
mkdir "$TEMPORARY/extracted"
(cd "$TEMPORARY/extracted" && lha x "$TEMPORARY/installer/resource.1")
echo "$PAK_HASH  $TEMPORARY/extracted/id1/pak0.pak" | sha256sum --check
cp "$TEMPORARY/extracted/id1/pak0.pak" "$DATA_DIR/pak0.pak"
cp "$ARCHIVE" "$DATA_DIR/quake106.zip"
cp "$TEMPORARY/extracted/slicnse.txt" "$DATA_DIR/SLICNSE.TXT"
echo 'Verified original shareware game data prepared in deploy/game-data.'
