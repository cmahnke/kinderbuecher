#!/bin/sh

find content/post/ -name info.json -exec dirname {} \; | xargs rm -r
rm -rf docs/*
rm -rf resources/_gen
