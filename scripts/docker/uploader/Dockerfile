# syntax=docker/dockerfile:experimental

FROM docker.pkg.github.com/cmahnke/iiif-action/iiif-action:main

LABEL maintainer="cmahnke@gmail.com"

ENV BUILD_CONTEXT=/mnt/build-context \
    DEPLOY_DEPS="parallel rsync sshpass"

RUN --mount=target=/mnt/build-context \
    apk --update upgrade && \
    apk add --no-cache $DEPLOY_DEPS && \
    cp -r $BUILD_CONTEXT/scripts/iiif-upload.sh /usr/local/bin/ && \
    cd / && rm -rf /var/cache/apk/*
