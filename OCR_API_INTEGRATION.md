# MediLink OCR API Integration

This guide is for the frontend teammate connecting the page to the Flask OCR
endpoint.

## Endpoint

- **Method:** `POST`
- **URL:** `/api/ocr`
- **Request type:** `multipart/form-data`
- **Authentication:** The request must have a logged-in MediLink session. The
  endpoint checks for a session cookie that identifies a logged-in user. It
  does not accept a bearer token or an API key instead.

The example below assumes the frontend is served from the same origin as the
Flask app. If the frontend and backend use different origins, the browser may
not send the session cookie and the current backend does not configure
cross-origin access. Cross-origin integration would need coordinated server
configuration; do not assume that the example works across origins.

## Upload fields and supported files

Add the selected file to `FormData` using either field name:

- `document` (recommended)
- `file`

The endpoint accepts PNG, JPG, and JPEG images. The filename extension must
match the image's actual format. PDF is not supported and returns
`PDF_NOT_SUPPORTED`, even if the file picker lets a user choose a PDF.

The maximum upload size is 10 MB. The endpoint checks the file contents and
returns an error for empty, corrupt, unreadable, or mismatched image files.

## JavaScript example

```javascript
async function sendImageForOcr(file) {
  const formData = new FormData();
  formData.append("document", file);

  const response = await fetch("/api/ocr", {
    method: "POST",
    body: formData,
    credentials: "same-origin"
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    // For example, show result.message to the user and use result.error_code
    // when the frontend needs to handle a specific error.
    throw new Error(`${result.error_code}: ${result.message}`);
  }

  return result.data.extracted;
}
```

Do not set the `Content-Type` header yourself when sending `FormData`. The
browser sets it with the multipart boundary. The user must already be logged in
to MediLink in the same browser session for the request to be authenticated.

## Successful response

When text is extracted, the endpoint returns HTTP `200`:

```json
{
  "success": true,
  "message": "OCR completed. Please verify the recognized text against the original image.",
  "data": {
    "ocr_available": true,
    "extracted": "Text recognized from the image",
    "structured": {
      "document_type": "laboratory_report",
      "test_date": "17/10/2026",
      "tests": [
        {
          "name": "Glucose",
          "result_value": "5.6",
          "unit": "mmol/L",
          "reference_range": "3.9 - 6.1"
        }
      ],
      "fields_requiring_confirmation": []
    }
  }
}
```

Use `data.extracted` to display the original OCR text. `data.structured`
contains best-effort fields from a simple text-pattern parser:

- `document_type`: `laboratory_report`, `referral`, or `null` when uncertain.
- `test_date`: a string only when it follows a recognized test-date label;
  otherwise `null`.
- `tests`: laboratory rows with `name`, `result_value`, `unit`, and
  `reference_range`. Referral documents return an empty list.
- `fields_requiring_confirmation`: entries with `field` and `reason` for
  missing, ambiguous, or unrecognized information.

The parser does not invent missing values and is not guaranteed to handle every
document layout or OCR error. Review all extracted fields against the original
image. This feature does not diagnose medical conditions or interpret results.

## Error responses

Error responses use this JSON shape:

```json
{
  "success": false,
  "message": "A human-readable explanation",
  "error_code": "ERROR_CODE"
}
```

The OCR endpoint currently returns these errors:

| HTTP status | `error_code` | When it is returned |
| --- | --- | --- |
| 400 | `NO_FILE` | Neither `document` nor `file` was included. |
| 400 | `EMPTY_FILE` | The filename is empty or the upload has no content. |
| 400 | `PDF_NOT_SUPPORTED` | The upload filename has a `.pdf` extension. |
| 400 | `INVALID_TYPE` | The filename extension is not PNG, JPG, or JPEG. |
| 400 | `FILE_READ_ERROR` | The server could not read the uploaded file. |
| 400 | `INVALID_CONTENT` | Image data is corrupt/unreadable, too large to decode, or does not match the filename extension. |
| 401 | `AUTH_REQUIRED` | There is no logged-in session. |
| 413 | `FILE_TOO_LARGE` | The upload exceeds the 10 MB limit. |
| 422 | `OCR_NO_TEXT` | OCR returned an empty string or whitespace only. |
| 503 | `OCR_FAILED` | Local Tesseract could not process the image. |

The exact `message` may vary for errors such as `EMPTY_FILE` and
`INVALID_CONTENT`, depending on which validation check failed. Use
`error_code` for error handling and `message` for a user-facing explanation.

## OCR details

OCR runs locally using Tesseract with English and Vietnamese (`eng+vie`). It
extracts text only; it is not a diagnosis or a substitute for medical review.
