import os
import sqlite3
import tempfile
import unittest
from contextlib import closing

import app as medilink_app


class TestSbarApi(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_database = medilink_app.app.config["DATABASE"]
        self.original_testing = medilink_app.app.config.get("TESTING", False)
        self.database_path = os.path.join(self.temp_dir.name, "test-handover.sqlite3")
        medilink_app.app.config.update(
            DATABASE=self.database_path,
            TESTING=True,
        )
        medilink_app.init_database()
        self.client = medilink_app.app.test_client()
        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "handover-staff-1"
            user_session["role"] = "staff"
            user_session["staff_role"] = "shift-lead"
            user_session["_csrf_token"] = "test-csrf-token"

    def tearDown(self):
        medilink_app.app.config.update(
            DATABASE=self.original_database,
            TESTING=self.original_testing,
        )
        self.temp_dir.cleanup()

    def post_json(self, path, payload, token="test-csrf-token"):
        headers = {}
        if token:
            headers["X-CSRF-Token"] = token
        return self.client.post(path, json=payload, headers=headers)

    def read_row(self, handover_id):
        with closing(sqlite3.connect(self.database_path)) as connection:
            connection.row_factory = sqlite3.Row
            return connection.execute(
                "SELECT * FROM handovers WHERE handover_id = ?",
                (handover_id,),
            ).fetchone()

    def test_draft_submission_history_and_persistence(self):
        draft_response = self.post_json(
            "/api/sbar/drafts",
            {
                "case_ref": "CASE-TEST-1",
                "situation": "Initial situation",
                "background": "Relevant background",
                "assessment": "",
                "recommendation": "",
                "staff_role": "forged-role",
            },
        )
        self.assertEqual(draft_response.status_code, 201)
        draft = draft_response.get_json()["data"]
        handover_id = draft["handover_id"]
        self.assertRegex(handover_id, r"^HO-[A-F0-9]{32}$")
        stored_draft = self.read_row(handover_id)
        self.assertEqual(stored_draft["staff_id"], "handover-staff-1")
        self.assertEqual(stored_draft["staff_role"], "shift-lead")
        self.assertEqual(stored_draft["status"], "draft")
        self.assertIsNone(stored_draft["submitted_at"])

        updated_response = self.post_json(
            "/api/sbar/drafts",
            {
                "handover_id": handover_id,
                "case_ref": "CASE-TEST-1",
                "situation": "Updated situation",
                "background": "Relevant background",
                "assessment": "Assessment",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(updated_response.status_code, 200)

        incomplete_response = self.post_json(
            "/api/sbar",
            {
                "handover_id": handover_id,
                "situation": "Situation",
                "assessment": "",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(incomplete_response.status_code, 400)
        self.assertEqual(
            incomplete_response.get_json()["error_code"],
            "VALIDATION_ERROR",
        )
        self.assertEqual(self.read_row(handover_id)["status"], "draft")

        submitted_response = self.post_json(
            "/api/sbar",
            {
                "handover_id": handover_id,
                "case_ref": "CASE-TEST-1",
                "situation": "Updated situation",
                "background": "Relevant background",
                "assessment": "Assessment",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(submitted_response.status_code, 200)
        self.assertEqual(
            submitted_response.get_json()["data"]["status"],
            "submitted",
        )

        stored_submission = self.read_row(handover_id)
        self.assertEqual(stored_submission["status"], "submitted")
        self.assertIsNotNone(stored_submission["submitted_at"])
        self.assertEqual(
            stored_submission["situation"],
            "Updated situation",
        )
        with closing(sqlite3.connect(self.database_path)) as connection:
            actions = connection.execute(
                """
                SELECT action FROM handover_audit
                WHERE handover_id = ? ORDER BY audit_id
                """,
                (handover_id,),
            ).fetchall()
        self.assertEqual(
            [row[0] for row in actions],
            ["draft_saved", "draft_updated", "submitted"],
        )

        medilink_app.init_database()
        history_response = self.client.get("/api/sbar")
        self.assertEqual(history_response.status_code, 200)
        history = history_response.get_json()["data"]["handovers"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["handover_id"], handover_id)
        self.assertEqual(history[0]["staff_role"], "shift-lead")
        self.assertEqual(history[0]["status"], "submitted")
        self.assertNotIn("situation", history[0])

        duplicate_response = self.post_json(
            "/api/sbar",
            {
                "handover_id": handover_id,
                "situation": "Updated situation",
                "assessment": "Assessment",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(duplicate_response.status_code, 409)

    def test_direct_submission_and_input_validation(self):
        invalid_case_ref = self.post_json(
            "/api/sbar/drafts",
            {"case_ref": "case contains patient name"},
        )
        self.assertEqual(invalid_case_ref.status_code, 400)
        self.assertEqual(
            invalid_case_ref.get_json()["error_code"],
            "INVALID_CASE_REF",
        )

        oversized_field = self.post_json(
            "/api/sbar",
            {
                "situation": "x" * 2001,
                "assessment": "Assessment",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(oversized_field.status_code, 400)
        self.assertEqual(oversized_field.get_json()["error_code"], "TOO_LONG")

        direct_submission = self.post_json(
            "/api/sbar",
            {
                "situation": "Situation",
                "assessment": "Assessment",
                "recommendation": "Next steps",
            },
        )
        self.assertEqual(direct_submission.status_code, 201)
        handover_id = direct_submission.get_json()["data"]["handover_id"]
        self.assertEqual(self.read_row(handover_id)["status"], "submitted")

        invalid_csrf = self.post_json(
            "/api/sbar/drafts",
            {"situation": "Draft"},
            token="invalid",
        )
        self.assertEqual(invalid_csrf.status_code, 403)
        self.assertEqual(invalid_csrf.get_json()["error_code"], "CSRF_FAILED")

    def test_authentication_and_staff_ownership(self):
        with self.client.session_transaction() as user_session:
            user_session.clear()
        unauthenticated = self.client.get("/api/sbar")
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(
            unauthenticated.get_json()["error_code"],
            "AUTH_REQUIRED",
        )

        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "handover-patient"
            user_session["role"] = "patient"
            user_session["_csrf_token"] = "test-csrf-token"
        patient_access = self.client.get("/api/sbar")
        self.assertEqual(patient_access.status_code, 403)
        self.assertEqual(
            patient_access.get_json()["error_code"],
            "STAFF_REQUIRED",
        )

        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "handover-staff-1"
            user_session["role"] = "staff"
            user_session["staff_role"] = "shift-lead"
        created = self.post_json(
            "/api/sbar/drafts",
            {"situation": "Private staff draft"},
        )
        handover_id = created.get_json()["data"]["handover_id"]

        with self.client.session_transaction() as user_session:
            user_session["user_id"] = "handover-staff-2"
            user_session["role"] = "staff"
            user_session["staff_role"] = "treating"
        other_staff_history = self.client.get("/api/sbar")
        self.assertEqual(
            other_staff_history.get_json()["data"]["handovers"],
            [],
        )
        other_staff_update = self.post_json(
            "/api/sbar/drafts",
            {"handover_id": handover_id, "situation": "Unauthorized edit"},
        )
        self.assertEqual(other_staff_update.status_code, 404)


if __name__ == "__main__":
    unittest.main()
