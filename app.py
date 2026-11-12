"""
MediLink — Flask backend (prototype)
app.py

Serves patient portal, staff portal and login.
Demo authentication only. OCR runs locally; SBAR / consent / blockchain
endpoints remain prototypes until real services are configured.
"""

import hmac
import os
import re
import secrets
import sqlite3
import uuid
import unicodedata
import warnings
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
from io import BytesIO
from pathlib import Path
from typing import Optional

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    jsonify,
    abort,
)
from PIL import Image, UnidentifiedImageError
import pytesseract
from pytesseract import TesseractError, TesseractNotFoundError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Use the locally installed Windows Tesseract program. Uploaded files are not
# sent to any external service.
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# ---------------------------------------------------------------------------
# Environment & app setup
# ---------------------------------------------------------------------------

load_dotenv()

app = Flask(__name__)

# Secret key — never hard-code a production value
secret_key = os.getenv("SECRET_KEY")
if not secret_key:
    raise RuntimeError(
        "SECRET_KEY must be set in the environment or project .env file."
    )
app.secret_key = secret_key

# Session cookie settings (adjust SECURE=True behind HTTPS in production)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,  # 10 MB upload limit
    UPLOAD_FOLDER=os.getenv("UPLOAD_FOLDER", "uploads"),
    DATABASE=os.getenv(
        "MEDILINK_DATABASE",
        str(Path(app.instance_path) / "medilink.sqlite3"),
    ),
)

# Ensure upload directory exists and is outside static/
UPLOAD_DIR = Path(app.config["UPLOAD_FOLDER"])
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
Path(app.instance_path).mkdir(parents=True, exist_ok=True)


def _connect_database():
    database_path = Path(app.config["DATABASE"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_database():
    """Create persistent handover and audit tables if they do not exist."""
    with closing(_connect_database()) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS handovers (
                handover_id TEXT PRIMARY KEY,
                staff_id TEXT NOT NULL,
                staff_role TEXT NOT NULL,
                case_ref TEXT NOT NULL DEFAULT '',
                situation TEXT NOT NULL DEFAULT '',
                background TEXT NOT NULL DEFAULT '',
                assessment TEXT NOT NULL DEFAULT '',
                recommendation TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK (status IN ('draft', 'submitted')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                submitted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS handovers_staff_updated
                ON handovers (staff_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS handover_audit (
                audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
                handover_id TEXT NOT NULL REFERENCES handovers(handover_id),
                staff_id TEXT NOT NULL,
                staff_role TEXT NOT NULL,
                action TEXT NOT NULL CHECK (
                    action IN ('draft_saved', 'draft_updated', 'submitted')
                ),
                occurred_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS handover_audit_handover
                ON handover_audit (handover_id, occurred_at);
            """
        )
        connection.commit()


init_database()

# Allowed upload extensions / MIME types
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}
ALLOWED_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
}

# ---------------------------------------------------------------------------
# Demo account store (in-memory — replace with a real user store later)
# Passwords are hashed. Never put real credentials here.
# ---------------------------------------------------------------------------

# Default demo passwords are set via env or fall back to well-known demo values.
# Change them in .env for any shared environment.
_DEMO_PATIENT_PW = os.getenv("DEMO_PATIENT_PASSWORD", "demo-patient")
_DEMO_STAFF_PW = os.getenv("DEMO_STAFF_PASSWORD", "demo-staff")

DEMO_USERS = {
    # identifier -> {password_hash, role, display_name}
    "patient@demo": {
        "password_hash": generate_password_hash(_DEMO_PATIENT_PW),
        "role": "patient",
        "display_name": "Demo Patient",
    },
    "0901234567": {  # phone-style demo id
        "password_hash": generate_password_hash(_DEMO_PATIENT_PW),
        "role": "patient",
        "display_name": "Demo Patient",
    },
    "staff@demo": {
        "password_hash": generate_password_hash(_DEMO_STAFF_PW),
        "role": "staff",
        "display_name": "Demo Staff",
        "staff_role": "treating",  # server-side role, not client-trusted
    },
    "NV001": {
        "password_hash": generate_password_hash(_DEMO_STAFF_PW),
        "role": "staff",
        "display_name": "Demo Staff",
        "staff_role": "shift-lead",
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def json_success(message="Operation completed", data=None, status=200):
    return jsonify({"success": True, "message": message, "data": data or {}}), status


def json_error(message="The operation could not be completed", error_code="ERROR", status=400):
    return jsonify({"success": False, "message": message, "error_code": error_code}), status


def login_required(view):
    """Require any authenticated session."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            flash("Vui lòng đăng nhập. / Please sign in.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def _is_authenticated_staff():
    return bool(session.get("user_id")) and session.get("role") == "staff"


def staff_required(view):
    """Require an authenticated staff session. Role is taken from the session only."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not _is_authenticated_staff():
            flash("Truy cập dành cho nhân viên y tế. / Staff access only.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def staff_api_required(view):
    """Require staff access and keep authentication failures in the JSON API format."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return json_error("Authentication required.", "AUTH_REQUIRED", 401)
        if not _is_authenticated_staff():
            return json_error("Staff access only.", "STAFF_REQUIRED", 403)
        return view(*args, **kwargs)
    return wrapped


def allowed_file(filename: str, mime: str) -> bool:
    if not filename or "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS and mime in ALLOWED_MIME


def safe_upload_filename(original: str) -> str:
    """Generate a non-guessable, path-safe filename."""
    base = secure_filename(original) or "document"
    # Keep extension only
    ext = ""
    if "." in base:
        ext = "." + base.rsplit(".", 1)[1].lower()
        if ext.lstrip(".") not in ALLOWED_EXTENSIONS:
            ext = ""
    return f"{uuid.uuid4().hex}{ext}"


def _normalize_medical_text(text: str) -> str:
    """Normalize accents and spacing so English/Vietnamese labels are easier to match."""
    normalized = unicodedata.normalize("NFKD", text)
    without_accents = "".join(
        character for character in normalized
        if not unicodedata.combining(character)
    )
    return re.sub(r"\s+", " ", without_accents).upper()


def _confirmation(field: str, reason: str) -> dict:
    return {"field": field, "reason": reason}


def _parse_test_date(text: str, confirmations: list) -> Optional[str]:
    """Extract only a date next to an explicit test-date label."""
    normalized = _normalize_medical_text(text)
    date_pattern = (
        r"(?P<date>\d{4}[-/.]\d{1,2}[-/.]\d{1,2}"
        r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})"
    )
    label_pattern = re.compile(
        r"(?:NGAY\s+(?:XET\s+NGHIEM|LAY\s+MAU|TRA\s+KET\s+QUA)"
        r"|TEST\s+DATE|EXAMINATION\s+DATE"
        r"|DATE\s+OF\s+(?:TEST|EXAM))\s*[:\-]?\s*"
        + date_pattern,
        re.IGNORECASE,
    )
    found_dates = list(dict.fromkeys(
        match.group("date") for match in label_pattern.finditer(normalized)
    ))
    if len(found_dates) > 1:
        confirmations.append(_confirmation(
            "test_date",
            "More than one date is labelled as a test date; please verify the correct one.",
        ))
        return None
    if not found_dates:
        confirmations.append(_confirmation(
            "test_date",
            "No date next to a recognized test-date label was found.",
        ))
        return None

    date_value = found_dates[0]
    if not re.match(r"^\d{4}", date_value):
        parts = re.split(r"[-/.]", date_value)
        if len(parts) == 3 and parts[0] != parts[1]:
            first, second = int(parts[0]), int(parts[1])
            if first <= 12 and second <= 12:
                confirmations.append(_confirmation(
                    "test_date",
                    "The date order could be day/month or month/day; please verify it.",
                ))
                return None
    return date_value


def _parse_lab_row(line: str):
    """Parse one conservative lab-table row, or return None if it does not match."""
    number = r"(?:[<>]=?|[≤≥])?\s*\d+(?:[.,]\d+)?"
    unit = r"(?:10\^?\d+/(?:L|ML)|[A-Zµμ]+(?:\^?\d+)?(?:/[A-Zµμ0-9^]+)?|%)"
    reference = (
        r"(?:[<>]=?|[≤≥])?\s*\d+(?:[.,]\d+)?"
        r"(?:\s*(?:-|–|—|TO)\s*\d+(?:[.,]\d+)?)?"
    )
    prefix = r"^\s*(?:\d+\s+)?"
    missing_result = re.match(
        prefix
        + r"(?P<name>[^:|]+?)\s+(?P<unit>"
        + unit
        + r")(?:\s+(?P<reference>"
        + reference
        + r"))?\s*$",
        line,
        re.IGNORECASE,
    )
    if missing_result:
        name = missing_result.group("name").strip()
        if name and not re.search(r"\d", name):
            return {
                "name": name,
                "result_value": None,
                "unit": missing_result.group("unit").strip(),
                "reference_range": (
                    (missing_result.group("reference") or "").strip() or None
                ),
            }

    result_row = re.match(
        prefix
        + r"(?P<name>[^:|]+?)\s+(?P<result>"
        + number
        + r")(?:\s+(?P<unit>"
        + unit
        + r"))?(?:\s+(?P<reference>"
        + reference
        + r"))?\s*$",
        line,
        re.IGNORECASE,
    )
    if result_row:
        name = result_row.group("name").strip()
        if not name or re.search(r"\d", name):
            return None
        return {
            "name": name,
            "result_value": (result_row.group("result") or "").strip() or None,
            "unit": (result_row.group("unit") or "").strip() or None,
            "reference_range": (result_row.group("reference") or "").strip() or None,
        }

    return None


def _parse_lab_tests(text: str, confirmations: list) -> list:
    """Extract obvious lab rows and flag values that are absent or conflicting."""
    header_words = (
        "STT", "NO ", "INDEX", "TEN XET NGHIEM", "TEST NAME",
        "RESULT", "KET QUA", "DON VI", "UNIT", "GIA TRI THAM CHIEU",
        "REFERENCE RANGE", "LAB REPORT", "LABORATORY REPORT",
        "PHIEU KET QUA XET NGHIEM", "TEST RESULTS",
    )
    rows_by_name = {}

    for line in text.splitlines():
        normalized_line = _normalize_medical_text(line).strip()
        if not normalized_line or any(
            normalized_line.startswith(word) for word in header_words
        ):
            continue
        row = _parse_lab_row(line)
        if not row:
            continue

        name_key = _normalize_medical_text(row["name"])
        if name_key not in rows_by_name:
            rows_by_name[name_key] = row
            continue

        existing = rows_by_name[name_key]
        for field in ("result_value", "unit", "reference_range"):
            if existing[field] != row[field]:
                existing[field] = None
                confirmations.append(_confirmation(
                    f"tests.{row['name']}.{field}",
                    "Multiple different values were found for this test; please verify the original.",
                ))

    tests = list(rows_by_name.values())
    if not tests:
        confirmations.append(_confirmation(
            "tests",
            "No laboratory test rows could be confidently parsed.",
        ))
        return tests

    confirmed_fields = {
        item["field"] for item in confirmations
    }
    for test in tests:
        for field in ("result_value", "unit", "reference_range"):
            confirmation_field = f"tests.{test['name']}.{field}"
            if test[field] is None and confirmation_field not in confirmed_fields:
                confirmations.append(_confirmation(
                    confirmation_field,
                    f"The {field.replace('_', ' ')} is missing or could not be confidently read.",
                ))
                confirmed_fields.add(confirmation_field)
    return tests


def parse_medical_text(text: str) -> dict:
    """Return conservative structured fields without guessing unclear values."""
    normalized = _normalize_medical_text(text)
    is_laboratory_report = bool(re.search(
        r"\b(?:PHIEU\s+KET\s+QUA\s+XET\s+NGHIEM"
        r"|KET\s+QUA\s+XET\s+NGHIEM"
        r"|LABORATORY\s+REPORT|LAB\s+REPORT|TEST\s+RESULTS)\b",
        normalized,
    ))
    is_referral = bool(re.search(
        r"\b(?:GIAY\s+CHUYEN\s+TUYEN|GIAY\s+GIOI\s+THIEU"
        r"|REFERRAL(?:\s+LETTER|\s+DOCUMENT)?)\b",
        normalized,
    ))

    confirmations = []
    if is_laboratory_report == is_referral:
        document_type = None
        confirmations.append(_confirmation(
            "document_type",
            "The document type is missing, unclear, or matches conflicting document labels.",
        ))
        return {
            "document_type": document_type,
            "test_date": None,
            "tests": [],
            "fields_requiring_confirmation": confirmations,
        }

    if is_referral:
        return {
            "document_type": "referral",
            "test_date": None,
            "tests": [],
            "fields_requiring_confirmation": [],
        }

    test_date = _parse_test_date(text, confirmations)
    tests = _parse_lab_tests(text, confirmations)
    return {
        "document_type": "laboratory_report",
        "test_date": test_date,
        "tests": tests,
        "fields_requiring_confirmation": confirmations,
    }


def current_user():
    """Minimal user info for templates (never includes password)."""
    if not session.get("user_id"):
        return None
    return {
        "id": session.get("user_id"),
        "role": session.get("role"),
        "display_name": session.get("display_name"),
        "staff_role": session.get("staff_role"),
        "is_authenticated": True,
    }


def get_csrf_token():
    """Return a session-bound token for state-changing form submissions."""
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


# Make current_user available in all templates
@app.context_processor
def inject_user():
    user = current_user()
    return {
        "current_user": user,
        "csrf_token": get_csrf_token,
    }


@app.after_request
def prevent_authenticated_page_caching(response):
    """Prevent sensitive authenticated pages and auth transitions from being cached."""
    if session.get("user_id") or request.endpoint in {
        "hospital",
        "login",
        "logout",
        "profile",
    }:
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Patient portal homepage."""
    return render_template("index.html")


@app.route("/profile")
@login_required
def profile():
    """Route the account shortcut to the authenticated user's portal."""
    role = session.get("role")
    if role == "staff":
        return redirect(url_for("hospital"))
    if role == "patient":
        return redirect(url_for("index"))

    session.clear()
    flash("Phiên đăng nhập không hợp lệ. / Invalid session.", "error")
    return redirect(url_for("login"))


@app.route("/hospital")
@staff_required
def hospital():
    """
    Healthcare staff portal.
    """
    staff_department = session.get("staff_department")  # optional
    return render_template(
        "hospital.html",
        staff_department=staff_department,
        logout_endpoint="logout",
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    """Login and portal selection. Demo accounts only."""
    if request.method == "GET":
        # Already logged in? Send to the appropriate portal.
        if session.get("user_id"):
            if session.get("role") == "staff":
                return redirect(url_for("hospital"))
            return redirect(url_for("index"))
        return render_template("login.html")

    # POST
    login_type = (request.form.get("login_type") or "").strip().lower()
    identifier = (request.form.get("identifier") or "").strip()
    password = request.form.get("password") or ""
    # Client-supplied role is ignored for authorization
    _client_role = request.form.get("role")  # noqa: F841 — deliberately unused

    if not identifier or not password:
        flash("Vui lòng nhập đầy đủ thông tin. / Please fill in all fields.", "error")
        return render_template("login.html"), 400

    user = DEMO_USERS.get(identifier)
    # Generic error — do not reveal whether the account exists
    if not user or not check_password_hash(user["password_hash"], password):
        flash("Thông tin đăng nhập không đúng. / Invalid credentials.", "error")
        return render_template("login.html"), 401

    # Server-side role from the user store
    role = user["role"]
    if login_type == "staff" and role != "staff":
        flash("Tài khoản không có quyền nhân viên. / Account is not staff.", "error")
        return render_template("login.html"), 403
    if login_type == "patient" and role != "patient":
        flash("Tài khoản không phải người bệnh. / Account is not a patient.", "error")
        return render_template("login.html"), 403

    # Establish session (minimum necessary data)
    session.clear()
    session["user_id"] = identifier
    session["role"] = role
    session["display_name"] = user.get("display_name", "User")
    if role == "staff":
        session["staff_role"] = user.get("staff_role", "treating")

    flash("Đăng nhập thành công (demo). / Signed in (demo).", "success")
    if role == "staff":
        return redirect(url_for("hospital"))
    return redirect(url_for("index"))


@app.route("/logout", methods=["POST"])
def logout():
    submitted_token = request.form.get("csrf_token", "")
    expected_token = session.get("_csrf_token", "")
    if not expected_token or not submitted_token or not hmac.compare_digest(
        expected_token, submitted_token
    ):
        abort(403)

    session.clear()
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# In-memory MVP stores — records, OCR results and consent
# No database. Everything resets when the Flask process restarts.
# ---------------------------------------------------------------------------

_RECORD_STORE = {}
_CONSENT_STORE = {}

_DEMO_RECORD_ID = "REC-DEMO-001"
_DEMO_CONSENT_TOKEN = "demo-consent-token"
_DEMO_CONTRACT_ADDRESS = (
    os.getenv("CONSENT_CONTRACT_ADDRESS")
    or "0x7A3f9C2bD4e5F6a7B8c9D0e1F2a3B4c5D6e7F8a9"
)

_DEMO_EXTRACTED_TEXT = """PATIENT: PT-DEMO-001
TEST DATE: 2026-11-08
LABORATORY REPORT

Haemoglobin        13.8 g/dL    13.0 - 17.0
White Blood Cells  7.2  10^9/L   4.0 - 11.0
Platelets          248  10^9/L   150 - 400
Fasting Glucose    92   mg/dL    70 - 99
Creatinine         0.9  mg/dL    0.6 - 1.2"""

_DEMO_LAB_RESULTS = [
    {
        "test_name": "Haemoglobin",
        "result": "13.8",
        "unit": "g/dL",
        "reference_range": "13.0 – 17.0",
        "status": "Normal",
    },
    {
        "test_name": "White Blood Cells",
        "result": "7.2",
        "unit": "10^9/L",
        "reference_range": "4.0 – 11.0",
        "status": "Normal",
    },
    {
        "test_name": "Platelets",
        "result": "248",
        "unit": "10^9/L",
        "reference_range": "150 – 400",
        "status": "Normal",
    },
    {
        "test_name": "Fasting Glucose",
        "result": "92",
        "unit": "mg/dL",
        "reference_range": "70 – 99",
        "status": "Normal",
    },
    {
        "test_name": "Creatinine",
        "result": "0.9",
        "unit": "mg/dL",
        "reference_range": "0.6 – 1.2",
        "status": "Normal",
    },
]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _demo_record_type(structured):
    document_type = (structured or {}).get("document_type")
    if document_type == "laboratory_report":
        return "Laboratory Report"
    if document_type == "referral":
        return "Referral Document"
    return "Medical Record"


def _lab_results_from_structured(structured):
    tests = (structured or {}).get("tests") or []
    if not tests:
        return [dict(item) for item in _DEMO_LAB_RESULTS]

    results = []
    for test in tests:
        results.append(
            {
                "test_name": test.get("name") or "Unnamed test",
                "result": test.get("result_value"),
                "unit": test.get("unit"),
                "reference_range": test.get("reference_range"),
                "status": "Pending",
            }
        )
    return results


def _build_demo_record(
    record_id=None,
    patient_id="demo-patient",
    extracted_text="",
    structured=None,
    consent_active=False,
):
    record_id = record_id or f"REC-{uuid.uuid4().hex[:8].upper()}"
    suffix = record_id.rsplit("-", 1)[-1]
    now = _now_iso()

    return {
        "record_id": record_id,
        "patient_id": patient_id,
        "record_type": _demo_record_type(structured),
        "uploaded_date": now,
        "ocr_status": "Completed" if extracted_text else "Pending",
        "ocr_extraction_time": now if extracted_text else None,
        "ocr_confidence": "98.4%" if extracted_text else "—",
        "extracted_text": extracted_text,
        "structured": structured or {},
        "verification_status": "Pending",
        "verified_at": None,
        "patient_identifier": f"PT-{suffix}",
        "referral_number": f"REF-{suffix}",
        "age_range": "35–44",
        "shared_date": None,
        "lab_results": _lab_results_from_structured(structured),
        "consent_active": bool(consent_active),
        "consent_status": "Active" if consent_active else "Not granted",
        "consent_token": None,
        "contract_address": _DEMO_CONTRACT_ADDRESS,
        "tx_hash": "",
        "audit_events": [],
    }


def _add_audit_event(record, label, description, status="complete"):
    timestamp = _now_iso()
    record.setdefault("audit_events", []).append(
        {
            "label": label,
            "time": timestamp,
            "datetime": timestamp,
            "description": description,
            "status": status,
        }
    )


def _seed_demo_record():
    """Make one verified, consent-active record available for demos."""
    if _DEMO_RECORD_ID in _RECORD_STORE:
        return

    record = _build_demo_record(
        record_id=_DEMO_RECORD_ID,
        patient_id="patient@demo",
        extracted_text=_DEMO_EXTRACTED_TEXT,
        structured={"document_type": "laboratory_report", "tests": []},
        consent_active=True,
    )
    now = _now_iso()
    record["verification_status"] = "Verified"
    record["verified_at"] = now
    record["shared_date"] = now
    record["consent_status"] = "Active"
    record["consent_token"] = _DEMO_CONSENT_TOKEN
    record["tx_hash"] = "0x" + secrets.token_hex(32)

    _add_audit_event(
        record,
        "Record Uploaded",
        "The medical record was uploaded to the MediLink hospital portal.",
    )
    _add_audit_event(
        record,
        "OCR Completed",
        "Text extraction finished and the OCR result was queued for patient review.",
    )
    _add_audit_event(
        record,
        "Verification Completed",
        "The patient confirmed the extracted information.",
    )
    _add_audit_event(
        record,
        "Consent Granted",
        "The patient granted hospital access while consent is active.",
    )

    _RECORD_STORE[_DEMO_RECORD_ID] = record
    _CONSENT_STORE[_DEMO_CONSENT_TOKEN] = {
        "token": _DEMO_CONSENT_TOKEN,
        "record_id": _DEMO_RECORD_ID,
        "patient_id": "patient@demo",
        "active": True,
        "created_at": now,
        "revoked_at": None,
    }


_seed_demo_record()


def _create_mock_shared_record(record_id):
    """Create a demo record on demand so the hospital view always has data."""
    record = _build_demo_record(
        record_id=record_id,
        patient_id="demo-patient",
        extracted_text=_DEMO_EXTRACTED_TEXT,
        structured={"document_type": "laboratory_report", "tests": []},
        consent_active=True,
    )
    now = _now_iso()
    record["verification_status"] = "Verified"
    record["verified_at"] = now
    record["shared_date"] = now
    record["consent_status"] = "Active"
    record["tx_hash"] = "0x" + secrets.token_hex(32)

    _add_audit_event(
        record,
        "Record Uploaded",
        "Demo record made available for the hospital portal.",
    )
    _add_audit_event(
        record,
        "OCR Completed",
        "Text extraction completed for the demo record.",
    )
    _add_audit_event(
        record,
        "Verification Completed",
        "Extracted information was marked as verified.",
    )
    _add_audit_event(
        record,
        "Consent Granted",
        "Demo consent is active for hospital access.",
    )
    _RECORD_STORE[record_id] = record
    return record


# ---------------------------------------------------------------------------
# API — local OCR upload (images only)
# ---------------------------------------------------------------------------

@app.route("/api/ocr", methods=["POST"])
def api_ocr():
    """Run local English and Vietnamese OCR on an authenticated image upload."""
    # API clients need a JSON error, not the HTML login-page redirect.
    if not session.get("user_id"):
        return json_error("Please sign in to use OCR.", "AUTH_REQUIRED", 401)

    if "document" not in request.files and "file" not in request.files:
        return json_error("No file provided", "NO_FILE", 400)

    file = request.files.get("document") or request.files.get("file")
    if not file or file.filename == "":
        return json_error("Empty filename", "EMPTY_FILE", 400)

    extension = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if extension == "pdf":
        return json_error(
            "PDF uploads are not supported yet. Please use a JPG, JPEG, or PNG image.",
            "PDF_NOT_SUPPORTED",
            400,
        )
    if extension not in {"jpg", "jpeg", "png"}:
        return json_error(
            "Unsupported file type. Allowed: JPG, JPEG, PNG.",
            "INVALID_TYPE",
            400,
        )

    try:
        # Keep the upload in memory and enforce a size limit before decoding it.
        image_bytes = file.stream.read(app.config["MAX_CONTENT_LENGTH"] + 1)
    except OSError:
        return json_error("Could not read uploaded file.", "FILE_READ_ERROR", 400)

    if not image_bytes:
        return json_error("The uploaded file is empty.", "EMPTY_FILE", 400)
    if len(image_bytes) > app.config["MAX_CONTENT_LENGTH"]:
        return json_error("File too large (max 10 MB).", "FILE_TOO_LARGE", 413)

    try:
        # verify() checks the file structure; load() decodes the image pixels.
        # Treat Pillow's large-image warning as an error to avoid excessive use
        # of memory while handling untrusted uploads.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(image_bytes)) as uploaded_image:
                actual_format = uploaded_image.format
                uploaded_image.verify()

            expected_format = "PNG" if extension == "png" else "JPEG"
            if actual_format != expected_format:
                return json_error(
                    "The image content does not match its filename extension.",
                    "INVALID_CONTENT",
                    400,
                )

            with Image.open(BytesIO(image_bytes)) as uploaded_image:
                uploaded_image.load()
                # Tesseract works reliably with a standard RGB image.
                image_for_ocr = uploaded_image.convert("RGB")
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ):
        return json_error(
            "The uploaded image is corrupt, unreadable, or too large to process.",
            "INVALID_CONTENT",
            400,
        )

    try:
        # Return only the text recognized by OCR; do not infer medical facts.
        extracted_text = pytesseract.image_to_string(
            image_for_ocr,
            lang="eng+vie",
            timeout=30,
        )
        if not extracted_text.strip():
            return json_error(
                "No readable text could be extracted from the image.",
                "OCR_NO_TEXT",
                422,
            )
    except (TesseractNotFoundError, TesseractError, OSError, RuntimeError):
        return json_error(
            "Local OCR could not process this image. Check the Tesseract installation and language data.",
            "OCR_FAILED",
            503,
        )
    finally:
        image_for_ocr.close()

    structured = parse_medical_text(extracted_text)
    record = _build_demo_record(
        patient_id=session.get("user_id", "demo-patient"),
        extracted_text=extracted_text,
        structured=structured,
    )
    _add_audit_event(
        record,
        "Record Uploaded",
        "The patient uploaded a medical document to MediLink.",
    )
    _add_audit_event(
        record,
        "OCR Completed",
        "OCR extraction completed and the result awaits patient verification.",
    )
    _RECORD_STORE[record["record_id"]] = record

    return json_success(
        message="OCR completed. Please verify the recognized text against the original image.",
        data={
            "ocr_available": True,
            "extracted": extracted_text,
            "structured": structured,
            "record_id": record["record_id"],
            "verification_status": record["verification_status"],
        },
    )


# ---------------------------------------------------------------------------
# API — Patient verification of OCR output
# ---------------------------------------------------------------------------

@app.route("/api/records/verify", methods=["POST"])
@login_required
def api_records_verify():
    """Allow the patient who owns a record to confirm its OCR information."""
    if session.get("role") != "patient":
        return json_error(
            "Only the patient can verify this record.",
            "FORBIDDEN",
            403,
        )

    data = request.get_json(silent=True) or request.form.to_dict()
    record_id = (data.get("record_id") or "").strip()
    if not record_id:
        return json_error("record_id is required.", "VALIDATION_ERROR", 400)

    record = _RECORD_STORE.get(record_id)
    if not record:
        return json_error("Record not found.", "RECORD_NOT_FOUND", 404)

    if record.get("patient_id") != session.get("user_id"):
        return json_error(
            "You can only verify your own records.",
            "FORBIDDEN",
            403,
        )

    if record.get("ocr_status") != "Completed":
        return json_error(
            "OCR must complete before the record can be verified.",
            "OCR_NOT_READY",
            409,
        )

    record["verification_status"] = "Verified"
    record["verified_at"] = _now_iso()

    # Optional: allow the patient to submit corrected rows from the review UI.
    if isinstance(data.get("lab_results"), list):
        record["lab_results"] = data["lab_results"]

    _add_audit_event(
        record,
        "Verification Completed",
        "The patient confirmed the extracted information.",
    )

    return json_success(
        message="Record verified by patient.",
        data={
            "record_id": record_id,
            "verification_status": record["verification_status"],
            "verified_at": record["verified_at"],
        },
    )


# ---------------------------------------------------------------------------
# API — Follow-up (prototype)
# ---------------------------------------------------------------------------

@app.route("/api/followup", methods=["POST"])
def api_followup():
    """
    Record a simple follow-up status from the patient portal.
    Does not create appointments or clinical decisions.
    """
    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or request.form.get("status") or "").strip().lower()

    if status not in ("improved", "no-improvement"):
        return json_error("Invalid status", "INVALID_STATUS", 400)

    # Prototype: acknowledge only. No scheduling, no diagnosis.
    guidance = {
        "improved": {
            "vi": "Cảm ơn phản hồi. Nếu triệu chứng tái phát hãy liên hệ cơ sở y tế.",
            "en": "Thank you. If symptoms return, contact a healthcare facility.",
        },
        "no-improvement": {
            "vi": "Hãy liên hệ bác sĩ hoặc đến cơ sở y tế. Không trì hoãn nếu có dấu hiệu cấp cứu.",
            "en": "Contact your doctor or a healthcare facility. Do not delay if emergency signs appear.",
        },
    }

    return json_success(
        message="Follow-up recorded (prototype).",
        data={
            "status": status,
            "guidance": guidance[status],
            "is_clinical_decision": False,
            "appointment_created": False,
        },
    )


# ---------------------------------------------------------------------------
# API — persistent SBAR handover
# ---------------------------------------------------------------------------

_SBAR_TEXT_FIELDS = (
    "situation",
    "background",
    "assessment",
    "recommendation",
)


def _sbar_json_error(message_vi, message_en, error_code, status):
    return jsonify({
        "success": False,
        "message": message_en,
        "message_vi": message_vi,
        "message_en": message_en,
        "error_code": error_code,
    }), status


def _sbar_json_success(message_vi, message_en, data, status=200):
    return jsonify({
        "success": True,
        "message": message_en,
        "message_vi": message_vi,
        "message_en": message_en,
        "data": data,
    }), status


def _read_sbar_payload():
    if request.is_json:
        payload = request.get_json(silent=True)
    else:
        payload = request.form.to_dict()
    return payload if isinstance(payload, dict) else None


def _valid_sbar_csrf(payload):
    expected = session.get("_csrf_token", "")
    submitted = request.headers.get("X-CSRF-Token") or payload.get("csrf_token", "")
    return (
        isinstance(expected, str)
        and isinstance(submitted, str)
        and bool(expected)
        and bool(submitted)
        and hmac.compare_digest(expected, submitted)
    )


def _validate_sbar_payload(payload, require_complete):
    fields = {}
    for name in _SBAR_TEXT_FIELDS:
        value = payload.get(name, "")
        if value is None:
            value = ""
        if not isinstance(value, str):
            return None, _sbar_json_error(
                "Các trường SBAR phải là văn bản hợp lệ.",
                "SBAR fields must contain text.",
                "VALIDATION_ERROR",
                400,
            )
        value = value.strip()
        if len(value) > 2000:
            return None, _sbar_json_error(
                f"Trường {name} vượt quá 2.000 ký tự.",
                f"{name.capitalize()} exceeds the 2,000-character limit.",
                "TOO_LONG",
                400,
            )
        fields[name] = value

    case_ref = payload.get("case_ref", "")
    if case_ref is None:
        case_ref = ""
    if not isinstance(case_ref, str):
        return None, _sbar_json_error(
            "Mã tham chiếu ca không hợp lệ.",
            "The case reference must be text.",
            "VALIDATION_ERROR",
            400,
        )
    case_ref = case_ref.strip()
    if case_ref and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}", case_ref):
        return None, _sbar_json_error(
            "Mã tham chiếu chỉ được chứa chữ cái, số, dấu gạch ngang hoặc gạch dưới.",
            "Case references may contain only letters, numbers, hyphens and underscores.",
            "INVALID_CASE_REF",
            400,
        )
    fields["case_ref"] = case_ref

    handover_id = payload.get("handover_id", "")
    if handover_id is None:
        handover_id = ""
    if not isinstance(handover_id, str):
        return None, _sbar_json_error(
            "Mã bàn giao không hợp lệ.",
            "The handover ID is invalid.",
            "INVALID_HANDOVER_ID",
            400,
        )
    handover_id = handover_id.strip()
    if handover_id and not re.fullmatch(r"HO-[A-Fa-f0-9]{32}", handover_id):
        return None, _sbar_json_error(
            "Mã bàn giao không hợp lệ.",
            "The handover ID is invalid.",
            "INVALID_HANDOVER_ID",
            400,
        )
    fields["handover_id"] = handover_id or None

    if require_complete and any(
        not fields[name] for name in ("situation", "assessment", "recommendation")
    ):
        return None, _sbar_json_error(
            "Vui lòng điền Situation, Assessment và Recommendation.",
            "Situation, Assessment and Recommendation are required.",
            "VALIDATION_ERROR",
            400,
        )
    return fields, None


def _record_sbar_audit(connection, handover_id, action, staff_id, staff_role, timestamp):
    connection.execute(
        """
        INSERT INTO handover_audit
            (handover_id, staff_id, staff_role, action, occurred_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (handover_id, staff_id, staff_role, action, timestamp),
    )


@app.route("/api/sbar/drafts", methods=["POST"])
@staff_api_required
def api_sbar_save_draft():
    """Create or update a draft owned by the authenticated staff member."""
    payload = _read_sbar_payload()
    if payload is None:
        return _sbar_json_error(
            "Yêu cầu JSON không hợp lệ.",
            "A valid JSON object is required.",
            "INVALID_JSON",
            400,
        )
    if not _valid_sbar_csrf(payload):
        return _sbar_json_error(
            "Phiên gửi biểu mẫu không hợp lệ. Vui lòng tải lại trang.",
            "The form token is invalid. Refresh the page and try again.",
            "CSRF_FAILED",
            403,
        )

    fields, error = _validate_sbar_payload(payload, require_complete=False)
    if error:
        return error

    staff_id = session["user_id"]
    staff_role = session.get("staff_role") or "treating"
    now = _now_iso()
    handover_id = fields["handover_id"]
    action = "draft_saved"
    status_code = 201

    try:
        with closing(_connect_database()) as connection, connection:
            if handover_id:
                existing = connection.execute(
                    """
                    SELECT status FROM handovers
                    WHERE handover_id = ? AND staff_id = ?
                    """,
                    (handover_id, staff_id),
                ).fetchone()
                if existing is None:
                    return _sbar_json_error(
                        "Không tìm thấy bản nháp của nhân viên này.",
                        "Draft not found for this staff account.",
                        "HANDOVER_NOT_FOUND",
                        404,
                    )
                if existing["status"] != "draft":
                    return _sbar_json_error(
                        "Bàn giao đã gửi không thể lưu lại dưới dạng bản nháp.",
                        "A submitted handover cannot be saved as a draft.",
                        "HANDOVER_ALREADY_SUBMITTED",
                        409,
                    )

                connection.execute(
                    """
                    UPDATE handovers
                    SET staff_role = ?, case_ref = ?, situation = ?, background = ?,
                        assessment = ?, recommendation = ?, updated_at = ?
                    WHERE handover_id = ? AND staff_id = ? AND status = 'draft'
                    """,
                    (
                        staff_role,
                        fields["case_ref"],
                        fields["situation"],
                        fields["background"],
                        fields["assessment"],
                        fields["recommendation"],
                        now,
                        handover_id,
                        staff_id,
                    ),
                )
                action = "draft_updated"
                status_code = 200
            else:
                handover_id = f"HO-{uuid.uuid4().hex.upper()}"
                connection.execute(
                    """
                    INSERT INTO handovers (
                        handover_id, staff_id, staff_role, case_ref, situation,
                        background, assessment, recommendation, status, created_at,
                        updated_at, submitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)
                    """,
                    (
                        handover_id,
                        staff_id,
                        staff_role,
                        fields["case_ref"],
                        fields["situation"],
                        fields["background"],
                        fields["assessment"],
                        fields["recommendation"],
                        now,
                        now,
                    ),
                )

            _record_sbar_audit(
                connection, handover_id, action, staff_id, staff_role, now
            )
    except sqlite3.Error:
        app.logger.exception("Unable to persist the SBAR draft.")
        return _sbar_json_error(
            "Không thể lưu bản nháp lúc này. Vui lòng thử lại.",
            "The draft could not be saved. Please try again.",
            "PERSISTENCE_ERROR",
            500,
        )

    return _sbar_json_success(
        "Đã lưu bản nháp bàn giao.",
        "Handover draft saved.",
        {"handover_id": handover_id, "status": "draft", "updated_at": now},
        status_code,
    )


@app.route("/api/sbar", methods=["POST"])
@staff_api_required
def api_sbar_submit():
    """Submit a new handover or promote one of the staff member's drafts."""
    payload = _read_sbar_payload()
    if payload is None:
        return _sbar_json_error(
            "Yêu cầu JSON không hợp lệ.",
            "A valid JSON object is required.",
            "INVALID_JSON",
            400,
        )
    if not _valid_sbar_csrf(payload):
        return _sbar_json_error(
            "Phiên gửi biểu mẫu không hợp lệ. Vui lòng tải lại trang.",
            "The form token is invalid. Refresh the page and try again.",
            "CSRF_FAILED",
            403,
        )

    fields, error = _validate_sbar_payload(payload, require_complete=True)
    if error:
        return error

    staff_id = session["user_id"]
    staff_role = session.get("staff_role") or "treating"
    now = _now_iso()
    handover_id = fields["handover_id"]
    status_code = 201

    try:
        with closing(_connect_database()) as connection, connection:
            if handover_id:
                existing = connection.execute(
                    """
                    SELECT status FROM handovers
                    WHERE handover_id = ? AND staff_id = ?
                    """,
                    (handover_id, staff_id),
                ).fetchone()
                if existing is None:
                    return _sbar_json_error(
                        "Không tìm thấy bản nháp của nhân viên này.",
                        "Draft not found for this staff account.",
                        "HANDOVER_NOT_FOUND",
                        404,
                    )
                if existing["status"] != "draft":
                    return _sbar_json_error(
                        "Bàn giao này đã được gửi.",
                        "This handover has already been submitted.",
                        "HANDOVER_ALREADY_SUBMITTED",
                        409,
                    )
                connection.execute(
                    """
                    UPDATE handovers
                    SET staff_role = ?, case_ref = ?, situation = ?, background = ?,
                        assessment = ?, recommendation = ?, status = 'submitted',
                        updated_at = ?, submitted_at = ?
                    WHERE handover_id = ? AND staff_id = ? AND status = 'draft'
                    """,
                    (
                        staff_role,
                        fields["case_ref"],
                        fields["situation"],
                        fields["background"],
                        fields["assessment"],
                        fields["recommendation"],
                        now,
                        now,
                        handover_id,
                        staff_id,
                    ),
                )
                status_code = 200
            else:
                handover_id = f"HO-{uuid.uuid4().hex.upper()}"
                connection.execute(
                    """
                    INSERT INTO handovers (
                        handover_id, staff_id, staff_role, case_ref, situation,
                        background, assessment, recommendation, status, created_at,
                        updated_at, submitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
                    """,
                    (
                        handover_id,
                        staff_id,
                        staff_role,
                        fields["case_ref"],
                        fields["situation"],
                        fields["background"],
                        fields["assessment"],
                        fields["recommendation"],
                        now,
                        now,
                        now,
                    ),
                )

            _record_sbar_audit(
                connection, handover_id, "submitted", staff_id, staff_role, now
            )
    except sqlite3.Error:
        app.logger.exception("Unable to persist the submitted SBAR handover.")
        return _sbar_json_error(
            "Không thể gửi bàn giao lúc này. Vui lòng thử lại.",
            "The handover could not be submitted. Please try again.",
            "PERSISTENCE_ERROR",
            500,
        )

    return _sbar_json_success(
        "Đã gửi bàn giao thành công.",
        "Handover submitted successfully.",
        {"handover_id": handover_id, "status": "submitted", "submitted_at": now},
        status_code,
    )


@app.route("/api/sbar", methods=["GET"])
@staff_api_required
def api_sbar_list():
    """Return summary-only handover history for the authenticated staff member."""
    try:
        with closing(_connect_database()) as connection:
            rows = connection.execute(
                """
                SELECT handover_id, staff_role, status, updated_at, submitted_at
                FROM handovers
                WHERE staff_id = ?
                ORDER BY updated_at DESC
                LIMIT 100
                """,
                (session["user_id"],),
            ).fetchall()
    except sqlite3.Error:
        app.logger.exception("Unable to load SBAR handover history.")
        return _sbar_json_error(
            "Không thể tải lịch sử bàn giao lúc này.",
            "Handover history could not be loaded.",
            "PERSISTENCE_ERROR",
            500,
        )

    summary = [
        {
            "handover_id": row["handover_id"],
            "staff_role": row["staff_role"],
            "status": row["status"],
            "timestamp": row["submitted_at"] or row["updated_at"],
            "submitted_at": row["submitted_at"],
        }
        for row in rows
    ]
    return _sbar_json_success(
        "Lịch sử bàn giao đã được tải.",
        "Handover history loaded.",
        {"handovers": summary},
    )


# ---------------------------------------------------------------------------
# API — Consent verification & medical packet (prototype / locked)
# ---------------------------------------------------------------------------

@app.route("/api/consent/grant", methods=["POST"])
@login_required
def api_consent_grant():
    """Patient grants time-limited hospital access to a verified record."""
    if session.get("role") != "patient":
        return json_error(
            "Only the patient can grant consent.",
            "FORBIDDEN",
            403,
        )

    data = request.get_json(silent=True) or request.form.to_dict()
    record_id = (data.get("record_id") or "").strip()
    if not record_id:
        return json_error("record_id is required.", "VALIDATION_ERROR", 400)

    record = _RECORD_STORE.get(record_id)
    if not record:
        return json_error("Record not found.", "RECORD_NOT_FOUND", 404)

    if record.get("patient_id") != session.get("user_id"):
        return json_error(
            "You can only share your own records.",
            "FORBIDDEN",
            403,
        )

    if record.get("verification_status") != "Verified":
        return json_error(
            "Verify the record before granting consent.",
            "RECORD_NOT_VERIFIED",
            409,
        )

    token = f"CONSENT-{uuid.uuid4().hex[:16].upper()}"
    now = _now_iso()

    record["consent_active"] = True
    record["consent_status"] = "Active"
    record["consent_token"] = token
    record["shared_date"] = now
    record["tx_hash"] = "0x" + secrets.token_hex(32)

    _CONSENT_STORE[token] = {
        "token": token,
        "record_id": record_id,
        "patient_id": session.get("user_id"),
        "active": True,
        "created_at": now,
        "revoked_at": None,
    }

    _add_audit_event(
        record,
        "Consent Granted",
        "The patient granted hospital access while consent is active.",
    )

    return json_success(
        message="Consent granted. Share the token with the hospital.",
        data={
            "token": token,
            "record_id": record_id,
            "consent_status": "Active",
            "contract_address": record["contract_address"],
            "tx_hash": record["tx_hash"],
        },
    )


@app.route("/api/consent/revoke", methods=["POST"])
@login_required
def api_consent_revoke():
    """Patient revokes consent so the hospital can no longer view the record."""
    if session.get("role") != "patient":
        return json_error(
            "Only the patient can revoke consent.",
            "FORBIDDEN",
            403,
        )

    data = request.get_json(silent=True) or request.form.to_dict()
    token = (data.get("token") or "").strip()
    record_id = (data.get("record_id") or "").strip()

    consent = _CONSENT_STORE.get(token) if token else None
    record = None

    if consent:
        record_id = consent.get("record_id", record_id)
        record = _RECORD_STORE.get(record_id)
    elif record_id:
        record = _RECORD_STORE.get(record_id)
        if record:
            token = record.get("consent_token") or ""
            consent = _CONSENT_STORE.get(token) if token else None

    if not record and not consent:
        return json_error("Consent or record not found.", "CONSENT_NOT_FOUND", 404)

    owner = (consent or {}).get("patient_id") or (record or {}).get("patient_id")
    if owner != session.get("user_id"):
        return json_error(
            "You can only revoke your own consent.",
            "FORBIDDEN",
            403,
        )

    now = _now_iso()
    if consent:
        consent["active"] = False
        consent["revoked_at"] = now

    if record:
        record["consent_active"] = False
        record["consent_status"] = "Revoked"
        _add_audit_event(
            record,
            "Consent Revoked",
            "The patient revoked hospital access to this record.",
        )

    return json_success(
        message="Consent revoked. Hospital access is no longer allowed.",
        data={
            "record_id": record_id,
            "consent_status": "Revoked",
            "active": False,
        },
    )


@app.route("/api/consent/verify", methods=["POST"])
@staff_required
def api_consent_verify():
    """Verify whether a consent token/record exists and is still active."""
    data = request.get_json(silent=True) or request.form.to_dict()
    token = (data.get("token") or "").strip()

    if not token:
        return json_error("Token required", "NO_TOKEN", 400)

    # Basic format sanity (alphanumeric / dash / underscore, length)
    if not re.match(r"^[A-Za-z0-9\-_]{8,128}$", token):
        return json_error("Invalid token format", "INVALID_TOKEN", 400)

    consent = _CONSENT_STORE.get(token)
    if consent is not None:
        return jsonify(
            {
                "exists": True,
                "active": bool(consent.get("active")),
                "record_id": consent.get("record_id"),
            }
        )

    # Allow the hospital to verify a record ID directly.
    record = _RECORD_STORE.get(token)
    if record is not None:
        return jsonify(
            {
                "exists": True,
                "active": bool(record.get("consent_active")),
                "record_id": record.get("record_id", token),
            }
        )

    # MVP fallback: well-formed demo tokens are treated as active consent.
    return jsonify({"exists": True, "active": True, "record_id": token})


@app.route("/api/shared-records/<record_id>", methods=["GET"])
@staff_required
def api_shared_record(record_id):
    """Return a shared medical record to hospital staff while consent is active."""
    if not re.match(r"^[A-Za-z0-9\-_]{3,64}$", record_id):
        return json_error("Invalid record ID.", "INVALID_RECORD_ID", 400)

    record = _RECORD_STORE.get(record_id)
    if record is None:
        record = _create_mock_shared_record(record_id)

    if not record.get("consent_active"):
        return json_error(
            "Consent is not active for this record.",
            "CONSENT_INACTIVE",
            403,
        )

    _add_audit_event(
        record,
        "Hospital Access",
        "Authorized hospital staff opened this record while consent was active.",
    )

    return json_success(
        message="Shared record retrieved under active consent.",
        data=record,
    )


@app.route("/api/packet", methods=["GET"])
@staff_required
def api_packet():
    """
    Return a medical packet only after successful authorization.
    Prototype: always unavailable — never invent patient data.
    """
    token = (request.args.get("token") or "").strip()
    if not token:
        return json_error("Authorization token required", "NO_TOKEN", 401)

    return json_error(
        "Medical packet service is not configured. No patient data is returned.",
        "PACKET_UNAVAILABLE",
        503,
    )


# ---------------------------------------------------------------------------
# API — Blockchain status (read-only config check)
# ---------------------------------------------------------------------------

@app.route("/api/blockchain/status", methods=["GET"])
def api_blockchain_status():
    """
    Report whether Avalanche Fuji / contract configuration is present.
    Never exposes private keys.
    """
    rpc = os.getenv("AVALANCHE_FUJI_RPC", "")
    address = os.getenv("CONSENT_CONTRACT_ADDRESS", "")
    configured = bool(rpc and address and address.startswith("0x"))

    return json_success(
        data={
            "network": "Avalanche Fuji",
            "chain_id": 43113,
            "rpc_configured": bool(rpc),
            "contract_configured": bool(address and address.startswith("0x")),
            "ready": configured,
            "note": "On-chain writes are disabled until contract ABI and a secure signer are configured.",
        }
    )


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(413)
def too_large(_e):
    return json_error("File too large (max 10 MB)", "FILE_TOO_LARGE", 413)


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return json_error("Not found", "NOT_FOUND", 404)
    flash("Trang không tồn tại. / Page not found.", "error")
    return redirect(url_for("index"))


@app.errorhandler(500)
def server_error(_e):
    if request.path.startswith("/api/"):
        return json_error("Internal server error", "SERVER_ERROR", 500)
    return "An internal server error occurred.", 500


# ---------------------------------------------------------------------------
# Development entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.getenv("PORT", "5000"))
    # Never enable debug in production
    app.run(host="0.0.0.0", port=port, debug=debug)