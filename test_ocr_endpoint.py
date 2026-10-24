
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image, ImageDraw

import app as medilink_app


class TestOCREndpoint(unittest.TestCase):

    def setUp(self):
        medilink_app.app.config["TESTING"] = True
        self.client = medilink_app.app.test_client()

    def log_in_test_user(self):
        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "test-user"

    @staticmethod
    def make_png_image():
        image = Image.new("RGB", (400, 100), "white")
        ImageDraw.Draw(image).text(
            (10, 20),
            "Sample OCR",
            fill="black"
        )

        image_data = BytesIO()
        image.save(image_data, format="PNG")
        return image_data.getvalue()

    def test_unauthenticated_request_returns_json_401(self):
        response = self.client.post("/api/ocr")

        self.assertEqual(response.status_code, 401)
        self.assertTrue(response.is_json)

        result = response.get_json()
        self.assertFalse(result["success"])
        self.assertEqual(result["error_code"], "AUTH_REQUIRED")

    @patch(
        "app.pytesseract.image_to_string",
        return_value="Sample OCR text"
    )
    def test_logged_in_user_uploading_png_gets_ocr_text(
        self, mock_ocr
    ):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(self.make_png_image()),
                    "sample.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.is_json)

        result = response.get_json()
        self.assertTrue(result["success"])
        self.assertIn("message", result)
        self.assertTrue(result["data"]["ocr_available"])
        self.assertEqual(
            result["data"]["extracted"],
            "Sample OCR text"
        )
        self.assertEqual(
            result["data"]["structured"]["document_type"],
            None
        )
        self.assertEqual(result["data"]["structured"]["test_date"], None)
        self.assertEqual(result["data"]["structured"]["tests"], [])
        self.assertTrue(
            result["data"]["structured"]["fields_requiring_confirmation"]
        )

        mock_ocr.assert_called_once()
        self.assertEqual(
            mock_ocr.call_args.kwargs["lang"],
            "eng+vie"
        )

    @patch(
        "app.pytesseract.image_to_string",
        return_value=""
    )
    def test_empty_ocr_result_returns_422(self, mock_ocr):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(self.make_png_image()),
                    "sample.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 422)
        self.assertTrue(response.is_json)
        result = response.get_json()
        self.assertFalse(result["success"])
        self.assertEqual(result["error_code"], "OCR_NO_TEXT")
        mock_ocr.assert_called_once()

    @patch(
        "app.pytesseract.image_to_string",
        return_value="  \n\t "
    )
    def test_whitespace_only_ocr_result_returns_422(self, mock_ocr):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(self.make_png_image()),
                    "sample.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 422)
        self.assertTrue(response.is_json)
        result = response.get_json()
        self.assertFalse(result["success"])
        self.assertEqual(result["error_code"], "OCR_NO_TEXT")
        mock_ocr.assert_called_once()

    def test_empty_image_is_rejected(self):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(b""),
                    "empty.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.is_json)
        self.assertEqual(
            response.get_json()["error_code"],
            "EMPTY_FILE"
        )

    def test_corrupt_image_is_rejected(self):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(b"This is not a real image"),
                    "corrupt.png",
                    "image/png"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.is_json)
        self.assertEqual(
            response.get_json()["error_code"],
            "INVALID_CONTENT"
        )

    def test_pdf_is_rejected(self):
        self.log_in_test_user()

        response = self.client.post(
            "/api/ocr",
            data={
                "document": (
                    BytesIO(b"%PDF-1.4"),
                    "document.pdf",
                    "application/pdf"
                )
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.is_json)
        self.assertEqual(
            response.get_json()["error_code"],
            "PDF_NOT_SUPPORTED"
        )


if __name__ == "__main__":
    unittest.main()
