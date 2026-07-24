from PIL import Image

from app.image_annotations import apply_annotations


def patterned_image():
    image = Image.new("RGB", (120, 80))
    for x in range(image.width):
        for y in range(image.height):
            image.putpixel((x, y), ((x * 7) % 255, (y * 11) % 255, ((x + y) * 5) % 255))
    return image


def test_cover_annotation_uses_requested_color():
    result = apply_annotations(patterned_image(), [{"x": .25, "y": .25, "w": .5, "h": .5, "kind": "cover", "color": "#123456"}])
    assert result.getpixel((60, 40)) == (0x12, 0x34, 0x56)


def test_mosaic_and_blur_change_only_the_selected_region():
    source = patterned_image()
    for kind in ("mosaic", "blur"):
        result = apply_annotations(source, [{"x": .25, "y": .25, "w": .5, "h": .5, "kind": kind}])
        assert result.getpixel((5, 5)) == source.getpixel((5, 5))
        assert result.getpixel((60, 40)) != source.getpixel((60, 40))
