import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFilter

import app as medilink_app


class TestOCREdgeCases(unittest.TestCase):

    def setUp(self):
        medilink_app.app.config["TESTING"] = True
        self.client = medilink_app.app.test_client()
        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "test-user"

    @staticmethod
    def make_png_image(blurry=False):
        image = Image.new("RGB", (400, 100), "white")
        ImageDraw.Draw(image).text(
            (10, 20),
            "Sample OCR",
            fill="black"
        )
        if blurry:
            image = image.filter(ImageFilter.GaussianBlur(radius=3))

        image_data = BytesIO()
        image.save(image_data, format="PNG")
        return image_data.getvalue()

    def upload_png(self, image_bytes):
        return self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(image_bytes),
                    "sample.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

    def test_upload_over_10_mb_returns_file_too_large(self):
        response = self.upload_png(b"x" * (10 * 1024 * 1024 + 1))

        self.assertEqual(response.status_code, 413)
        self.assertTrue(response.is_json)
        self.assertEqual(
            response.get_json()["error_code"],
            "FILE_TOO_LARGE"
        )

    @patch(
        "app.pytesseract.image_to_string",
        return_value=""
    )
    def test_valid_image_with_no_ocr_text_returns_422(self, mock_ocr):
        response = self.upload_png(self.make_png_image())

        self.assertEqual(response.status_code, 422)
        self.assertTrue(response.is_json)
        result = response.get_json()
        self.assertFalse(result["success"])
        self.assertEqual(result["error_code"], "OCR_NO_TEXT")
        mock_ocr.assert_called_once()

    @patch(
        "app.pytesseract.image_to_string",
        side_effect=RuntimeError("Tesseract timed out")
    )
    def test_tesseract_timeout_returns_503(self, mock_ocr):
        response = self.upload_png(self.make_png_image())

        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.is_json)
        result = response.get_json()
        self.assertFalse(result["success"])
        self.assertEqual(result["error_code"], "OCR_FAILED")
        mock_ocr.assert_called_once()

    @patch(
        "app.pytesseract.image_to_string",
        return_value="Recognized sample text"
    )
    def test_blurry_image_is_accepted_for_ocr(self, mock_ocr):
        response = self.upload_png(self.make_png_image(blurry=True))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.is_json)
        result = response.get_json()
        self.assertTrue(result["success"])
        self.assertTrue(result["data"]["extracted"].strip())
        mock_ocr.assert_called_once()


if __name__ == "__main__":
    unittest.main()
