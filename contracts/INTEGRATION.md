# MediLink Consent — Deployment and Integration Notes

## Status

- Contract source: `contracts/Consent.sol` (unchanged).
- ABI: `contracts/Consent.abi.json`.
- ethers.js v5 browser helper: `contracts/ConsentClient.js` and `static/js/consent-client.js`.
- Deployed Fuji address (provided for this integration): `0x4C2E26427B4BC5564AEEa12Ef6ed1968267fF9EC`.
- Deployment transaction hash: **PENDING**.
- Compilation: **not performed in this environment** (no `solc`/`forge`/Remix session).
- Contract tests and a live Fuji transaction: **not performed in this environment**.
- Browser integration: patient grant/revoke, staff wallet connection and on-chain verification, and record-details verification are wired to the consent client. The packet viewer remains subject to the existing Flask demo-token/data endpoints.

The deployment address is supplied by the project owner; the deployment transaction hash is not available here.

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
7. Record the deployed address and deployment transaction hash. The address currently configured by the project owner is `0x4C2E26427B4BC5564AEEa12Ef6ed1968267fF9EC`; confirm it on Snowtrace before any production use.
8. From Remix, copy the ABI. The checked-in ABI in `contracts/Consent.abi.json` should match; compare function/event/error names before using it.
9. Read `getConsentStatus` once with a known address pair and an unknown tuple. Expected: unknown returns `(false, false)`.
10. Optional: verify the source on the Fuji explorer.

Do not claim deployment success until the explorer shows the contract address and the transaction is confirmed.

---

## 2. Browser Integration

The integration is implemented in the existing templates and shared script. `CONSENT_CONTRACT_ADDRESS` is supplied by Flask through a `medilink-consent-address` meta tag; an empty value remains unconfigured and is reported in the UI. `.env.example` documents the network settings.

### 2.1 Browser client

`static/js/consent-client.js` is the served ethers v5 helper; `contracts/ConsentClient.js` is its source. `contracts/Consent.abi.json` remains the canonical ABI.

### 2.2 Script loading and wallet workflow

`templates/index.html`, `templates/hospital.html`, and `templates/record_details.html` provide the address meta tag and load ethers.js 5.7.2, the consent client, then `static/js/script.js`. The patient portal connects a wallet, grants/revokes consent, checks status, and displays the transaction hash and Snowtrace link. The hospital portal checks consent for the connected staff wallet before its existing token/data workflow can unlock the packet. Record Details verifies status against the contract and displays available transaction evidence.

The patient portal uses a random opaque reference when one is not supplied. Share the owner wallet, recipient wallet, and this reference with hospital staff through a private channel; enter the same reference as the hospital token and on-chain record reference. Never put patient-identifying or clinical data in `recordRef`.

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

## 3. Backend Consent and Packet Limitations

The browser verifies the consent tuple on-chain before requesting the existing Flask token/data workflow. The Flask endpoints still use in-memory demo consent and record data and do not independently verify Avalanche transactions:

- `POST /api/consent/grant` and `/api/consent/revoke` are legacy mock endpoints.
- `POST /api/consent/verify` has a demo-token fallback.
- `GET /api/shared-records/<record_id>` can create demo records.
- `GET /api/packet` remains unavailable.

Do not use the Flask demo endpoints to authorize access to real medical records. A production backend must verify the chain state itself and securely bind the owner, recipient, opaque record reference, authenticated patient, staff identity, and private record mapping before returning packet data.

Configure `.env` from `.env.example`; do not commit `.env`.

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
- The Flask consent and shared-record endpoints remain demo-only and do not provide server-side chain authorization; `/api/packet` remains unavailable.
- The configured Fuji contract address is `0x4C2E26427B4BC5564AEEa12Ef6ed1968267fF9EC`; its deployment transaction hash is not available here.
