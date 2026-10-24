"""Check that Tesseract and its English/Vietnamese language data work."""

from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont
import pytesseract
from pytesseract import TesseractError, TesseractNotFoundError


# Point pytesseract to the Tesseract program installed on this Windows PC.
TESSERACT_EXE = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
pytesseract.pytesseract.tesseract_cmd = str(TESSERACT_EXE)

# Arial supports Vietnamese accent marks and is included with Windows.
FONT_FILE = Path(r"C:\Windows\Fonts\arial.ttf")


def main():
    """Check Tesseract languages, then OCR a sample image."""
    if not TESSERACT_EXE.is_file():
        print(f"Tesseract was not found at: {TESSERACT_EXE}")
        print("Check the installation path and update TESSERACT_EXE if needed.")
        return 1

    try:
        installed_languages = pytesseract.get_languages(config="")
    except (TesseractNotFoundError, TesseractError, OSError) as error:
        print(f"Could not check Tesseract languages: {error}")
        print(
            f"Run this command in PowerShell to check manually:\n"
            f"& '{TESSERACT_EXE}' --list-langs"
        )
        return 1

    required_languages = {"eng", "vie"}
    missing_languages = required_languages - set(installed_languages)
    if missing_languages:
        print("Required Tesseract language data is missing:")
        for language in sorted(missing_languages):
            print(f"- {language}")
        print("Install the missing language data, then check again with:")
        print(f"& '{TESSERACT_EXE}' --list-langs")
        return 1

    if not FONT_FILE.is_file():
        print(f"Sample image font was not found: {FONT_FILE}")
        print("Install Arial or update FONT_FILE to a Windows font that supports Vietnamese.")
        return 1

    # Draw simple English and Vietnamese text into an image held in memory.
    image = Image.new("RGB", (720, 150), color="white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT_FILE), 32)
    draw.multiline_text(
        (20, 20),
        "Hello, MediLink!\nXin chào MediLink! Sức khỏe tốt.",
        fill="black",
        font=font,
        spacing=12,
    )

    try:
        extracted_text = pytesseract.image_to_string(image, lang="eng+vie")
    except (TesseractNotFoundError, TesseractError, OSError) as error:
        print(f"OCR could not run: {error}")
        print(
            f"Check the installed language data with:\n"
            f"& '{TESSERACT_EXE}' --list-langs"
        )
        return 1

    print("OCR test finished. Extracted text:")
    print(extracted_text.strip() or "(No text was recognized.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
