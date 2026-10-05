#!/usr/bin/env python3
"""Draw the VibeVote app icon: the white "V with a check" on the wine-to-royal gradient.

Reads the mark's polygons from web/mark.svg (made by trace_mark.py) and writes web/favicon.svg,
favicon-32.png and favicon-192.png with rounded corners, and apple-touch-icon.png full-bleed
(iOS rounds it itself). Pure Python rasteriser: scanline coverage with 4 sub-rows at 1024 px,
then sips scales down.
"""
import re
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"
SIZE = 1024
STOPS = ((0.0, (0x8F, 0x24, 0x38)), (0.5, (0x5C, 0x2A, 0x6E)), (1.0, (0x24, 0x40, 0x9C)))
MARK_WIDTH = 0.66  # share of the tile; bigger reads better at 16 px
DROP = 0.02        # optical centring: a V carries its weight at the top
RADIUS = 0.225     # corner radius as a share of the tile
SUB = 4


def read_mark():
    svg = (WEB / "mark.svg").read_text()
    d = re.search(r' d="([^"]+)"', svg).group(1)
    _, _, w, h = (float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split())
    polys = []
    for part in re.findall(r"M[^Z]+Z", d):
        nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", part)]
        polys.append(list(zip(nums[::2], nums[1::2])))
    return d, w, h, polys


def placement(w, h):
    k = SIZE * MARK_WIDTH / w
    return k, (SIZE - w * k) / 2, (SIZE - h * k) / 2 + SIZE * DROP


def add_span(row, a, b, weight):
    n = len(row)
    a, b = max(0.0, min(n, a)), max(0.0, min(n, b))
    if b <= a:
        return
    ia, ib = int(a), int(b)
    if ia == ib:
        row[ia] += (b - a) * weight
        return
    row[ia] += (ia + 1 - a) * weight
    for x in range(ia + 1, min(ib, n)):
        row[x] += weight
    if ib < n:
        row[ib] += (b - ib) * weight


def mark_coverage(polys, k, tx, ty):
    edges = []
    for p in polys:
        pts = [(tx + x * k, ty + y * k) for x, y in p]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            if y0 != y1:
                edges.append((x0, y0, x1, y1))
    rows = []
    for y in range(SIZE):
        row = [0.0] * SIZE
        for s in range(SUB):
            sy = y + (s + 0.5) / SUB
            xs = sorted(x0 + (sy - y0) * (x1 - x0) / (y1 - y0)
                        for x0, y0, x1, y1 in edges if min(y0, y1) <= sy < max(y0, y1))
            for a, b in zip(xs[::2], xs[1::2]):  # even-odd: the check is a hole in the V
                add_span(row, a, b, 1 / SUB)
        rows.append(row)
    return rows


def tile_coverage():
    r = SIZE * RADIUS
    rows = []
    for y in range(SIZE):
        row = [0.0] * SIZE
        for s in range(SUB):
            sy = y + (s + 0.5) / SUB
            dy = max(r - sy, sy - (SIZE - r), 0.0)
            inset = r - (r * r - dy * dy) ** 0.5 if dy else 0.0
            add_span(row, inset, SIZE - inset, 1 / SUB)
        rows.append(row)
    return rows


def gradient(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(a + (b - a) * f for a, b in zip(c0, c1))
    return STOPS[-1][1]


def write_png(path, rows, alpha):
    kind, bpp = (6, 4) if alpha else (2, 3)
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, kind, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    d, w, h, polys = read_mark()
    k, tx, ty = placement(w, h)
    mark = mark_coverage(polys, k, tx, ty)
    tile = tile_coverage()
    square, rounded = [], []
    for y in range(SIZE):
        sq, rd = bytearray(SIZE * 3), bytearray(SIZE * 4)
        for x in range(SIZE):
            m = min(1.0, mark[y][x])
            base = gradient((x + y + 1) / (2 * SIZE))
            rgb = [round(c * (1 - m) + 255 * m) for c in base]
            sq[x * 3:x * 3 + 3] = bytes(rgb)
            rd[x * 4:x * 4 + 4] = bytes(rgb + [round(255 * min(1.0, tile[y][x]))])
        square.append(sq)
        rounded.append(rd)

    tmp = Path(tempfile.mkdtemp(prefix="vv-icon-"))
    write_png(tmp / "square.png", square, alpha=False)
    write_png(tmp / "rounded.png", rounded, alpha=True)
    for src, name, size in (("rounded", "favicon-32.png", 32), ("rounded", "favicon-192.png", 192),
                            ("square", "apple-touch-icon.png", 180)):
        subprocess.run(["sips", "-z", str(size), str(size), str(tmp / f"{src}.png"), "--out", str(WEB / name)],
                       check=True, capture_output=True)

    stops = "".join(f'<stop offset="{t:g}" stop-color="#{"".join(f"{c:02X}" for c in rgb)}"/>' for t, rgb in STOPS)
    (WEB / "favicon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'
        f'<rect width="{SIZE}" height="{SIZE}" rx="{SIZE * RADIUS:.0f}" fill="url(#g)"/>'
        f'<path fill="#fff" fill-rule="evenodd" transform="translate({tx:.1f} {ty:.1f}) scale({k:.5f})" d="{d}"/></svg>\n')
    print(f"mark {w:.0f}x{h:.0f} at scale {k:.4f}, offset {tx:.1f},{ty:.1f}; icons in {WEB}")


if __name__ == "__main__":
    main()
