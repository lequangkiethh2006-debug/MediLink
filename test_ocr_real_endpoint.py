"""Check real local OCR through MediLink's Flask endpoint."""

import sys
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

import app as medilink_app


def create_sample_png():
    """Create a fake sample document image in memory."""
    arial_path = r"C:\Windows\Fonts\arial.ttf"
    using_fallback_font = False

    try:
        font = ImageFont.truetype(arial_path, 42)
        image = Image.new("RGB", (1500, 360), color="white")
        draw = ImageDraw.Draw(image)
        text_position = (40, 35)
        line_spacing = 28
    except OSError:
        # Pillow's built-in font is small, so draw it on a small canvas and
        # enlarge the finished image to make the letters easier for OCR.
        using_fallback_font = True
        font = ImageFont.load_default()
        image = Image.new("RGB", (500, 120), color="white")
        draw = ImageDraw.Draw(image)
        text_position = (12, 10)
        line_spacing = 8

    sample_text = (
        "Patient Name: Test User\n"
        "Blood Pressure: 120/80\n"
        "Ngay kham: 17/10/2026"
    )
    draw.multiline_text(
        text_position,
        sample_text,
        fill="black",
        font=font,
        spacing=line_spacing,
    )

    # Enlarge the fallback-font image while it is still in memory.
    if using_fallback_font:
        resampling = getattr(Image, "Resampling", Image)
        image = image.resize(
            (image.width * 4, image.height * 4),
            resample=resampling.LANCZOS,
        )

    image_buffer = BytesIO()
    image.save(image_buffer, format="PNG")
    return image_buffer.getvalue()


def main():
    """Send the sample image to the real OCR endpoint."""
    medilink_app.app.config["TESTING"] = True
    client = medilink_app.app.test_client()

    # The OCR endpoint checks that this session key is present.
    with client.session_transaction() as test_session:
        test_session["user_id"] = "ocr-test-user"

    response = client.post(
        "/api/ocr",
        data={
            "document": (
                BytesIO(create_sample_png()),
                "ocr-test.png",
                "image/png",
            )
        },
        content_type="multipart/form-data",
    )

    print(f"HTTP status: {response.status_code}")

    if not response.is_json:
        print("Failure: the endpoint did not return JSON.")
        print(response.get_data(as_text=True))
        return 1

    result = response.get_json()
    if response.status_code != 200 or not result.get("success"):
        print("Failure: the OCR request was not successful.")
        print("API response:", result)
        return 1

    data = result.get("data")
    extracted_text = data.get("extracted") if isinstance(data, dict) else None
    print("Extracted text:")
    print(extracted_text if isinstance(extracted_text, str) else "(Missing text field)")

    if not isinstance(extracted_text, str) or not extracted_text.strip():
        print("Failure: OCR returned no non-empty extracted text.")
        print("API response:", result)
        return 1

    print("Success: real OCR returned non-empty text.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
