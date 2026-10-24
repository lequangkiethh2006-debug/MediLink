"""Run the local OCR endpoint against the project's sample medical images."""

import sys
from io import BytesIO
from pathlib import Path

import app as medilink_app


def main():
    """Upload each sample image through Flask's in-process test client."""
    project_root = Path(__file__).resolve().parent
    sample_paths = (
        project_root / "static" / "images" / "sample-1.png",
        project_root / "static" / "images" / "sample-2.png",
    )

    missing_paths = [path for path in sample_paths if not path.is_file()]
    if missing_paths:
        for path in missing_paths:
            print(f"Sample image not found: {path}")
        print("Run this test from the project with both sample images present.")
        return 1

    medilink_app.app.config["TESTING"] = True
    client = medilink_app.app.test_client()

    # The endpoint checks for this session key to authenticate the request.
    with client.session_transaction() as test_session:
        test_session["user_id"] = "ocr-sample-test-user"

    failed = False

    for image_path in sample_paths:
        with image_path.open("rb") as image_file:
            response = client.post(
                "/api/ocr",
                data={
                    "document": (
                        BytesIO(image_file.read()),
                        image_path.name,
                        "image/png",
                    )
                },
                content_type="multipart/form-data",
            )

        result = response.get_json(silent=True)
        if not isinstance(result, dict):
            result = {}

        data = result.get("data")
        extracted_text = data.get("extracted") if isinstance(data, dict) else ""
        if not isinstance(extracted_text, str):
            extracted_text = ""
        has_text = bool(extracted_text.strip())

        print(f"\nFilename: {image_path.name}")
        print(f"HTTP status: {response.status_code}")
        print(f"Extracted text non-empty: {'yes' if has_text else 'no'}")
        print("Extracted text:")
        print(extracted_text if has_text else "(No extracted text returned.)")

        if response.status_code != 200 or result.get("success") is not True or not has_text:
            error_code = result.get("error_code", "UNKNOWN_ERROR")
            message = result.get("message", "The endpoint did not return successful OCR.")
            print(f"OCR request failed: {error_code} - {message}")
            failed = True

    if failed:
        print("\nOne or more sample images did not produce a successful OCR result.")
        return 1

    print("\nOCR returned non-empty text for both sample images.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
