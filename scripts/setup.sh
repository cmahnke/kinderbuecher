#!/bin/sh

set -e

echo "Pass a single argument 'local' to set up IIIF URLs to http://localhost:1313/"

if [ "$1" == "local" ] ; then
  export URL_PREFIX=http://localhost:1313
  unset SKIP_IIIF
fi

echo "Set SKIP_IIIF to something to disable generation of IIIF derivates"

if [ -z "$SKIP_IIIF" ] ; then
    ./scripts/iiif.sh
fi

if [ -z "$SKIP_PDF" ] ; then
    python themes/projektemacher-base/scripts/pdf.py
fi

# Background
convert "Source Files/Background/Background-WSXGA.psd[1]" -quality 20 static/images/background.jpg

# Generate Previews
./themes/projektemacher-base/scripts/preview.sh

#NPM dependencies
echo "Calling theme scripts"
for SCRIPT in $PWD/themes/projektemacher-base/scripts/init/*.sh ; do
    echo "Running $SCRIPT"
    bash "$SCRIPT"
    ERR=$?
    if [ $ERR -ne 0 ] ; then
        echo "Execution of '$SCRIPT' failed!"
        exit $ERR
    fi
done

# Favicons
SOURCE="Source Files/Favicon/Favicon.psd[1]" OPTIONS="-background 'rgba(255, 255, 255, .0)' -resize 300x300 -gravity center -extent 300x300" ./themes/projektemacher-base/scripts/favicon.sh
