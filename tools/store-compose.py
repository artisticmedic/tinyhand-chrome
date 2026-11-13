# Scales the raw 2x captures to the store's exact sizes and puts the popup
# onto the robot screenshot. Usage: python3 store-compose.py RAW_DIR OUT_DIR
import sys
from PIL import Image, ImageFilter

raw, out = sys.argv[1], sys.argv[2]

def fit(name, size, dest):
    im = Image.open(f'{raw}/{name}.png').convert('RGB')
    im.resize(size, Image.LANCZOS).save(f'{out}/{dest}.png')

fit('1-point', (1280, 800), 'screenshot-1-point')
fit('2-draw', (1280, 800), 'screenshot-2-draw')
fit('3-slap', (1280, 800), 'screenshot-3-slap')
fit('5-settings', (1280, 800), 'screenshot-5-settings')
fit('tile', (440, 280), 'promo-small-440x280')

# Robot with the popup open at the top right, as if from the toolbar.
page = Image.open(f'{raw}/4-robot.png').convert('RGBA').resize((1280, 800), Image.LANCZOS)
popup = Image.open(f'{raw}/popup.png').convert('RGBA')
popup = popup.resize((340, round(popup.height * 340 / popup.width)), Image.LANCZOS)
mask = Image.new('L', popup.size, 0)
from PIL import ImageDraw
ImageDraw.Draw(mask).rounded_rectangle((0, 0, popup.width - 1, popup.height - 1), radius=12, fill=255)
x, y = 1280 - popup.width - 24, 18
shadow = Image.new('RGBA', page.size, (0, 0, 0, 0))
shadow_mask = Image.new('L', page.size, 0)
ImageDraw.Draw(shadow_mask).rounded_rectangle((x, y + 8, x + popup.width, y + popup.height + 8), radius=14, fill=90)
shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(16)))
page = Image.alpha_composite(page, shadow)
page.paste(popup, (x, y), mask)
page.convert('RGB').save(f'{out}/screenshot-4-styles.png')
print('composed', out)
