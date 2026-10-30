#!/usr/bin/env bash
# Operator-reviewed static-only release. Never run by the application.
set -euo pipefail
SHA=${1:?Usage: update-preview.sh FULL_FRONTEND_SHA}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]
BASE=/srv/timemap-preview
SOURCE="/opt/timemap-preview-sources/$SHA"
RELEASE="$BASE/releases/$SHA"
# Refuse unexpected directory layout; retain every old release.
test -L "$BASE/current"
PREVIOUS=$(readlink -f "$BASE/current")
[[ "$PREVIOUS" == "$BASE/releases/"* ]]
test -d "$PREVIOUS"
test ! -e "$SOURCE" && test ! -L "$SOURCE"
test ! -e "$RELEASE" && test ! -L "$RELEASE"
install -d -m 0755 /opt/timemap-preview-sources "$BASE/releases"
git clone --no-checkout --single-branch --branch feature/v1.2 https://github.com/Rycho813/Time_map.git "$SOURCE"
git -C "$SOURCE" checkout --detach "$SHA"
# Check source before copying, inventory outside served release.
python3 "$SOURCE/deploy/check-static.py" --expected-commit "$SHA" > "$SOURCE.inventory.json"
install -d -m 0755 "$RELEASE"
for file in index.html styles.css manifest.webmanifest sw.js; do install -m 0644 "$SOURCE/$file" "$RELEASE/$file"; done
cp -R "$SOURCE/assets" "$SOURCE/js" "$RELEASE/"
find "$RELEASE" -type d -exec chmod 0755 {} +
find "$RELEASE" -type f -exec chmod 0644 {} +
python3 - "$SOURCE.inventory.json" "$RELEASE" <<'PY'
import hashlib,json,pathlib,sys
inventory=json.load(open(sys.argv[1]))
root=pathlib.Path(sys.argv[2])
for name,digest in inventory['static_files'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, name
PY
# Private release metadata never enters the web root.
printf '%s\n' "$PREVIOUS" > "$SOURCE.previous"
TEMP="$BASE/.current-$SHA-$$"
trap 'rm -f "$TEMP"' EXIT
ln -s "$RELEASE" "$TEMP"
mv -Tf "$TEMP" "$BASE/current"
printf 'FRONTEND_COMMIT=%s\nPREVIOUS_STATIC_RELEASE=%s\n' "$SHA" "$PREVIOUS"
