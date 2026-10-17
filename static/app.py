"""
MediLink — Flask backend (prototype)
app.py

Serves patient portal, staff portal and login.
Demo authentication only. OCR / SBAR / consent / blockchain
endpoints return honest unavailable or prototype responses
until real services are configured.
"""

import os
import re
import uuid
import secrets
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

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
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Environment & app setup
# ---------------------------------------------------------------------------

load_dotenv()

app = Flask(__name__)

# Secret key — never hard-code a production value
app.secret_key = os.getenv("SECRET_KEY") or secrets.token_hex(32)

# Session cookie settings (adjust SECURE=True behind HTTPS in production)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,  # 10 MB upload limit
    UPLOAD_FOLDER=os.getenv("UPLOAD_FOLDER", "uploads"),
)

# Ensure upload directory exists and is outside static/
UPLOAD_DIR = Path(app.config["UPLOAD_FOLDER"])
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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


def staff_required(view):
    """Require an authenticated staff session. Role is taken from the session only."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id") or session.get("role") != "staff":
            flash("Truy cập dành cho nhân viên y tế. / Staff access only.", "error")
            return redirect(url_for("login"))
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


# Make current_user available in all templates
@app.context_processor
def inject_user():
    return {"current_user": current_user()}


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Patient portal homepage."""
    return render_template("index.html")


@app.route("/hospital")
def hospital():
    """
    Healthcare staff portal.
    For the prototype the page is reachable so the UI can be demonstrated.
    Any future sensitive record endpoints must use @staff_required.
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


@app.route("/logout")
def logout():
    session.clear()
    flash("Đã đăng xuất. / Signed out.", "info")
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# API — OCR upload (prototype / unavailable)
# ---------------------------------------------------------------------------

@app.route("/api/ocr", methods=["POST"])
def api_ocr():
    """
    Accept a document upload and return a structured response.
    No OCR engine is configured in this prototype — returns unavailable.
    """
    if "document" not in request.files and "file" not in request.files:
        return json_error("No file provided", "NO_FILE", 400)

    file = request.files.get("document") or request.files.get("file")
    if not file or file.filename == "":
        return json_error("Empty filename", "EMPTY_FILE", 400)

    mime = file.mimetype or ""
    if not allowed_file(file.filename, mime):
        return json_error(
            "Unsupported file type. Allowed: PDF, JPG, PNG.",
            "INVALID_TYPE",
            400,
        )

    # Save outside static/ with a safe name
    filename = safe_upload_filename(file.filename)
    dest = UPLOAD_DIR / filename
    try:
        file.save(dest)
    except OSError:
        return json_error("Could not store file", "STORAGE_ERROR", 500)

    # OCR engine not configured — honest response
    # Do NOT invent extracted medical data
    return json_success(
        message="File received. OCR engine is not configured (prototype).",
        data={
            "filename": filename,
            "ocr_available": False,
            "extracted": None,
            "note": "Configure an OCR service and replace this stub to return real results.",
        },
        status=202,
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
# API — SBAR handover (prototype, in-memory)
# ---------------------------------------------------------------------------

# In-memory store for the prototype only. Lost on restart.
_SBAR_STORE = []


@app.route("/api/sbar", methods=["POST"])
@staff_required
def api_sbar_submit():
    """Accept an SBAR handover from authenticated staff."""
    data = request.get_json(silent=True) or request.form.to_dict()

    situation = (data.get("situation") or "").strip()
    background = (data.get("background") or "").strip()
    assessment = (data.get("assessment") or "").strip()
    recommendation = (data.get("recommendation") or "").strip()
    case_ref = (data.get("case_ref") or "").strip()[:40]
    is_draft = str(data.get("draft", "")).lower() in ("1", "true", "yes")

    if not is_draft and (not situation or not assessment or not recommendation):
        return json_error(
            "Situation, Assessment and Recommendation are required.",
            "VALIDATION_ERROR",
            400,
        )

    # Length limits
    for field, value in (
        ("situation", situation),
        ("background", background),
        ("assessment", assessment),
        ("recommendation", recommendation),
    ):
        if len(value) > 2000:
            return json_error(f"{field} exceeds maximum length", "TOO_LONG", 400)

    record = {
        "id": uuid.uuid4().hex,
        "case_ref": case_ref or f"CASE-{uuid.uuid4().hex[:8].upper()}",
        "situation": situation,
        "background": background,
        "assessment": assessment,
        "recommendation": recommendation,
        "is_draft": is_draft,
        "staff_id": session.get("user_id"),
        "staff_role": session.get("staff_role"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _SBAR_STORE.append(record)

    return json_success(
        message="Handover saved (prototype — in-memory only).",
        data={
            "id": record["id"],
            "case_ref": record["case_ref"],
            "timestamp": record["timestamp"],
            "is_draft": is_draft,
            "persistent": False,
        },
        status=201,
    )


@app.route("/api/sbar", methods=["GET"])
@staff_required
def api_sbar_list():
    """List handovers for the current staff member (prototype)."""
    own = [r for r in _SBAR_STORE if r["staff_id"] == session.get("user_id")]
    # Return summary only — no full clinical text in list view if desired
    summary = [
        {
            "id": r["id"],
            "case_ref": r["case_ref"],
            "timestamp": r["timestamp"],
            "is_draft": r["is_draft"],
            "staff_role": r["staff_role"],
        }
        for r in own
    ]
    return json_success(data={"handovers": summary})


# ---------------------------------------------------------------------------
# API — Consent verification & medical packet (prototype / locked)
# ---------------------------------------------------------------------------

@app.route("/api/consent/verify", methods=["POST"])
@staff_required
def api_consent_verify():
    """
    Verify a consent token.
    Prototype: no real token store — always returns unauthorized.
    """
    data = request.get_json(silent=True) or request.form.to_dict()
    token = (data.get("token") or "").strip()

    if not token:
        return json_error("Token required", "NO_TOKEN", 400)

    # Basic format sanity (alphanumeric / dash, length)
    if not re.match(r"^[A-Za-z0-9\-_]{8,128}$", token):
        return json_error("Invalid token format", "INVALID_TOKEN", 400)

    # No real verification backend configured
    return json_error(
        "Consent verification service is not configured (prototype). Packet remains locked.",
        "CONSENT_UNAVAILABLE",
        503,
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
    flash("Đã xảy ra lỗi. / An error occurred.", "error")
    return redirect(url_for("index"))


# ---------------------------------------------------------------------------
# Development entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.getenv("PORT", "5000"))
    # Never enable debug in production
    app.run(host="0.0.0.0", port=port, debug=debug)