"""Resize and re-encode a texture JPG: python tools/resize.py IN OUT SIZE [--quality Q] [--flatten]

SIZE is the output width and height in pixels (the same size just re-encodes). Grey maps (roughness) are saved as one channel.
--flatten evens out the light and dark blotches larger than about an eighth of the tile (keeping the fine detail), so a
ground texture does not show its repeat from a distance.
"""
import sys
from PIL import Image, ImageChops, ImageFilter

args = sys.argv[1:]
quality = 85
if '--quality' in args:
    i = args.index('--quality')
    quality = int(args[i + 1])
    del args[i:i + 2]
flatten = '--flatten' in args
if flatten:
    args.remove('--flatten')
src, out, size = args[0], args[1], int(args[2])
im = Image.open(src)
if im.mode not in ('L', 'RGB'):
    im = im.convert('RGB')
if im.mode == 'RGB':
    r, g, b = im.split()
    spread = max(ImageChops.difference(r, g).getextrema()[1], ImageChops.difference(g, b).getextrema()[1])
    if spread <= 8:
        im = im.convert('L')  # a grey map stored as RGB (allowing for JPEG noise)
if im.size != (size, size):
    im = im.resize((size, size), Image.LANCZOS)
if flatten:
    # divide by a wide blur (wrapped, so the tile stays seamless) and multiply back by the overall mean
    w = im.width
    tiled = Image.new(im.mode, (w * 3, w * 3))
    for dx in range(3):
        for dy in range(3):
            tiled.paste(im, (dx * w, dy * w))
    blur = tiled.filter(ImageFilter.GaussianBlur(w / 10)).crop((w, w, 2 * w, 2 * w))
    bands, means = im.split(), [sum(i * n for i, n in enumerate(c.histogram())) / (w * w) for c in im.split()]
    flat = []
    for c, bl, m in zip(bands, blur.split(), means):
        cd, bd = c.tobytes(), bl.tobytes()
        flat.append(Image.frombytes('L', c.size, bytes(min(255, round(v * m / max(bv, 1))) for v, bv in zip(cd, bd))))
    im = Image.merge(im.mode, flat) if len(flat) > 1 else flat[0]
im.save(out, 'JPEG', quality=quality, optimize=True, progressive=False)
