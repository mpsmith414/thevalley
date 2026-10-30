"""Make a looping GIF from dev screenshots: python tools/gif.py OUT.gif IN1 IN2 ... [--fps 15] [--width 640]
Before and after side by side: python tools/gif.py OUT.gif --pair A_PREFIX B_PREFIX (frames A_PREFIX-NN.png and
B_PREFIX-NN.png, matched by NN; each GIF frame is the A frame with the B frame to its right, --width each)."""
import glob
import sys
from PIL import Image

args = sys.argv[1:]


def take(flag, default, n=1):
    if flag in args:
        i = args.index(flag)
        vals = [type(default)(a) for a in args[i + 1:i + 1 + n]] if n > 1 else type(default)(args[i + 1])
        del args[i:i + 1 + n]
        return vals
    return default


def fit(im, width):
    im = im.convert('RGB')
    return im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)


fps = take('--fps', 15)
width = take('--width', 640)
pair = take('--pair', '', 2) if '--pair' in args else None
out, files = args[0], args[1:]
if pair:
    a_prefix, b_prefix = pair
    frames = []
    for a in sorted(glob.glob(glob.escape(a_prefix) + '-[0-9][0-9].png')):
        b = b_prefix + a[len(a_prefix):]
        left, right = fit(Image.open(a), width), fit(Image.open(b), width)
        both = Image.new('RGB', (left.width + right.width, max(left.height, right.height)), 'white')
        both.paste(left, (0, 0))
        both.paste(right, (left.width, 0))
        frames.append(both)
else:
    frames = [fit(Image.open(f), width) for f in files]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, optimize=True)
