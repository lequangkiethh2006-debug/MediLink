import unittest
from unittest.mock import patch

from werkzeug.security import generate_password_hash

import app as medilink_app


class TestAuthenticationFlows(unittest.TestCase):
    test_user_id = "auth-flow-test-patient"
    test_password = "auth-flow-test-password"
    test_user = {
        "password_hash": generate_password_hash(test_password),
        "role": "patient",
        "display_name": "Auth Flow Test",
    }

    def test_patient_login_refresh_logout_and_relogin(self):
        medilink_app.app.config["TESTING"] = True
        client = medilink_app.app.test_client()
        with patch.dict(
            medilink_app.DEMO_USERS,
            {self.test_user_id: self.test_user},
        ):
            response = client.post(
                "/login",
                data={
                    "login_type": "patient",
                    "identifier": self.test_user_id,
                    "password": self.test_password,
                },
                follow_redirects=True,
            )
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"nav-account", response.data)
            self.assertIn(b"Account", response.data)
            self.assertIn(b"Logout", response.data)

            with client.session_transaction() as user_session:
                self.assertEqual(user_session.get("user_id"), self.test_user_id)
                self.assertEqual(user_session.get("role"), "patient")
                csrf_token = user_session.get("_csrf_token")
            self.assertTrue(csrf_token)

            refresh_response = client.get("/")
            self.assertEqual(refresh_response.status_code, 200)
            self.assertEqual(
                refresh_response.headers["Cache-Control"],
                "no-store, private",
            )

            profile_response = client.get("/profile", follow_redirects=True)
            self.assertEqual(profile_response.status_code, 200)

            get_logout_response = client.get("/logout")
            self.assertEqual(get_logout_response.status_code, 405)

            invalid_logout_response = client.post(
                "/logout",
                data={"csrf_token": "invalid"},
            )
            self.assertEqual(invalid_logout_response.status_code, 403)
            with client.session_transaction() as user_session:
                self.assertEqual(user_session.get("user_id"), self.test_user_id)

            logout_response = client.post(
                "/logout",
                data={"csrf_token": csrf_token},
            )
            self.assertEqual(logout_response.status_code, 302)
            self.assertTrue(logout_response.headers["Location"].endswith("/login"))
            self.assertEqual(
                logout_response.headers["Cache-Control"],
                "no-store, private",
            )
            with client.session_transaction() as user_session:
                self.assertEqual(dict(user_session), {})

            login_page = client.get("/login")
            self.assertEqual(login_page.status_code, 200)
            self.assertIn(b"login-card", login_page.data)

            relogin_response = client.post(
                "/login",
                data={
                    "login_type": "patient",
                    "identifier": self.test_user_id,
                    "password": self.test_password,
                },
                follow_redirects=True,
            )
            self.assertEqual(relogin_response.status_code, 200)
            with client.session_transaction() as user_session:
                self.assertEqual(user_session.get("user_id"), self.test_user_id)

    def test_hospital_requires_staff_role(self):
        medilink_app.app.config["TESTING"] = True
        client = medilink_app.app.test_client()

        guest_response = client.get("/hospital")
        self.assertEqual(guest_response.status_code, 302)
        self.assertTrue(guest_response.headers["Location"].endswith("/login"))

        with client.session_transaction() as user_session:
            user_session["user_id"] = self.test_user_id
            user_session["role"] = "patient"
        patient_response = client.get("/hospital")
        self.assertEqual(patient_response.status_code, 302)
        self.assertTrue(patient_response.headers["Location"].endswith("/login"))

        with client.session_transaction() as user_session:
            user_session.clear()
            user_session["user_id"] = "auth-flow-test-staff"
            user_session["role"] = "staff"
        staff_response = client.get("/hospital")
        self.assertEqual(staff_response.status_code, 200)

    def test_staff_login_redirects_to_staff_portal(self):
        staff_user_id = "auth-flow-test-staff"
        staff_user = {
            "password_hash": generate_password_hash(self.test_password),
            "role": "staff",
            "display_name": "Auth Flow Staff",
            "staff_role": "treating",
        }

        medilink_app.app.config["TESTING"] = True
        client = medilink_app.app.test_client()
        with patch.dict(medilink_app.DEMO_USERS, {staff_user_id: staff_user}):
            response = client.post(
                "/login",
                data={
                    "login_type": "staff",
                    "identifier": staff_user_id,
                    "password": self.test_password,
                },
                follow_redirects=True,
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.history)
        self.assertTrue(
            response.history[0].headers["Location"].endswith("/hospital")
        )
        with client.session_transaction() as user_session:
            self.assertEqual(user_session.get("user_id"), staff_user_id)
            self.assertEqual(user_session.get("role"), "staff")
            csrf_token = user_session.get("_csrf_token")
        self.assertTrue(csrf_token)

        logout_response = client.post(
            "/logout",
            data={"csrf_token": csrf_token},
        )
        self.assertEqual(logout_response.status_code, 302)
        self.assertTrue(logout_response.headers["Location"].endswith("/login"))
        with client.session_transaction() as user_session:
            self.assertEqual(dict(user_session), {})
        hospital_response = client.get("/hospital")
        self.assertEqual(hospital_response.status_code, 302)
        self.assertTrue(hospital_response.headers["Location"].endswith("/login"))

    def test_blockchain_status_api_remains_available(self):
        medilink_app.app.config["TESTING"] = True
        response = medilink_app.app.test_client().get("/api/blockchain/status")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.is_json)
        self.assertTrue(response.get_json()["success"])


if __name__ == "__main__":
    unittest.main()
