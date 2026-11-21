#!/bin/sh
# Makes lineart_woodcut_photo.jpg: the woodcut as if photographed on paper, with a paper
# tint, uneven light, slight blur, sensor noise and JPEG compression. Needs ImageMagick.
# The noise is seeded, so the same ImageMagick version writes the same file.
set -e
cd "$(dirname "$0")/.."
magick images/lineart_woodcut.png -colorspace sRGB -type TrueColorAlpha -background '#efe6d2' -alpha remove -alpha off \
  \( -size 800x800 radial-gradient:'#ffffff'-'#b9b2a4' -resize '%[fx:u.w]x%[fx:u.h]!' \) \
  -gravity center -compose multiply -composite \
  -blur 0x0.8 -seed 7 -attenuate 0.25 +noise Gaussian \
  -strip -quality 80 images/lineart_woodcut_photo.jpg
