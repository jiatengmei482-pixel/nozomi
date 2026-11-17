"""
包车行程地图「上车和下车是同一个地点」时的合并标记图标（#267 验收意见 2026-11-16）：`apps/web/public/map-markers/1-N.png`（N = 3…12）。
样式照 10–12 号图标：深蓝底、白边、白字；画成横向胶囊，放在 64 × 64 的透明方形里（谷歌要求方形、不超过 64 × 64）。
重新生成：python3 scripts/map-markers-merged.py（需要 Pillow 和 DejaVu Sans Bold）。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "apps/web/public/map-markers"
FILL = (27, 42, 92, 255)
EDGE = (255, 255, 255, 255)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SCALE = 4  # 先画 4 倍再缩小，边缘平滑
SIZE = 64


def draw(last: int) -> Image.Image:
    big = SIZE * SCALE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    text = f"1·{last}"
    font = ImageFont.truetype(FONT, (20 if last < 10 else 17) * SCALE)
    left, top, right, bottom = pen.textbbox((0, 0), text, font=font)
    height = 40 * SCALE
    width = min(big - 2 * SCALE, (right - left) + 14 * SCALE)
    box = ((big - width) // 2, (big - height) // 2, (big + width) // 2, (big + height) // 2)
    pen.rounded_rectangle(box, radius=height // 2, fill=FILL, outline=EDGE, width=3 * SCALE)
    pen.text((big / 2, big / 2), text, font=font, fill=EDGE, anchor="mm")
    return image.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    for last in range(3, 13):
        draw(last).save(OUT / f"1-{last}.png", optimize=True)
