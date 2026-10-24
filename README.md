# MediLink Backend and OCR

This guide explains how to run the Flask backend and its local OCR endpoint on
Windows. OCR uses Tesseract on this computer; uploaded images are not sent to an
external OCR service. OCR extracts text only and does not diagnose medical
conditions. Check all extracted text against the original image.

## Prerequisites

- Windows and Windows PowerShell
- Python 3 installed
- Tesseract OCR installed, including its English (`eng`) and Vietnamese (`vie`)
  language data
- The project files available on your computer

## Create the Python environment

Open PowerShell in the project root folder (the folder containing `app.py` and
`requirements.txt`), then run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell blocks activation because of its execution policy, you can skip
activation and use the virtual environment's Python executable directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Install Tesseract OCR

1. Download and run a Windows installer from the
   [UB Mannheim Tesseract builds page](https://github.com/UB-Mannheim/tesseract/wiki).
2. During installation, include the English and Vietnamese language data
   (`eng` and `vie`), if the installer offers language choices.
3. Finish the installation. The Python package `pytesseract` calls the
   Tesseract program; installing the Python requirements alone does not install
   that program or its language data.

The backend currently looks for Tesseract at:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

If Tesseract is installed elsewhere, open the root `app.py` and update the
`pytesseract.pytesseract.tesseract_cmd` path near the top of the file to the
location of `tesseract.exe`. Save the file before starting the app.

## Run the Flask application

From the project root in PowerShell, run:

```powershell
.\.venv\Scripts\python.exe .\app.py
```

The development server uses port `5000` by default. Open
`http://127.0.0.1:5000/` in a browser. Keep the PowerShell window open while
using the server; press `Ctrl+C` there to stop it.

The `.env` file is used for local configuration and may contain secrets. Do not
share it or commit it. Keep secret values private.

## Run the OCR tests

From the project root, run the endpoint tests:

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_ocr_endpoint
```

Run the real local OCR test (it needs Tesseract and both language data files):

```powershell
.\.venv\Scripts\python.exe .\test_ocr_real_endpoint.py
```

## OCR endpoint

The OCR route is:

```text
POST /api/ocr
```

The request must be `multipart/form-data` and include the uploaded image in a
field named `document`. The backend also accepts the field name `file`. The
request must come from a logged-in session; send the session cookie with API
requests. A request without an authenticated session returns HTTP `401`.

Supported formats are PNG, JPG, and JPEG. PDF is not supported, even if the
web page's file picker allows selecting a PDF. The upload limit is 10 MB.
Tesseract runs with English and Vietnamese (`eng+vie`) and has a 30-second
timeout.

On success, the endpoint returns HTTP `200` with JSON containing
`success: true`, the original recognized text in `data.extracted`, and
best-effort parsed fields in `data.structured`. The parser uses simple,
explicit text patterns; unclear or missing values are `null` and are listed
in `fields_requiring_confirmation`. It does not diagnose or recommend
treatment. Always verify extracted information against the original image.

The structured response contains `document_type` (`laboratory_report`,
`referral`, or `null`), `test_date`, a `tests` list with each test's name,
result, unit, and reference range, and `fields_requiring_confirmation`.
Referral documents do not produce laboratory test rows. This basic parser is
not guaranteed to recognize every document layout or OCR error.

Common JSON errors include:

| HTTP status | `error_code` | Meaning |
| --- | --- | --- |
| 400 | `NO_FILE` | No upload field was provided. |
| 400 | `EMPTY_FILE` | The uploaded file has no content or filename. |
| 400 | `PDF_NOT_SUPPORTED` | The uploaded file is a PDF. |
| 400 | `INVALID_TYPE` | The file extension is not PNG, JPG, or JPEG. |
| 400 | `INVALID_CONTENT` | The image is invalid, unreadable, too large to decode, or its content does not match its extension. |
| 400 | `FILE_READ_ERROR` | The server could not read the uploaded file. |
| 401 | `AUTH_REQUIRED` | The request has no logged-in session. |
| 413 | `FILE_TOO_LARGE` | The upload exceeds 10 MB. |
| 422 | `OCR_NO_TEXT` | OCR returned an empty or whitespace-only result. |
| 503 | `OCR_FAILED` | Tesseract could not process the image. Check the Tesseract installation and language data. |

API error responses are JSON with `success: false`, a human-readable `message`,
and an `error_code`. For `OCR_NO_TEXT`, the message is
`No readable text could be extracted from the image.`