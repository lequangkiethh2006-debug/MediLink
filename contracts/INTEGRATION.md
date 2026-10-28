# MediLink Consent — Deployment and Integration Notes

## Status

- Contract source: `contracts/Consent.sol` (unchanged).
- ABI: `contracts/Consent.abi.json`.
- ethers.js v6 browser helper: `contracts/ConsentClient.js`.
- Deployed Fuji address: **PENDING**.
- Deployment transaction hash: **PENDING**.
- Compilation: **not performed in this environment** (no `solc`/`forge`/Remix session).
- Contract tests: **not executed on-chain**.
- Frontend/backend integration: **not applied** because edits outside `contracts/` are prohibited.
- Local artifact checks: ABI JSON/shape and ABI/source consistency passed; `ConsentClient.js` passed syntax, mocked-provider, real-ethers-v6 read, and mocked-transaction tests. No Fuji transaction was sent.

Do not invent an address or transaction hash. Fill in real values only after a Fuji deployment.

---

## Contract Interface

```text
grantConsent(address recipient, string recordRef)
revokeConsent(address recipient, string recordRef)
getConsentStatus(address consentOwner, address recipient, string recordRef)
    view returns (bool exists, bool active)
```

Events:

```text
ConsentGranted(address indexed owner, address indexed recipient, string recordRef)
ConsentRevoked(address indexed owner, address indexed recipient, string recordRef)
```

Errors:

```text
InvalidRecipient()
EmptyRecordRef()
ConsentAlreadyActive()
ConsentNotFound()
ConsentAlreadyRevoked()
```

Behavior preserved from the existing contract:

- The transaction sender becomes the consent owner.
- Granting an already-active consent reverts.
- Revoking an unknown or already-revoked consent reverts.
- A revoked consent can be granted again.
- Only the owner can revoke their own consent.

---

## Privacy Rule

`recordRef` is public in calldata and event logs. Use only an opaque random ID or hash, for example a UUID generated for the off-chain record. Never put a name, citizen ID, phone number, medical record number, test result, diagnosis, image reference, API key, or other identifying/clinical information on-chain.

The frontend/backend must keep the mapping from `recordRef` to the real off-chain record in private storage.

---

## 1. Compile and Deploy with Remix + MetaMask

1. Install MetaMask and create/use a **test-only** account. Never use a seed phrase or private key in project files.
2. Add Avalanche Fuji Testnet in MetaMask:
   - Network name: `Avalanche Fuji Testnet`
   - Chain ID: `43113` (`0xa869`)
   - RPC URL: `https://api.avax-test.network/ext/bc/C/rpc`
   - Currency symbol: `AVAX`
   - Explorer: `https://testnet.snowtrace.io/`
3. Fund the test account with Fuji AVAX from the Avalanche faucet.
4. Open Remix, create `contracts/Consent.sol`, and paste the existing source.
5. Compile with Solidity `0.8.20` or a later `0.8.x` version accepted by `^0.8.20`.
6. In **Deploy & Run Transactions**, choose **Injected Provider - MetaMask**, confirm the network is Fuji, and deploy `Consent` with no constructor arguments.
7. Record the deployed address and deployment transaction hash. Replace the PENDING markers in this file only after the transaction is confirmed.
8. From Remix, copy the ABI. The checked-in ABI in `contracts/Consent.abi.json` should match; compare function/event/error names before using it.
9. Read `getConsentStatus` once with a known address pair and an unknown tuple. Expected: unknown returns `(false, false)`.
10. Optional: verify the source on the Fuji explorer.

Do not claim deployment success until the explorer shows the contract address and the transaction is confirmed.

---

## 2. Required Manual Frontend Changes (outside `contracts/`)

These files must be edited manually; they are outside the allowed write scope.

### 2.1 Copy the client into the public static directory

From the project root:

```powershell
Copy-Item .\contracts\ConsentClient.js .\static\js\consent-client.js
```

The ABI JSON does not need to be copied for the browser helper because the helper contains the equivalent human-readable ABI. Keep `contracts/Consent.abi.json` as the canonical handoff artifact.

### 2.2 Load ethers.js v6 and the client

In `templates/index.html` and `templates/hospital.html`, add these scripts **before** `static/js/script.js`. Pin the ethers version you actually test.

```html
<!-- Pin an ethers v6 build; do not use v5 APIs with ConsentClient.js. -->
<!-- If you change the version, update the SRI hash as well. -->
<script src="https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js"
        integrity="sha384-6Zl0Pc8zjSz8KvmNeXRvUQgY4ryFb+BwDvKCmLYcBME0joAaru491tQgi9B7zsMM"
        crossorigin="anonymous"></script>

<!-- Replace with the real deployed Fuji address after Remix deployment. -->
<script>
  window.MEDILINK_CONSENT_ADDRESS = "0x0000000000000000000000000000000000000000";
</script>

<script src="{{ url_for('static', filename='js/consent-client.js') }}"></script>
<script src="{{ url_for('static', filename='js/script.js') }}"></script>
```

Replace the placeholder zero address after deployment. `ConsentClient.js` treats the zero address as unconfigured and refuses contract calls until a real address is supplied.

### 2.3 Add recipient and record-reference inputs

The existing “Connect MetaMask / Grant access” button has no way to supply the two arguments required by `grantConsent`. Add fields to the consent panel in `templates/index.html`, for example:

```html
<div class="form-group">
  <label for="consent-recipient">Recipient wallet address</label>
  <input type="text" id="consent-recipient" maxlength="42"
         placeholder="0x..." autocomplete="off">
</div>

<div class="form-group">
  <label for="consent-record-ref">Opaque record reference</label>
  <input type="text" id="consent-record-ref" maxlength="256"
         placeholder="random ID or hash — never patient data"
         autocomplete="off">
</div>
```

Use a staff/demo recipient address and a random reference for the demo. Do not use a patient name or real medical record number.

### 2.4 Replace the prototype wallet success block

In `static/js/script.js`, the current `initPatientConsent()` success path only hides the QR area and sets the transaction state to idle. Replace that prototype success block with a real contract call. Preserve the existing wrong-network/error handling and use the existing `#tx-state-*`, `#tx-hash-display`, and `#tx-explorer-link` elements.

Reference implementation:

```javascript
const consent = window.MediLinkConsent;
if (!consent) {
  throw new Error("consent-client.js failed to load.");
}

const connected = await consent.connect();
const recipient = ($('#consent-recipient') || {}).value?.trim() || '';
const recordRef = ($('#consent-record-ref') || {}).value?.trim() || '';

setTxState('pending');
try {
  const result = await consent.grantConsent(recipient, recordRef);
  setTxState('success');

  const hashEl = $('#tx-hash-display');
  if (hashEl) hashEl.textContent = result.hash;

  const explorer = $('#tx-explorer-link');
  if (explorer) {
    explorer.href = result.explorerUrl;
    explorer.hidden = false;
  }

  // Verify the on-chain state after the receipt.
  const status = await consent.getConsentStatus(
    connected.address,
    recipient,
    recordRef
  );
  if (!status.active) {
    throw new Error("Transaction confirmed but consent is not active.");
  }
} catch (error) {
  setTxState('failed');
  const errorEl = $('#tx-error-msg');
  if (errorEl) errorEl.textContent = consent.describeError(error);
}
```

Add a revoke action using `consent.revokeConsent(recipient, recordRef)` and the same receipt/explorer handling. Keep OCR success and blockchain success visually separate.

### 2.5 OCR wiring and PDF consistency

The backend contains an `/api/ocr` implementation, but `static/js/script.js` never calls it. Add a `fetch` after the client-side checks:

```javascript
const formData = new FormData();
formData.append('document', file);

const response = await fetch('/api/ocr', {
  method: 'POST',
  body: formData,
  credentials: 'same-origin'
});
const result = await response.json();

if (!response.ok || !result.success) {
  throw new Error(`${result.error_code}: ${result.message}`);
}

// Use textContent for extracted text to avoid HTML injection.
const extracted = result.data.extracted;
const structured = result.data.structured;
```

`/api/ocr` requires the demo patient session; sign in before testing it. The backend rejects PDF files (`PDF_NOT_SUPPORTED`) even though `templates/index.html` and `script.js` currently accept them. Either:

- remove `.pdf` and `application/pdf` from the file picker/client checks, or
- add a PDF-to-image conversion step on the backend before OCR.

Do not claim PDF OCR works until one of those changes is implemented and tested.

The backend hardcodes Tesseract at:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Install Tesseract with English and Vietnamese data, or update the path in the root `app.py`. Tesseract is currently absent in this environment, so OCR would return `503 OCR_FAILED`.

---

## 3. Optional Backend Consent Verification

The current Flask endpoints are still stubs:

- `POST /api/consent/verify` returns `503 CONSENT_UNAVAILABLE`.
- `GET /api/packet` returns `503 PACKET_UNAVAILABLE`.

The 15-step demonstration workflow can be completed with the frontend-controlled consent transaction, but the packet cannot unlock until the backend verifies consent. If that is required:

1. Add a read-only Python chain client (for example `web3`) to `requirements.txt`.
2. Configure `AVALANCHE_FUJI_RPC` and `CONSENT_CONTRACT_ADDRESS` in `.env` (never commit `.env`).
3. Load `contracts/Consent.abi.json` in the backend.
4. Map an opaque token to `(owner, recipient, recordRef)` in private storage, with an expiry and single-use/revocation rules.
5. Call `getConsentStatus(owner, recipient, recordRef)` and reject unless `active == true`.
6. Return the medical packet only after successful verification; keep the current `503` behavior until it is genuinely implemented.

Do not trust a client-supplied owner/recipient without binding it to the authenticated staff session and/or a wallet signature.

---

## 4. Test Checklist

### Contract-side (manual in Remix unless tooling is installed)

- Compile with the chosen `0.8.x` compiler; record version and ABI.
- Deploy to Fuji; record address and deployment tx.
- Grant a consent; verify `exists=true`, `active=true`, `ConsentGranted`.
- Duplicate active grant reverts `ConsentAlreadyActive`.
- Revoke by owner; verify `active=false`, `ConsentRevoked`.
- Double revoke reverts `ConsentAlreadyRevoked`.
- Revoke unknown reverts `ConsentNotFound`.
- Re-grant after revoke succeeds.
- Another account cannot revoke the owner’s consent.
- Zero recipient reverts `InvalidRecipient`.
- Empty `recordRef` reverts `EmptyRecordRef`.
- Unknown `getConsentStatus` returns `(false, false)`.

### Frontend

- ethers v6 loads; `MediLinkConsent.getConfig().configured` is true only after a real address is set.
- Wrong network triggers switch/add-network.
- User rejection produces a clear failure message.
- Pending, success, failure, transaction hash, and explorer link are visible.
- OCR success is displayed separately from blockchain success.
- Refresh/reload and verify the status via `getConsentStatus`.

### Privacy

- No name, patient ID, phone number, result, diagnosis, or image data appears in `recordRef`, QR payloads, event logs, or transaction input.
- Explorer inspection of the grant/revoke transaction shows only addresses and the opaque reference.

---

## 5. Known Limitations

- The contract has no expiry, scope, explicit timestamps, token, access-audit event, or enumeration. The existing UI text promises some of these; do not claim they work unless the contract and backend are extended.
- The contract has no on-chain `recordRef` length cap. Use a short opaque UUID/hash; an oversized string increases transaction gas.
- The static QR image is not a consent token and has no expiry logic.
- The existing `/api/consent/verify` and `/api/packet` endpoints remain unavailable until manually implemented.
- No contract address or transaction hash is provided here; both are PENDING.
