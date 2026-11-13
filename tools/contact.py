# Builds a contact sheet from guest screenshots: one crop around the pointer per shot.
# usage: python3 tools/contact.py OUT.png "label|shot.png|x|y" ...   (x, y in screen points)
import sys
from PIL import Image, ImageDraw, ImageFont

out, items = sys.argv[1], sys.argv[2:]
S = 2  # screenshot pixels per point
W, H = 420, 420  # crop size in pixels
cells = []
for item in items:
    label, path, x, y = item.split('|')
    img = Image.open(path).convert('RGB')
    cx, cy = int(float(x) * S), int(float(y) * S)
    left = max(0, min(img.width - W, cx - 110))
    top = max(0, min(img.height - H, cy - 110))
    crop = img.crop((left, top, left + W, top + H))
    d = ImageDraw.Draw(crop)
    hx, hy = cx - left, cy - top
    d.line((hx - 14, hy, hx - 5, hy), fill=(255, 0, 170), width=2)
    d.line((hx, hy - 14, hx, hy - 5), fill=(255, 0, 170), width=2)
    cells.append((label, crop))
cols = 4
rows = (len(cells) + cols - 1) // cols
pad, lab = 12, 44
sheet = Image.new('RGB', (cols * (W + pad) + pad, rows * (H + lab + pad) + pad), 'white')
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 17)
except Exception:
    font = ImageFont.load_default()
for i, (label, crop) in enumerate(cells):
    c, r = i % cols, i // cols
    x, y = pad + c * (W + pad), pad + r * (H + lab + pad)
    sheet.paste(crop, (x, y + lab))
    d.rectangle((x, y + lab, x + W - 1, y + lab + H - 1), outline=(200, 200, 205))
    for j, line in enumerate(label.split('\\n')):
        d.text((x, y + 2 + j * 20), line, fill=(30, 30, 30), font=font)
sheet.save(out)
print(out, sheet.size)
