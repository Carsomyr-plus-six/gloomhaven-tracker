"""Make the site's icons from the Gloomhaven Creator Pack.

The Creator Pack (Isaac Childres / Cephalofair Games) is shared under
CC BY-NC-SA 4.0: https://boardgamegeek.com/thread/1733586/files-for-creation
Its "Icon Pack" folder holds Illustrator PDFs with one vector icon per page.
This reads the pages listed in ICONS below and writes each as icons/<name>.svg.

What it changes, as the licence asks us to say:
- converts each page from PDF to SVG (paths and flat colours only; the
  pages have no images, gradients or text), with CMYK turned into RGB
- crops the canvas to the artwork and rounds coordinates to one decimal
- recolours black to the site's text colour where RECOLOR says so, so the
  icon shows on the dark background
- in the single-colour icons (MASKS), turns white details into see-through
  cut-outs, so the page can use them as masks
- makes pull by mirroring push (MIRROR): the pack has no pull icon, and the
  game's pull is push with the arrow pointing back

The output is CC BY-NC-SA 4.0 like the source; see icons/README.md.

Needs pypdf (py -m pip install pypdf). Run from the repository root with the
pack's zip file or the folder it unzips to:
    py tools/creator_pack_icons.py "path/to/Creator Pack V2.zip"
"""

import io
import re
import sys
import zipfile
from pathlib import Path

import pypdf

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"

# name: (PDF in the pack's Icon Pack folder, page number)
ICONS = {
    # Elements
    "air": ("Element Icons.pdf", 1),
    "ice": ("Element Icons.pdf", 2),
    "fire": ("Element Icons.pdf", 3),
    "earth": ("Element Icons.pdf", 4),
    "light": ("Element Icons.pdf", 5),
    "dark": ("Element Icons.pdf", 6),
    # Conditions and effects
    "bless": ("Status Effect Icons.pdf", 1),
    "curse": ("Status Effect Icons.pdf", 2),
    "disarm": ("Status Effect Icons.pdf", 3),
    "immobilize": ("Status Effect Icons.pdf", 4),
    "wound": ("Status Effect Icons.pdf", 5),
    "muddle": ("Status Effect Icons.pdf", 6),
    "stun": ("Status Effect Icons.pdf", 7),
    "poison": ("Status Effect Icons.pdf", 8),
    "invisible": ("Status Effect Icons.pdf", 9),
    "strengthen": ("Status Effect Icons.pdf", 10),
    "push": ("Status Effect Icons.pdf", 11),
    "pierce": ("Status Effect Icons.pdf", 12),
    "target": ("Status Effect Icons.pdf", 13),
    "pull": ("Status Effect Icons.pdf", 11),       # push, mirrored (MIRROR)
    # The rolling modifier mark: the green diamond with a U-turn arrow
    "rolling": ("Status Effect Icons.pdf", 14),
    "heal": ("General Icons.pdf", 8),
    "shield": ("General Icons.pdf", 10),
    "refresh": ("General Icons.pdf", 22),
    "checkmark": ("General Icons.pdf", 23),
    # What happens to an event card: torn up, or back into the deck
    "event-removed": ("Event Card Icons.pdf", 1),
    "event-returned": ("Event Card Icons.pdf", 3),
    # Item slots
    "slot-body": ("Equip Slots.pdf", 1),
    "slot-head": ("Equip Slots.pdf", 2),
    "slot-legs": ("Equip Slots.pdf", 3),
    "slot-onehand": ("Equip Slots.pdf", 4),
    "slot-twohand": ("Equip Slots.pdf", 5),
    "slot-small": ("Equip Slots.pdf", 6),
    # Classes, named by the ids in data/gloomhaven-events.json (locked
    # classes go by the spoiler-free name of their icon).
    "class-angry-face": ("Class Icons and Augments.pdf", 1),
    "class-lightning": ("Class Icons and Augments.pdf", 2),
    "class-brute": ("Class Icons and Augments.pdf", 3),
    "class-cragheart": ("Class Icons and Augments.pdf", 4),
    "class-triangles": ("Class Icons and Augments.pdf", 5),
    "class-mindthief": ("Class Icons and Augments.pdf", 6),
    "class-eclipse": ("Class Icons and Augments.pdf", 7),
    "class-squidface": ("Class Icons and Augments.pdf", 8),
    "class-spellweaver": ("Class Icons and Augments.pdf", 9),
    "class-circles": ("Class Icons and Augments.pdf", 10),
    "class-sun": ("Class Icons and Augments.pdf", 11),
    "class-tinkerer": ("Class Icons and Augments.pdf", 12),
    "class-music-note": ("Class Icons and Augments.pdf", 13),
    "class-two-mini": ("Class Icons and Augments.pdf", 14),
    "class-saw": ("Class Icons and Augments.pdf", 15),
    "class-three-spears": ("Class Icons and Augments.pdf", 16),
    "class-scoundrel": ("Class Icons and Augments.pdf", 17),
}
# The single-colour icons above (checkmark, event, slots, classes) stay black: the
# page uses them as masks and fills them with the colour around them. Their
# white details become see-through cut-outs so the mask keeps them.
MASKS = {name for name in ICONS if name == "checkmark" or name.startswith(("event-", "slot-", "class-"))}

TEXT_COLOR = "#ece6d8"   # --fg in styles.css
RECOLOR = {"heal": {"#000000": TEXT_COLOR}, "shield": {"#000000": TEXT_COLOR},
           "refresh": {"#ffffff": TEXT_COLOR}}
MIRROR = {"pull"}

NUMBER = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)")
TOKEN = re.compile(rb"\[|\]|/[^\s/\[\]()<>]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z\*'\"]+")
# Operators that only set state the icons don't use.
IGNORED = {"J", "j", "M", "d", "ri", "i", "BDC", "BMC", "EMC", "MP", "DP", "W", "W*"}


def hex_color(r, g, b):
    return "#" + "".join(f"{max(0, min(255, round(255 * v))):02x}" for v in (r, g, b))


def multiply(a, b):
    a0, a1, a2, a3, a4, a5 = a
    b0, b1, b2, b3, b4, b5 = b
    return (a0 * b0 + a1 * b2, a0 * b1 + a1 * b3, a2 * b0 + a3 * b2, a2 * b1 + a3 * b3,
            a4 * b0 + a5 * b2 + b4, a4 * b1 + a5 * b3 + b5)


def page_paths(page):
    """Yield (segments, fill, stroke, stroke_width, evenodd, opacity) for each painted path.
    Segments are (command, [x, y, ...]) in page space with y pointing down."""
    height = float(page.mediabox[3])
    states = (page.get("/Resources") or {}).get("/ExtGState") or {}
    st = {"ctm": (1, 0, 0, 1, 0, 0), "fill": "#000000", "stroke": "#000000", "lw": 1.0, "alpha": 1.0}
    stack, path, args, current = [], [], [], (0, 0)

    def point(x, y):
        a, b, c, d, e, f = st["ctm"]
        return [a * x + c * y + e, height - (b * x + d * y + f)]

    def paint(fill, stroke, evenodd=False):
        nonlocal path
        if path:
            a, b, c, d = st["ctm"][:4]
            width = st["lw"] * (abs(a * d - b * c) ** 0.5)
            yield (path, st["fill"] if fill else None, st["stroke"] if stroke else None, width, evenodd, st["alpha"])
        path = []

    for raw in TOKEN.findall(page.get_contents().get_data()):
        tok = raw.decode("latin-1")
        if NUMBER.fullmatch(tok):
            args.append(float(tok))
            continue
        if tok.startswith("/"):
            args.append(tok)
            continue
        if tok in ("[", "]"):
            continue
        a = args
        if tok == "q":
            stack.append(dict(st))
        elif tok == "Q":
            st = stack.pop()
        elif tok == "cm":
            st["ctm"] = multiply(tuple(a[-6:]), st["ctm"])
        elif tok == "m":
            path.append(("M", point(*a[-2:]))); current = a[-2:]
        elif tok == "l":
            path.append(("L", point(*a[-2:]))); current = a[-2:]
        elif tok == "c":
            path.append(("C", point(*a[-6:-4]) + point(*a[-4:-2]) + point(*a[-2:]))); current = a[-2:]
        elif tok == "v":
            path.append(("C", point(*current) + point(*a[-4:-2]) + point(*a[-2:]))); current = a[-2:]
        elif tok == "y":
            path.append(("C", point(*a[-4:-2]) + point(*a[-2:]) + point(*a[-2:]))); current = a[-2:]
        elif tok == "h":
            path.append(("Z", []))
        elif tok == "re":
            x, y, w, h = a[-4:]
            path += [("M", point(x, y)), ("L", point(x + w, y)), ("L", point(x + w, y + h)),
                     ("L", point(x, y + h)), ("Z", [])]
        elif tok in ("f", "F"):
            yield from paint(True, False)
        elif tok == "f*":
            yield from paint(True, False, True)
        elif tok == "S":
            yield from paint(False, True)
        elif tok == "s":
            path.append(("Z", [])); yield from paint(False, True)
        elif tok in ("B", "b", "B*", "b*"):
            if tok.startswith("b"):
                path.append(("Z", []))
            yield from paint(True, True, tok.endswith("*"))
        elif tok == "n":
            path = []
        elif tok in ("k", "K"):
            c, m, y, k = a[-4:]
            st["fill" if tok == "k" else "stroke"] = hex_color(*((1 - v) * (1 - k) for v in (c, m, y)))
        elif tok in ("g", "G"):
            st["fill" if tok == "g" else "stroke"] = hex_color(a[-1], a[-1], a[-1])
        elif tok in ("rg", "RG"):
            st["fill" if tok == "rg" else "stroke"] = hex_color(*a[-3:])
        elif tok == "w":
            st["lw"] = a[-1]
        elif tok == "gs":
            gs = states.get(a[-1])
            st["alpha"] = float((gs.get_object() if gs is not None else {}).get("/ca", 1))
        elif tok not in IGNORED:
            raise ValueError(f"unsupported PDF operator {tok!r}")
        args = []


def number(n):
    text = f"{n:.1f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def to_svg(page, recolor, holes=False, mirror=False):
    """With holes, white shapes become see-through cut-outs in what was drawn
    before them, so the icon works as a mask: each run of white shapes masks
    everything painted so far."""
    painted = list(page_paths(page))
    xs = [v for p in painted for _, pts in p[0] for v in pts[0::2]]
    ys = [v for p in painted for _, pts in p[0] for v in pts[1::2]]
    pad = max(p[3] for p in painted if p[2]) / 2 if any(p[2] for p in painted) else 0
    left, top = min(xs) - pad, min(ys) - pad
    width, height = max(xs) + pad - left, max(ys) + pad - top
    side = max(width, height)
    left -= (side - width) / 2
    top -= (side - height) / 2

    out, defs, cuts = [], [], []

    def cut():
        if cuts:
            mask_id = f"cut{len(defs) + 1}"
            defs.append(f'<mask id="{mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="{number(side)}" '
                        f'height="{number(side)}"><rect width="{number(side)}" height="{number(side)}" fill="#fff"/>'
                        + "".join(f'<path d="{d}" fill="#000"/>' for d in cuts) + "</mask>")
            out[:] = [f'<g mask="url(#{mask_id})">' + "".join(out) + "</g>"]
            cuts.clear()

    for segments, fill, stroke, stroke_width, evenodd, opacity in painted:
        d = "".join(cmd + " ".join(number(v - (left if i % 2 == 0 else top)) for i, v in enumerate(pts))
                    for cmd, pts in segments)
        if holes and fill == "#ffffff" and not stroke:
            cuts.append(d)
            continue
        cut()
        attrs = [f'd="{d}"', f'fill="{recolor.get(fill, fill)}"' if fill else 'fill="none"']
        if fill and evenodd:
            attrs.append('fill-rule="evenodd"')
        if stroke:
            attrs.append(f'stroke="{recolor.get(stroke, stroke)}" stroke-width="{number(stroke_width)}"')
        if opacity < 1:
            attrs.append(f'opacity="{number(opacity)}"')
        out.append(f"<path {' '.join(attrs)}/>")
    cut()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {number(side)} {number(side)}">'
            + (f"<defs>{''.join(defs)}</defs>" if defs else "")
            + (f'<g transform="matrix(-1 0 0 1 {number(side)} 0)">' if mirror else "")
            + "".join(out) + ("</g>" if mirror else "") + "</svg>\n")


def open_pdf(source, name):
    if source.is_dir():
        matches = list(source.rglob(name))
        if not matches:
            sys.exit(f"{name} not found under {source}")
        return pypdf.PdfReader(matches[0])
    with zipfile.ZipFile(source) as z:
        entry = next((n for n in z.namelist() if n.endswith("/" + name) or n == name), None)
        if not entry:
            sys.exit(f"{name} not found in {source}")
        return pypdf.PdfReader(io.BytesIO(z.read(entry)))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    OUT_DIR.mkdir(exist_ok=True)
    readers = {}
    for name, (pdf, page) in ICONS.items():
        reader = readers.get(pdf) or readers.setdefault(pdf, open_pdf(source, pdf))
        svg = to_svg(reader.pages[page - 1], RECOLOR.get(name, {}), holes=name in MASKS, mirror=name in MIRROR)
        (OUT_DIR / f"{name}.svg").write_text(svg, encoding="utf-8", newline="\n")
        print(f"icons/{name}.svg  {len(svg.encode()):>6} bytes  ({pdf}, page {page})")


if __name__ == "__main__":
    main()
