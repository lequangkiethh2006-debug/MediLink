"""Tests for the conservative OCR text-to-fields parser."""

import unittest

from app import parse_medical_text


class TestMedicalTextParser(unittest.TestCase):

    def test_parses_laboratory_report_fields(self):
        result = parse_medical_text(
            "PHIẾU KẾT QUẢ XÉT NGHIỆM\n"
            "Test date: 17/10/2026\n"
            "Glucose 5.6 mmol/L 3.9 - 6.1"
        )

        self.assertEqual(result["document_type"], "laboratory_report")
        self.assertEqual(result["test_date"], "17/10/2026")
        self.assertEqual(
            result["tests"],
            [{
                "name": "Glucose",
                "result_value": "5.6",
                "unit": "mmol/L",
                "reference_range": "3.9 - 6.1",
            }],
        )
        self.assertEqual(result["fields_requiring_confirmation"], [])

    def test_referral_does_not_create_laboratory_rows(self):
        result = parse_medical_text(
            "GIẤY CHUYỂN TUYẾN\n"
            "Glucose 5.6 mmol/L 3.9 - 6.1"
        )

        self.assertEqual(result["document_type"], "referral")
        self.assertIsNone(result["test_date"])
        self.assertEqual(result["tests"], [])
        self.assertEqual(result["fields_requiring_confirmation"], [])

    def test_unknown_document_type_requests_confirmation(self):
        result = parse_medical_text("Patient information\nSome other document")

        self.assertIsNone(result["document_type"])
        self.assertIsNone(result["test_date"])
        self.assertEqual(result["tests"], [])
        self.assertEqual(
            result["fields_requiring_confirmation"][0]["field"],
            "document_type",
        )

    def test_missing_values_are_null_and_need_confirmation(self):
        result = parse_medical_text(
            "LAB REPORT\n"
            "Glucose mmol/L 3.9 - 6.1\n"
            "Urea 5.2"
        )

        self.assertEqual(len(result["tests"]), 2)
        glucose, urea = result["tests"]
        self.assertIsNone(glucose["result_value"])
        self.assertEqual(glucose["unit"], "mmol/L")
        self.assertIsNone(urea["unit"])
        self.assertIsNone(urea["reference_range"])

        confirmation_fields = {
            item["field"] for item in result["fields_requiring_confirmation"]
        }
        self.assertIn("test_date", confirmation_fields)
        self.assertIn("tests.Glucose.result_value", confirmation_fields)
        self.assertIn("tests.Urea.unit", confirmation_fields)
        self.assertIn("tests.Urea.reference_range", confirmation_fields)

    def test_conflicting_values_are_not_guessed(self):
        result = parse_medical_text(
            "LAB REPORT\n"
            "Test date: 17/10/2026\n"
            "Glucose 5.6 mmol/L 3.9 - 6.1\n"
            "Glucose 8.1 mmol/L 3.9 - 6.1"
        )

        self.assertEqual(len(result["tests"]), 1)
        self.assertIsNone(result["tests"][0]["result_value"])
        self.assertIn(
            {
                "field": "tests.Glucose.result_value",
                "reason": (
                    "Multiple different values were found for this test; "
                    "please verify the original."
                ),
            },
            result["fields_requiring_confirmation"],
        )

    def test_ambiguous_date_is_not_selected(self):
        result = parse_medical_text(
            "LAB REPORT\nTest date: 03/04/2026\nGlucose 5.6 mmol/L"
        )

        self.assertIsNone(result["test_date"])
        self.assertTrue(any(
            item["field"] == "test_date"
            and "day/month or month/day" in item["reason"]
            for item in result["fields_requiring_confirmation"]
        ))


if __name__ == "__main__":
    unittest.main()
