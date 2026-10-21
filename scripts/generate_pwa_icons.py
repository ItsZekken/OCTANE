import math
from PIL import Image, ImageDraw

def create_octane_icon(size, is_maskable=False):
    # Render at 4x for super sampling / smooth antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = canvas_size / 2
    cy = canvas_size / 2

    # Background
    if is_maskable:
        # Full bleed square for maskable icon
        draw.rectangle([0, 0, canvas_size, canvas_size], fill=(9, 9, 11, 255))
        content_radius = canvas_size * 0.36
    else:
        # Rounded squircle for standard icons
        corner_r = canvas_size * 0.22
        draw.rounded_rectangle([0, 0, canvas_size, canvas_size], radius=corner_r, fill=(9, 9, 11, 255))
        content_radius = canvas_size * 0.38

    # Outer subtle track ring
    r_outer = content_radius * 0.95
    track_w = max(4, int(14 * (size / 512) * scale))
    draw.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=(39, 39, 42, 255), width=track_w)

    # Active Tachometer Arc (135 deg to 405 deg)
    arc_w = max(6, int(24 * (size / 512) * scale))
    draw.arc([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], start=135, end=405, fill=(245, 158, 11, 255), width=arc_w)

    # Major Tick Marks
    tick_len = r_outer * 0.16
    for angle_deg in [135, 180, 225, 270, 315, 360, 405]:
        rad = math.radians(angle_deg)
        x1 = cx + (r_outer - tick_len) * math.cos(rad)
        y1 = cy + (r_outer - tick_len) * math.sin(rad)
        x2 = cx + (r_outer + 2) * math.cos(rad)
        y2 = cy + (r_outer + 2) * math.sin(rad)
        color = (251, 191, 36, 255) if angle_deg in [270, 405] else (113, 113, 122, 255)
        tick_w = max(2, int(8 * (size / 512) * scale))
        draw.line([(x1, y1), (x2, y2)], fill=color, width=tick_w)

    # Central precision "O" ring
    r_inner = content_radius * 0.44
    ring_w = max(4, int(28 * (size / 512) * scale))
    draw.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], outline=(250, 250, 250, 255), width=ring_w)

    # Central Horology Pip
    pip_r = content_radius * 0.12
    draw.ellipse([cx - pip_r, cy - pip_r, cx + pip_r, cy + pip_r], fill=(9, 9, 11, 255))
    
    # Amber needle/indicator notch
    needle_h = content_radius * 0.32
    needle_w = max(2, int(12 * (size / 512) * scale))
    draw.rectangle([cx - needle_w // 2, cy - needle_h, cx + needle_w // 2, cy + needle_h * 0.3], fill=(245, 158, 11, 255))

    # Amber center bead
    center_bead = max(3, int(10 * (size / 512) * scale))
    draw.ellipse([cx - center_bead, cy - center_bead, cx + center_bead, cy + center_bead], fill=(255, 255, 255, 255))

    # Downsample using high quality Lanczos filter
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

# Generate all required icon files
icons_config = [
    ("public/icons/icon-192.png", 192, False),
    ("public/icons/icon-512.png", 512, False),
    ("public/icons/icon-maskable.png", 512, True),
    ("public/icons/apple-touch-icon.png", 180, False),
    ("public/favicon.png", 64, False),
]

for path, size, maskable in icons_config:
    icon = create_octane_icon(size, is_maskable=maskable)
    icon.save(path, format="PNG")
    print(f"Generated: {path} ({size}x{size})")

# Also create favicon.ico from 64px image
fav = Image.open("public/favicon.png")
fav.save("public/favicon.ico", format="ICO", sizes=[(64, 64), (32, 32), (16, 16)])
print("Generated: public/favicon.ico")
