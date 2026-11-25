"""根据矢量源文件 echodeck-logo.canvas.json 渲染超采样高清图标并同步至 Web 与 Android 全套 mipmap。"""
from __future__ import annotations

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CANVAS_PATH = ROOT / "design" / "echodeck-logo.canvas.json"
WEB_ICON = ROOT / "frontend" / "public" / "icon.png"
DEMO_COVER = ROOT / "frontend" / "public" / "demo" / "starter_cover.jpg"
ANDROID_RES = ROOT / "frontend" / "android" / "app" / "src" / "main" / "res"

MIPMAPS = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def parse_hex_rgba(color: str | None, opacity: float = 1.0) -> tuple[int, int, int, int] | None:
    if not color or color.lower() == "transparent":
        return None
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) == 6:
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        a = int(round(max(0.0, min(1.0, opacity)) * 255))
        return (r, g, b, a)
    if len(c) == 8:
        r, g, b, a = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), int(c[6:8], 16)
        a = int(round(a * max(0.0, min(1.0, opacity))))
        return (r, g, b, a)
    return (255, 255, 255, 255)


def render_canvas(spec: dict, transparent_bg: bool = False, scale: int = 2) -> Image.Image:
    w = int(spec.get("width", 1024))
    h = int(spec.get("height", 1024))
    sw, sh = w * scale, h * scale

    bg_hex = spec.get("background", "#111214")
    bg_rgba = (0, 0, 0, 0) if transparent_bg else (parse_hex_rgba(bg_hex) or (17, 18, 20, 255))
    canvas = Image.new("RGBA", (sw, sh), bg_rgba)

    for layer in spec.get("layers", []):
        if layer.get("visible") is False:
            continue
        ltype = layer.get("type")
        opacity = float(layer.get("opacity", 1.0))
        angle = float(layer.get("angle", 0.0))
        fill = parse_hex_rgba(layer.get("fill"), opacity)
        stroke = parse_hex_rgba(layer.get("stroke"), opacity)
        stroke_w = int(round(float(layer.get("strokeWidth", 0)) * scale))

        layer_img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer_img)

        if ltype == "rect":
            x = float(layer.get("left", 0)) * scale
            y = float(layer.get("top", 0)) * scale
            rw = float(layer.get("width", 100)) * scale
            rh = float(layer.get("height", 100)) * scale
            rx = float(layer.get("rx", layer.get("ry", 0))) * scale
            draw.rounded_rectangle(
                [x, y, x + rw, y + rh],
                radius=min(rx, rw / 2, rh / 2),
                fill=fill,
                outline=stroke if stroke_w > 0 else None,
                width=stroke_w,
            )
            cx, cy = x + rw / 2, y + rh / 2
        elif ltype == "circle":
            x = float(layer.get("left", 0)) * scale
            y = float(layer.get("top", 0)) * scale
            rad = float(layer.get("radius", 32)) * scale
            d = rad * 2
            draw.ellipse(
                [x, y, x + d, y + d],
                fill=fill,
                outline=stroke if stroke_w > 0 else None,
                width=stroke_w,
            )
            cx, cy = x + rad, y + rad
        elif ltype == "line":
            x = float(layer.get("left", 0)) * scale
            y = float(layer.get("top", 0)) * scale
            lw = float(layer.get("width", 200)) * scale
            draw.line([x, y, x + lw, y], fill=stroke or fill, width=max(scale, stroke_w or 4 * scale))
            cx, cy = x + lw / 2, y
        else:
            continue

        if abs(angle) > 0.01:
            layer_img = layer_img.rotate(-angle, resample=Image.Resampling.BICUBIC, center=(cx, cy))

        canvas = Image.alpha_composite(canvas, layer_img)

    return canvas.resize((w, h), Image.Resampling.LANCZOS)


def make_circle_mask(size: int) -> Image.Image:
    big = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(big).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    return big.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    spec = json.loads(CANVAS_PATH.read_text(encoding="utf-8"))
    bg_hex = spec.get("background", "#111214")
    full_img = render_canvas(spec, transparent_bg=False, scale=3)
    fg_img = render_canvas(spec, transparent_bg=True, scale=3)

    # 1. Web 512x512 icon
    WEB_ICON.parent.mkdir(parents=True, exist_ok=True)
    full_img.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB").save(WEB_ICON, format="PNG", optimize=True)

    # 2. Demo 16:9 minimalist cover
    cover = Image.new("RGB", (960, 540), parse_hex_rgba(bg_hex)[:3])
    mark_small = fg_img.resize((340, 340), Image.Resampling.LANCZOS)
    cover.paste(mark_small, ((960 - 340) // 2, (540 - 340) // 2), mark_small)
    DEMO_COVER.parent.mkdir(parents=True, exist_ok=True)
    cover.save(DEMO_COVER, format="JPEG", quality=92)

    # 3. Android mipmaps + adaptive icon foreground + background color XML
    for folder, (launcher_px, fg_px) in MIPMAPS.items():
        d = ANDROID_RES / folder
        d.mkdir(parents=True, exist_ok=True)
        sq = full_img.resize((launcher_px, launcher_px), Image.Resampling.LANCZOS).convert("RGBA")
        sq.save(d / "ic_launcher.png", format="PNG", optimize=True)

        rnd = Image.new("RGBA", (launcher_px, launcher_px), (0, 0, 0, 0))
        rnd.paste(sq, (0, 0), make_circle_mask(launcher_px))
        rnd.save(d / "ic_launcher_round.png", format="PNG", optimize=True)

        # Android 自适应前景图标（在 108dp 画布居中放置主图形）
        fg_out = fg_img.resize((fg_px, fg_px), Image.Resampling.LANCZOS)
        fg_out.save(d / "ic_launcher_foreground.png", format="PNG", optimize=True)

    bg_xml = ANDROID_RES / "values" / "ic_launcher_background.xml"
    bg_xml.parent.mkdir(parents=True, exist_ok=True)
    bg_xml.write_text(
        f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{bg_hex}</color>\n</resources>\n',
        encoding="utf-8",
    )

    print(f"LOGO_SYNCED_OK: bg={bg_hex}, web={WEB_ICON}, android_mipmaps={len(MIPMAPS)}")


if __name__ == "__main__":
    main()
