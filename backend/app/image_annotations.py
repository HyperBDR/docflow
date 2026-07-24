from PIL import Image, ImageColor, ImageDraw, ImageFilter


def apply_annotations(image: Image.Image, annotations: list[dict]) -> Image.Image:
    """Render cover, blur, and mosaic annotations onto an RGB image."""
    result = image.convert("RGB")
    for annotation in annotations:
        try:
            left = max(0, min(result.width, round(float(annotation.get("x", 0)) * result.width)))
            top = max(0, min(result.height, round(float(annotation.get("y", 0)) * result.height)))
            right = max(left, min(result.width, round((float(annotation.get("x", 0)) + float(annotation.get("w", 0))) * result.width)))
            bottom = max(top, min(result.height, round((float(annotation.get("y", 0)) + float(annotation.get("h", 0))) * result.height)))
        except (TypeError, ValueError):
            continue
        if right <= left or bottom <= top:
            continue
        kind = str(annotation.get("kind", "cover"))
        if kind == "blur":
            region = result.crop((left, top, right, bottom)).filter(ImageFilter.GaussianBlur(radius=max(6, min(right - left, bottom - top) / 18)))
            result.paste(region, (left, top))
        elif kind == "mosaic":
            region = result.crop((left, top, right, bottom))
            pixel = max(7, min(24, round(min(region.width, region.height) / 12)))
            reduced = region.resize((max(1, region.width // pixel), max(1, region.height // pixel)), Image.Resampling.BILINEAR)
            result.paste(reduced.resize(region.size, Image.Resampling.NEAREST), (left, top))
        else:
            try:
                color = ImageColor.getrgb(str(annotation.get("color", "#23272f")))
            except ValueError:
                color = (35, 39, 47)
            ImageDraw.Draw(result).rectangle((left, top, right, bottom), fill=color)
    return result
