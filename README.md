Kinderbücher
============

# Using a development version of Mirador from GitHub

See [https://womanonrails.com/adding-yarn-package-from-github](https://womanonrails.com/adding-yarn-package-from-github) on how to add a specific revision.

## Provided patches

Mirador 3 is not really feature complete, even though it's tagged as a Release Candidate. The following changes need to be applied to make Mirador usable.

* Thumbnails won't be displayed if they're static [#3330](https://github.com/ProjectMirador/mirador/issues/3330)
* Mirador fails to load Minifests if bundled [#3311](https://github.com/ProjectMirador/mirador/issues/3311)
* Mirador can't display non-paged viewing hints [3029](https://github.com/ProjectMirador/mirador/pull/3029)

These patches are combined in one file in `patches`.

Currently yarn will will pull Mirador directly from GitHub, not NPM. It applies the patches and rebuilds the viewer with these patches applied.

# Building the `deployer` Docker image

```
DOCKER_BUILDKIT=1 docker build -f scripts/docker/uploader/Dockerfile .
```

# Image handling

## Batch conversion

```
find . -name '*.tif' -depth 1 -print -exec tiff2rgba {} {}-uc.tif \;
find . -name '*-uc.tif' -depth 1 -print -exec convert {} -quality 95 {}.jpg \;
find . -name '*-uc.tif' -print -exec rm "{}" \;
find . -name '*.tif.jpg' -print -exec bash -c 'mv "{}"  $(dirname "{}")/$(basename -s .tif-uc.tif.jpg "{}").jpg' \;
```

## Master image compression

```
find . -path '*/orig/*.tif' -print -exec convert "{}" -define webp:lossless=true "{}.webp" \;
```

# IIIF images

## Generating tiles for IIIF Presentation API locally

```
URL_PREFIX=http://localhost:1313/ ./scripts/iiif.sh
```

## Remove generated IIIF directories

```
find content/post/ -name info.json -exec dirname {} \; | xargs rm -r
```

# Running hugo

## Without watching

This might be needed if there are to many sub directories (with IIIF structures) generated, since watching might not work in this setup.
This stopped to work reliably between Hugo 0.79.0 and 0.81.0

```
hugo serve -F --debug --disableFastRender  --disableLiveReload --watch=false --renderToDisk
```

# Using Docker

```
docker run --name hugo -v `pwd`/docs:/usr/share/nginx/html -p 1313:80 nginx
```

# TODO

* Add index to
  * Tante Anstand
* Upload Images
  * Quenottes et Menottes
* Complete scan
  * Naturgeschichte der Vögel
