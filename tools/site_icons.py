"""Draws the site's PNG icons: the brass hexagon from the top bar on the page's
dark background, for phone home screens. favicon.svg is the same hexagon,
written by hand.

    py tools/site_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG = (13, 18, 17)        # theme-color, #0d1211
BRASS = (226, 176, 74)   # --brass, #e2b04a


def icon(size, path):
    s = 8  # draw large, then shrink, for smooth edges
    big = size * s
    img = Image.new("RGB", (big, big), BG)
    # A pointy-topped regular hexagon, 60% of the icon high: room for the
    # corner rounding home screens add.
    r = big * 0.30
    c = big / 2
    points = [(c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))) for a in range(-90, 270, 60)]
    ImageDraw.Draw(img).polygon(points, fill=BRASS)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


if __name__ == "__main__":
    icon(180, ROOT / "apple-touch-icon.png")
    icon(192, ROOT / "icon-192.png")
    print("Drew apple-touch-icon.png and icon-192.png")
