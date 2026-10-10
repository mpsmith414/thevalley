"""Make a looping GIF from dev screenshots: python tools/gif.py OUT.gif IN1 IN2 ... [--fps 15] [--width 640]"""
import sys
from PIL import Image

args = sys.argv[1:]


def take(flag, default):
    if flag in args:
        i = args.index(flag)
        val = type(default)(args[i + 1])
        del args[i:i + 2]
        return val
    return default


fps = take('--fps', 15)
width = take('--width', 640)
out, files = args[0], args[1:]
frames = []
for f in files:
    im = Image.open(f).convert('RGB')
    h = max(1, round(im.height * width / im.width))
    frames.append(im.resize((width, h), Image.LANCZOS))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, optimize=True)
