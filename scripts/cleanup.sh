#!/bin/sh

./themes/projektemacher-base/scripts/cleanup.sh
rm -rf static/images/background.jpg
find content/post/ -name '*.pdf' -exec rm -r {} \;
