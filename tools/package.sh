#!/bin/sh
# Builds the Chrome Web Store upload: dist/tinyhand-<version>.zip, holding only
# what the extension loads. No build step; this just picks the files.
set -eu
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="dist/tinyhand-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -r -X "$out" manifest.json background.js content.js LICENSE PRIVACY.md \
  shared popup options hands sounds icons -x '*.DS_Store'
echo "$out"
unzip -l "$out" | tail -1
