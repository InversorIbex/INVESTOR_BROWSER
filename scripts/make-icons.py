"""Generate build/icon.png (512) and build/icon.ico from the brand mark. Rerun after changing colours."""
from PIL import Image, ImageDraw
import sys

ACCENT = sys.argv[1] if len(sys.argv) > 1 else "#5B8CFF"
S = 1024  # supersample
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pad = 64
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=230, fill=ACCENT)
u = (S - 2 * pad) / 30.0
def p(x, y): return (pad + (x - 1) * u, pad + (y - 1) * u)
pts = [p(7, 21.5), p(13, 15.5), p(17.5, 19), p(25, 10.5)]
w = int(2.8 * u)
d.line(pts, fill="white", width=w, joint="curve")
for x, y in pts[:-1]:
    cx, cy = x, y
    d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill="white")
cx, cy = pts[-1]
r = 2.2 * u
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="white")
icon = img.resize((512, 512), Image.LANCZOS)
icon.save("build/icon.png")
icon.save("build/icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
