"""Tile dev screenshots into one sheet: python tools/tile.py OUT IN1 IN2 ... [--cols N]"""
import sys
from PIL import Image

args = sys.argv[1:]
cols = 2
if '--cols' in args:
    i = args.index('--cols')
    cols = int(args[i + 1])
    del args[i:i + 2]
out, files = args[0], args[1:]
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
tw, th = w // cols, h // cols
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (tw * cols, th * rows), 'white')
for i, im in enumerate(ims):
    sheet.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
