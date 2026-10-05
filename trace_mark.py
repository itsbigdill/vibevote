#!/usr/bin/env python3
"""Trace the VibeVote "V with a check" mark from its transparent PNG into clean SVG and PNG icons.

The mark is two straight-edged polygons: the V and the check cut out of it. The script decodes the
PNG (pure Python, no imaging libraries), finds the V's corners and the check's corners from the
pixels and writes web/mark.svg; make_icons.py then draws the favicon and app icons from it.
Usage: python3 trace_mark.py path/to/logo.png
"""
import struct
import sys
import zlib
from collections import deque
from pathlib import Path

import make_icons

WEB = Path(__file__).resolve().parent / "web"


def read_png(path):
    data = Path(path).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, head = 8, b"", None
    while pos < len(data):
        size, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + size]
        pos += size + 12
        if kind == b"IHDR":
            head = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    w, h, depth, color, _, _, interlace = head
    assert depth == 8 and interlace == 0 and color in (2, 6), f"unsupported PNG (depth {depth}, colour {color})"
    bpp = 4 if color == 6 else 3
    raw, stride = zlib.decompress(idat), w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += stride + 1
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x - bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b, c = prev[x], (prev[x - bpp] if x >= bpp else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, bpp, rows


def main(src):
    w, h, bpp, rows = read_png(src)
    ink = bytearray(w * h)  # 1 where the mark is
    corners_clear = True
    for y, line in enumerate(rows):
        for x in range(w):
            o = x * bpp
            alpha = line[o + 3] if bpp == 4 else 255
            if alpha > 127 and line[o] + line[o + 1] + line[o + 2] < 384:
                ink[y * w + x] = 1
    if bpp == 4:
        corners_clear = all(rows[y][x * 4 + 3] < 20 for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)))

    # outside = background reachable from the border; the check is the enclosed background
    outside = bytearray(w * h)
    q = deque(i for i in list(range(w)) + list(range(w * (h - 1), w * h)) + list(range(0, w * h, w)) + list(range(w - 1, w * h, w)) if not ink[i])
    for i in q:
        outside[i] = 1
    while q:
        i = q.popleft()
        y, x = divmod(i, w)
        for j in ((i - 1) if x else -1, (i + 1) if x < w - 1 else -1, i - w, i + w):
            if 0 <= j < w * h and not ink[j] and not outside[j]:
                outside[j] = 1
                q.append(j)
    hole = [(i % w, i // w) for i in range(w * h) if not ink[i] and not outside[i]]
    assert len(hole) > 1000, "no check cut-out found"

    ys = [y for y in range(h) if any(ink[y * w:(y + 1) * w])]
    top, bottom = ys[0] + 2, ys[-1] - 2

    def runs(y):
        out, x = [], 0
        line = ink[y * w:(y + 1) * w]
        while x < w:
            if line[x]:
                s = x
                while x < w and line[x]:
                    x += 1
                out.append((s, x - 1))
            x += 1
        return out

    t = runs(top)
    assert len(t) == 2, f"expected two arms at the top, found {len(t)}"
    (l0, l1), (r0, r1) = t
    b = runs(bottom)
    b0, b1 = b[0][0], b[-1][1]
    # the notch: go down between the arms while the gap is still open background
    def outer_gap(y):
        rr = runs(y)
        for k in range(len(rr) - 1):
            a, c = rr[k][1], rr[k + 1][0]
            if all(outside[y * w + x] for x in range(a + 1, c)):
                return a, c
        return None

    y = top
    while y < h and outer_gap(y):
        y += 1
    notch_y = y
    a, c = outer_gap(notch_y - 1)
    notch_x = (a + c) / 2

    # the check: its tip is the topmost hole pixel, its point the lowest, its left end the leftmost
    tip = min(hole, key=lambda p: (p[1], -p[0]))
    point = max(hole, key=lambda p: (p[1], p[0]))
    left_x = min(x for x, _ in hole)
    flat_y = min(y for x, y in hole if x <= left_x + 3)
    is_hole = bytearray(w * h)
    for x, y in hole:
        is_hole[y * w + x] = 1
    # the short arm's flat top ends where the first hole run on that row ends
    flat_start = min(x for x, y in hole if y == flat_y)
    flat_end = flat_start
    while flat_end + 1 < w and is_hole[flat_y * w + flat_end + 1]:
        flat_end += 1
    upper = {}
    for x, y in hole:
        if flat_end < x < tip[0] and (x not in upper or y < upper[x]):
            upper[x] = y
    elbow_x = max(upper, key=lambda x: upper[x])
    elbow = (elbow_x, upper[elbow_x])

    v = [(l0, top), (l1, top), (notch_x, notch_y), (r0, top), (r1, top), (b1, bottom), (b0, bottom)]
    check = [(left_x, flat_y), (flat_end, flat_y), elbow, tip, point]
    minx, miny = l0, top
    maxx, maxy = r1, bottom
    def path(pts):
        return "M" + " L".join(f"{x - minx:.0f} {y - miny:.0f}" for x, y in pts) + "Z"
    d = path(v) + " " + path(check)
    vw, vh = maxx - minx, maxy - miny
    (WEB / "mark.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}"><path fill="#0f0f13" fill-rule="evenodd" d="{d}"/></svg>\n')
    make_icons.main()

    print(f"image {w}x{h}, transparent corners: {corners_clear}")
    print("V:", [(round(x), y) for x, y in v])
    print("check:", check)
    print(f"mark.svg {vw}x{vh}, {(WEB / 'mark.svg').stat().st_size} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
