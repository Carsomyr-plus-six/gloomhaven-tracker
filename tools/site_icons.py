"""Draws the site's PNG icons: the brass hexagon from the top bar with "CL"
(Craig's List) in dark ink, the same drawing as favicon.svg.

- icon-192.png: on a transparent background, as favicon.svg is.
- apple-touch-icon.png: on the page's dark background, smaller, with room
  for the corner rounding home screens add; iOS would fill a transparent
  background with black anyway.

    py tools/site_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG = (13, 18, 17, 255)        # theme-color, #0d1211
BRASS = (226, 176, 74, 255)   # --brass, #e2b04a
INK = (26, 20, 8, 255)        # --brass-ink, #1a1408

# favicon.svg's drawing, on its 32-unit square.
HEX = [(16, 1), (29, 8.5), (29, 23.5), (16, 31), (3, 23.5), (3, 8.5)]
STROKE = 3
C_CENTRE, C_RADIUS = (11.5, 16), 4.6   # the C: an arc open to the right
L_PATH = [(18.5, 11.4), (18.5, 20.6), (24.5, 20.6)]


def icon(size, path, background=None, scale=1.0):
    s = 8  # draw large, then shrink, for smooth edges
    big = size * s
    img = Image.new("RGBA", (big, big), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    unit = big / 32 * scale
    offset = big * (1 - scale) / 2
    at = lambda x, y: (offset + x * unit, offset + y * unit)
    draw.polygon([at(x, y) for x, y in HEX], fill=BRASS)
    width = round(STROKE * unit)
    cx, cy = at(*C_CENTRE)
    r = C_RADIUS * unit
    # The arc's stroke is centred on the radius, as in the SVG.
    draw.arc([cx - r - width / 2, cy - r - width / 2, cx + r + width / 2, cy + r + width / 2],
             start=50, end=310, fill=INK, width=width)
    draw.line([at(*p) for p in L_PATH], fill=INK, width=width, joint="curve")
    # Square the L's corner and ends, as the SVG's miter join and butt caps do.
    (x0, y0), (x1, y1), (x2, y2) = [at(*p) for p in L_PATH]
    draw.rectangle([x1 - width / 2, y1 - width / 2, x1 + width / 2, y1 + width / 2], fill=INK)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


if __name__ == "__main__":
    icon(180, ROOT / "apple-touch-icon.png", background=BG, scale=0.62)
    icon(192, ROOT / "icon-192.png")
    print("Drew apple-touch-icon.png and icon-192.png")
