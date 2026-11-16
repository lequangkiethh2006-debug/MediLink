/**
 * MediLink — shared frontend script
 * static/js/script.js
 *
 * Works on login.html, index.html and hospital.html.
 * All page-specific code is guarded by element existence checks.
 * No credentials, no real patient data, no fake blockchain success.
 */

(function () {
  'use strict';

  /* ================================================================
     1. SHARED HELPERS
     ================================================================ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function exists(el) {
    return el !== null && el !== undefined;
  }

  function setHidden(el, hidden) {
    if (!exists(el)) return;
    el.hidden = !!hidden;
  }

  function setText(el, vi, en) {
    if (!exists(el)) return;
    // Prefer existing lang spans if present; otherwise set textContent
    const viSpan = el.querySelector('.lang-vi');
    const enSpan = el.querySelector('.lang-en');
    if (viSpan && enSpan) {
      viSpan.textContent = vi;
      enSpan.textContent = en;
    } else {
      el.textContent = document.body.classList.contains('lang-en-active') ? en : vi;
    }
  }

  function showStatus(container, messageVi, messageEn, type = 'idle') {
    if (!exists(container)) return;
    setHidden(container, false);
    container.className = 'status-area';
    const msg = document.createElement('p');
    msg.className = `status-msg status-msg--${type}`;
    const vi = document.createElement('span');
    vi.className = 'lang-vi';
    vi.textContent = messageVi;
    const en = document.createElement('span');
    en.className = 'lang-en';
    en.textContent = messageEn;
    msg.append(vi, en);
    container.replaceChildren();
    container.appendChild(msg);
  }

  function disableBtn(btn, disabled = true) {
    if (!exists(btn)) return;
    btn.disabled = !!disabled;
  }

  function isConsentConfigured() {
    return !!(
      window.MediLinkConsent &&
      window.MediLinkConsent.getConfig().configured
    );
  }

  function setConsentConfigWarning(el) {
    setText(
      el,
      'Chưa cấu hình địa chỉ hợp đồng đồng thuận. Hãy đặt CONSENT_CONTRACT_ADDRESS trong .env.',
      'Consent contract address is not configured. Set CONSENT_CONTRACT_ADDRESS in .env.'
    );
  }

  /* ================================================================
     2. LANGUAGE SWITCHING
     ================================================================ */

  const LANG_KEY = 'medilink-lang';

  function applyLanguage(lang) {
    const isEn = lang === 'en';
    document.body.classList.toggle('lang-en-active', isEn);
    document.documentElement.lang = isEn ? 'en' : 'vi';

    $$('.lang-btn').forEach((btn) => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function initLanguage() {
    let saved = 'vi';
    try {
      saved = localStorage.getItem(LANG_KEY) || 'vi';
    } catch {
      saved = 'vi';
    }
    applyLanguage(saved === 'en' ? 'en' : 'vi');

    $$('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang === 'en' ? 'en' : 'vi';
        applyLanguage(lang);
      });
    });
  }

  /* ================================================================
     3. THEME SWITCHING
     ================================================================ */

  const THEME_KEY = 'medilink-theme';
  const THEMES = ['classic-royal', 'cyber-heritage'];

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'classic-royal';
    document.documentElement.setAttribute('data-theme', t);
    document.body.classList.remove('theme-classic-royal', 'theme-cyber-heritage');
    document.body.classList.add(`theme-${t}`);

    $$('.theme-btn').forEach((btn) => {
      const active = btn.dataset.theme === t;
      btn.classList.toggle('active', active);
    });

    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
  }

  function initTheme() {
    let saved = 'classic-royal';
    try {
      saved = localStorage.getItem(THEME_KEY) || 'classic-royal';
    } catch {
      saved = 'classic-royal';
    }
    applyTheme(saved);

    $$('.theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme || 'classic-royal');
      });
    });
  }

  /* ================================================================
     4. MOBILE NAV TOGGLE (patient portal)
     ================================================================ */

  function initMobileNav() {
    const toggle = $('.nav-toggle');
    const menu = $('#nav-menu');
    if (!exists(toggle) || !exists(menu)) return;

    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ================================================================
     5. LOGIN PAGE
     ================================================================ */

  function initLogin() {
    const tabPatient = $('#tab-patient');
    const tabStaff = $('#tab-staff');
    const panelPatient = $('#panel-patient');
    const panelStaff = $('#panel-staff');
    if (!exists(tabPatient) || !exists(tabStaff)) return;

    function switchMode(mode) {
      const isPatient = mode === 'patient';
      tabPatient.classList.toggle('active', isPatient);
      tabStaff.classList.toggle('active', !isPatient);
      tabPatient.setAttribute('aria-selected', isPatient ? 'true' : 'false');
      tabStaff.setAttribute('aria-selected', isPatient ? 'false' : 'true');
      setHidden(panelPatient, !isPatient);
      setHidden(panelStaff, isPatient);
      if (exists(panelPatient)) panelPatient.classList.toggle('active', isPatient);
      if (exists(panelStaff)) panelStaff.classList.toggle('active', !isPatient);
    }

    tabPatient.addEventListener('click', () => switchMode('patient'));
    tabStaff.addEventListener('click', () => switchMode('staff'));

    // Password visibility toggles
    $$('.btn-toggle-password').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = targetId ? document.getElementById(targetId) : null;
        if (!exists(input)) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const vi = btn.querySelector('.lang-vi');
        const en = btn.querySelector('.lang-en');
        if (vi && en) {
          vi.textContent = isPassword ? 'Ẩn' : 'Hiện';
          en.textContent = isPassword ? 'Hide' : 'Show';
        }
        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      });
    });

    // Client-side required-field check only — never mark as authenticated
    function validateForm(form) {
      let valid = true;
      const fields = form.querySelectorAll('[required]');
      fields.forEach((field) => {
        const errorId = field.getAttribute('aria-describedby');
        const errorEl = errorId
          ? document.getElementById(errorId.split(' ').find((id) => id.includes('error')))
          : null;
        if (!field.value.trim()) {
          valid = false;
          if (exists(errorEl)) {
            errorEl.hidden = false;
            errorEl.textContent = document.body.classList.contains('lang-en-active')
              ? 'This field is required.'
              : 'Trường này là bắt buộc.';
          }
        } else if (exists(errorEl)) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }
      });
      return valid;
    }

    const formPatient = $('#form-patient');
    const formStaff = $('#form-staff');
    const pending = $('#login-pending');

    function handleSubmit(e, form) {
      // Let the browser submit to Flask; only block if client validation fails
      if (!validateForm(form)) {
        e.preventDefault();
        return;
      }
      // Optional: show pending UI while the request is in flight
      if (exists(pending)) {
        setHidden(pending, false);
      }
      // Do NOT preventDefault on success path — backend must decide redirect
    }

    if (exists(formPatient)) {
      formPatient.addEventListener('submit', (e) => handleSubmit(e, formPatient));
    }
    if (exists(formStaff)) {
      formStaff.addEventListener('submit', (e) => handleSubmit(e, formStaff));
    }
  }

  /* ================================================================
     6. PATIENT PORTAL — OCR UPLOAD
     ================================================================ */

  const OCR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB client-side guide
  const OCR_ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

  function initOcrUpload() {
    const input = $('#doc-upload');
    const preview = $('#doc-preview');
    const previewContent = $('#doc-preview-content');
    const clearBtn = $('#btn-clear-doc');
    const status = $('#doc-status');
    const result = $('#doc-result');
    const resultContent = $('#doc-result-content');
    if (!exists(input)) return;

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.id = 'btn-run-ocr';
    runBtn.className = 'btn btn-primary';
    runBtn.append(
      Object.assign(document.createElement('span'), {
        className: 'lang-vi',
        textContent: 'Chạy OCR',
      }),
      Object.assign(document.createElement('span'), {
        className: 'lang-en',
        textContent: 'Run OCR',
      })
    );
    if (exists(clearBtn) && clearBtn.parentElement) {
      clearBtn.parentElement.insertBefore(runBtn, clearBtn);
    } else {
      input.insertAdjacentElement('afterend', runBtn);
    }

    function resetOcr() {
      input.value = '';
      if (exists(previewContent)) previewContent.innerHTML = '';
      if (exists(resultContent)) resultContent.replaceChildren();
      setHidden(preview, true);
      setHidden(status, true);
      setHidden(result, true);
      disableBtn(clearBtn, true);
    }

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        resetOcr();
        return;
      }

      // Client-side checks only — server must re-validate
      if (file.size > OCR_MAX_BYTES) {
        resetOcr();
        showStatus(
          status,
          'Tệp vượt quá 10 MB. Vui lòng chọn tệp nhỏ hơn.',
          'File exceeds 10 MB. Please choose a smaller file.',
          'error'
        );
        return;
      }

      const typeOk =
        OCR_ACCEPT.includes(file.type) ||
        /\.(pdf|jpe?g|png)$/i.test(file.name);
      if (!typeOk) {
        resetOcr();
        showStatus(
          status,
          'Định dạng không hỗ trợ. Chỉ nhận PDF, JPG, PNG.',
          'Unsupported format. Only PDF, JPG, PNG are accepted.',
          'error'
        );
        return;
      }

      disableBtn(clearBtn, false);
      setHidden(status, true);
      setHidden(result, true);
      if (exists(resultContent)) resultContent.replaceChildren();

      // Local image preview only
      if (file.type.startsWith('image/') && exists(previewContent)) {
        const url = URL.createObjectURL(file);
        previewContent.innerHTML = '';
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Document preview';
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        previewContent.appendChild(img);
        setHidden(preview, false);
      } else if (exists(previewContent)) {
        previewContent.innerHTML =
          `<p><span class="lang-vi">Đã chọn: ${file.name}</span>` +
          `<span class="lang-en">Selected: ${file.name}</span></p>`;
        setHidden(preview, false);
      }

      showStatus(
        status,
        'Tệp đã sẵn sàng. Nhấn “Chạy OCR” để trích xuất văn bản.',
        'File ready. Select “Run OCR” to extract text.',
        'idle'
      );
    });

    runBtn.addEventListener('click', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        setHidden(result, true);
        showStatus(
          status,
          'Vui lòng chọn tệp trước khi chạy OCR.',
          'Please select a file before running OCR.',
          'error'
        );
        return;
      }

      const formData = new FormData();
      formData.append('document', file);
      disableBtn(runBtn, true);
      showStatus(
        status,
        'Đang tải tài liệu lên và chạy OCR…',
        'Uploading document and running OCR…',
        'processing'
      );
      setHidden(result, true);
      if (exists(resultContent)) resultContent.replaceChildren();

      try {
        const response = await fetch('/api/ocr', {
          method: 'POST',
          body: formData,
        });
        const payload = await response.json().catch(() => null);

        if (response.status === 401) {
          throw new Error('AUTH_REQUIRED');
        }
        if (!response.ok || !payload || payload.success !== true) {
          throw new Error(
            (payload && payload.error_code) || 'OCR_FAILED'
          );
        }

        const data = payload.data || {};
        const extracted = typeof data.extracted === 'string'
          ? data.extracted
          : '';
        if (!extracted.trim()) {
          throw new Error('OCR_FAILED');
        }

        if (exists(resultContent)) {
          const heading = document.createElement('h4');
          heading.textContent = 'Recognized text';
          const text = document.createElement('pre');
          text.textContent = extracted;
          resultContent.append(heading, text);

          if (data.structured) {
            const detailsHeading = document.createElement('h4');
            detailsHeading.textContent = 'Extracted fields (verify against the original)';
            const details = document.createElement('pre');
            details.textContent = JSON.stringify(data.structured, null, 2);
            resultContent.append(detailsHeading, details);
          }
        }

        setHidden(result, false);
        showStatus(
          status,
          'OCR hoàn tất. Vui lòng đối chiếu văn bản với tài liệu gốc.',
          'OCR complete. Please verify the text against the original document.',
          'success'
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : 'OCR_FAILED';
        const messages = {
          AUTH_REQUIRED: [
            'Vui lòng đăng nhập để sử dụng OCR.',
            'Please sign in to use OCR.',
          ],
          OCR_FAILED: [
            'Không thể xử lý tài liệu bằng OCR. Vui lòng thử lại.',
            'OCR could not process the document. Please try again.',
          ],
          OCR_NO_TEXT: [
            'Không tìm thấy văn bản đọc được trong tài liệu.',
            'No readable text was found in the document.',
          ],
          PDF_NOT_SUPPORTED: [
            'Backend hiện chưa hỗ trợ PDF. Vui lòng chọn JPG hoặc PNG.',
            'The backend does not support PDF yet. Please choose a JPG or PNG.',
          ],
        };
        const message = messages[code] || [
          'Tải lên hoặc xử lý tài liệu thất bại. Vui lòng thử lại.',
          'The upload or document processing failed. Please try again.',
        ];
        setHidden(result, true);
        showStatus(status, message[0], message[1], 'error');
      } finally {
        disableBtn(runBtn, false);
      }
    });

    if (exists(clearBtn)) {
      clearBtn.addEventListener('click', resetOcr);
    }
  }

  /* ================================================================
     7. PATIENT PORTAL — FOLLOW-UP
     ================================================================ */

  function initFollowUp() {
    const btnImproved = $('#btn-improved');
    const btnNoImprove = $('#btn-no-improve');
    const response = $('#followup-response');
    if (!exists(btnImproved) && !exists(btnNoImprove)) return;

    function showResponse(htmlVi, htmlEn) {
      if (!exists(response)) return;
      response.innerHTML =
        `<p><span class="lang-vi">${htmlVi}</span>` +
        `<span class="lang-en">${htmlEn}</span></p>`;
      setHidden(response, false);
    }

    if (exists(btnImproved)) {
      btnImproved.addEventListener('click', () => {
        showResponse(
          'Cảm ơn bạn đã phản hồi. Nếu triệu chứng tái phát hoặc xuất hiện dấu hiệu bất thường, hãy liên hệ cơ sở y tế. Đây là hướng dẫn prototype, không phải chỉ định điều trị.',
          'Thank you for your feedback. If symptoms return or new warning signs appear, contact a healthcare facility. This is prototype guidance, not a treatment order.'
        );
      });
    }

    if (exists(btnNoImprove)) {
      btnNoImprove.addEventListener('click', () => {
        showResponse(
          'Nếu tình trạng không cải thiện, hãy liên hệ bác sĩ hoặc đến cơ sở y tế để được đánh giá. Không trì hoãn nếu có dấu hiệu cấp cứu (khó thở, đau ngực, mất ý thức…). Đây không phải chẩn đoán tự động.',
          'If there is no improvement, contact your doctor or visit a healthcare facility for assessment. Do not delay if emergency signs appear (shortness of breath, chest pain, loss of consciousness…). This is not an automated diagnosis.'
        );
      });
    }
  }

  /* ================================================================
     8. PATIENT PORTAL — CONSENT / WALLET UI
     ================================================================ */

  function initPatientConsent() {
    const btnConnect = $('#btn-connect-wallet');
    const btnGrant = $('#btn-grant-consent');
    const btnRevoke = $('#btn-revoke-consent');
    const statusValue = $('#consent-status-value');
    const qrArea = $('#consent-qr-area');
    const walletDisplay = $('#connected-wallet');
    const contractDisplay = $('#patient-contract-address');
    const txIdle = $('#tx-state-idle');
    const txPending = $('#tx-state-pending');
    const txSuccess = $('#tx-state-success');
    const txFailed = $('#tx-state-failed');
    if (!exists(btnConnect)) return;

    let connectedAddress = '';
    const client = () => window.MediLinkConsent;

    function setTxState(state) {
      [txIdle, txPending, txSuccess, txFailed].forEach((el) => setHidden(el, true));
      if (state === 'pending') setHidden(txPending, false);
      else if (state === 'success') setHidden(txSuccess, false);
      else if (state === 'failed') setHidden(txFailed, false);
      else setHidden(txIdle, false);
    }

    function showWalletError(error) {
      const errorEl = $('#tx-error-msg');
      if (!exists(errorEl)) return;
      errorEl.textContent = client()
        ? client().describeError(error)
        : (document.body.classList.contains('lang-en-active')
          ? 'Consent client unavailable. Reload the page and try again.'
          : 'Không tải được tiện ích đồng thuận. Hãy tải lại trang và thử lại.');
    }

    function updateConnectedWallet(address) {
      connectedAddress = address || '';
      if (exists(walletDisplay)) walletDisplay.textContent = connectedAddress || '—';
      if (!isConsentConfigured()) {
        setConsentConfigWarning(statusValue);
        if (exists(statusValue)) {
          statusValue.classList.remove('status-value--connected');
          statusValue.classList.add('status-value--disconnected');
        }
        return;
      }
      if (connectedAddress && exists(statusValue)) {
        setText(statusValue, 'Ví đã kết nối', 'Wallet connected');
        statusValue.classList.remove('status-value--disconnected');
        statusValue.classList.add('status-value--connected');
      } else if (exists(statusValue)) {
        setText(statusValue, 'Chưa kết nối ví', 'Wallet not connected');
        statusValue.classList.remove('status-value--connected');
        statusValue.classList.add('status-value--disconnected');
      }
    }

    async function connectWallet() {
      if (!client()) throw new Error('Consent client is unavailable.');
      const connection = await client().connect();
      updateConnectedWallet(connection.address);
      if (exists(contractDisplay)) {
        contractDisplay.textContent = client().getConfig().contractAddress || '—';
      }
      setHidden(qrArea, true);
      return connection;
    }

    function transactionInputs() {
      const recipient = $('#consent-recipient');
      const recordRef = $('#consent-record-ref');
      if (exists(recordRef) && !recordRef.value.trim()) {
        if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
          throw new Error('A secure random generator is required for the record reference.');
        }
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        recordRef.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      return {
        recipient: exists(recipient) ? recipient.value.trim() : '',
        recordRef: exists(recordRef) ? recordRef.value.trim() : '',
      };
    }

    async function refreshPatientConsent(connection, inputs) {
      const result = await client().getConsentStatus(
        connection.address,
        inputs.recipient,
        inputs.recordRef
      );
      if (result.exists && result.active) {
        setText(statusValue, 'Đồng thuận đang có hiệu lực', 'Consent is active');
      } else if (result.exists) {
        setText(statusValue, 'Đồng thuận đã bị thu hồi', 'Consent has been revoked');
      } else {
        setText(statusValue, 'Chưa tìm thấy đồng thuận', 'No consent found');
      }
      return result;
    }

    async function submitConsent(action) {
      const buttons = [btnConnect, btnGrant, btnRevoke];
      buttons.forEach((button) => disableBtn(button, true));
      setTxState('pending');
      const errorEl = $('#tx-error-msg');
      if (exists(errorEl)) errorEl.textContent = '';
      try {
        const connection = await connectWallet();
        const inputs = transactionInputs();
        const result = action === 'grant'
          ? await client().grantConsent(inputs.recipient, inputs.recordRef)
          : await client().revokeConsent(inputs.recipient, inputs.recordRef);
        const hashEl = $('#tx-hash-display');
        const explorer = $('#tx-explorer-link');
        if (exists(hashEl)) hashEl.textContent = result.hash;
        if (exists(explorer)) {
          explorer.href = result.explorerUrl;
          setHidden(explorer, false);
        }
        const current = await refreshPatientConsent(connection, inputs);
        const expectedActive = action === 'grant';
        if (!current.exists || current.active !== expectedActive) {
          throw new Error('The confirmed transaction did not produce the expected consent state.');
        }
        setTxState('success');
      } catch (error) {
        setTxState('failed');
        showWalletError(error);
      } finally {
        buttons.forEach((button) => disableBtn(button, false));
      }
    }

    if (client() && exists(contractDisplay)) {
      contractDisplay.textContent = client().getConfig().contractAddress || '—';
    }
    btnConnect.addEventListener('click', async () => {
      disableBtn(btnConnect, true);
      try {
        const connection = await connectWallet();
        if (!isConsentConfigured()) {
          setTxState('idle');
          return;
        }
        const inputs = transactionInputs();
        if (inputs.recipient && inputs.recordRef) {
          const current = await refreshPatientConsent(connection, inputs);
          setTxState('idle');
          if (!current.exists) setText(statusValue, 'Chưa tìm thấy đồng thuận', 'No consent found');
        } else {
          setTxState('idle');
        }
      } catch (error) {
        setTxState('failed');
        showWalletError(error);
      } finally {
        disableBtn(btnConnect, false);
      }
    });
    if (exists(btnGrant)) btnGrant.addEventListener('click', () => submitConsent('grant'));
    if (exists(btnRevoke)) btnRevoke.addEventListener('click', () => submitConsent('revoke'));

    if (window.ethereum && typeof window.ethereum.on === 'function') {
      window.ethereum.on('accountsChanged', (accounts) => {
        updateConnectedWallet(accounts && accounts.length ? accounts[0] : '');
        setText(statusValue, 'Chưa xác minh đồng thuận', 'Consent not verified');
        setTxState('idle');
      });
      window.ethereum.on('chainChanged', () => {
        setText(statusValue, 'Chưa xác minh đồng thuận', 'Consent not verified');
        setTxState('idle');
      });
    }
  }

  /* ================================================================
     9. HOSPITAL PORTAL — SHIFT MANAGEMENT
     ================================================================ */

  function initShift() {
    const roleSelect = $('#staff-role-select');
    const btnIn = $('#btn-check-in');
    const btnOut = $('#btn-check-out');
    const statusValue = $('#shift-status-value');
    const dashShift = $('#dash-shift-status');
    const roleDisplay = $('#staff-role-display');
    const reporterRole = $('#sbar-reporter-role');
    const handoverReq = $('#handover-required');
    if (!exists(btnIn) || !exists(btnOut)) return;

    let checkedIn = false;

    function updateRoleLabels() {
      const val = roleSelect ? roleSelect.value : '';
      const labels = {
        'shift-lead': { vi: 'Bác sĩ trưởng ca', en: 'Shift-leading physician' },
        treating: { vi: 'Bác sĩ điều trị', en: 'Treating physician' },
        nurse: { vi: 'Điều dưỡng', en: 'Nurse' },
      };
      const label = labels[val] || { vi: 'Chưa chọn vai trò', en: 'Role not selected' };
      if (exists(roleDisplay)) setText(roleDisplay, label.vi, label.en);
      if (exists(reporterRole)) reporterRole.value = label.vi;
    }

    if (exists(roleSelect)) {
      roleSelect.addEventListener('change', updateRoleLabels);
    }

    btnIn.addEventListener('click', () => {
      if (exists(roleSelect) && !roleSelect.value) {
        alert(
          document.body.classList.contains('lang-en-active')
            ? 'Please select a role first.'
            : 'Vui lòng chọn vai trò trước.'
        );
        return;
      }
      checkedIn = true;
      disableBtn(btnIn, true);
      disableBtn(btnOut, false);
      if (exists(statusValue)) {
        setText(statusValue, 'Đang trong ca (prototype)', 'On shift (prototype)');
      }
      if (exists(dashShift)) {
        setText(dashShift, 'Đang trong ca', 'On shift');
      }
      setHidden(handoverReq, true);
      updateRoleLabels();
    });

    btnOut.addEventListener('click', () => {
      // Prototype: simply update UI — real backend would confirm
      checkedIn = false;
      disableBtn(btnIn, false);
      disableBtn(btnOut, true);
      if (exists(statusValue)) {
        setText(statusValue, 'Đã check-out (prototype)', 'Checked out (prototype)');
      }
      if (exists(dashShift)) {
        setText(dashShift, 'Đã check-out', 'Checked out');
      }
      setHidden(handoverReq, false);
    });
  }

  /* ================================================================
     10. HOSPITAL PORTAL — SBAR FORM
     ================================================================ */

  function initSbar() {
    const form = $('#sbar-form');
    const btnDraft = $('#btn-sbar-draft');
    const btnSubmit = $('#btn-sbar-submit');
    const status = $('#sbar-status');
    if (!exists(form)) return;
    const handoverId = $('#sbar-handover-id');
    const csrfToken = $('#sbar-csrf-token');
    const historyBody = $('#sbar-history-body');
    let requestInFlight = false;

    function collectFields() {
      return {
        case_ref: ($('#sbar-case-ref') || {}).value || '',
        situation: ($('#sbar-situation') || {}).value || '',
        background: ($('#sbar-background') || {}).value || '',
        assessment: ($('#sbar-assessment') || {}).value || '',
        recommendation: ($('#sbar-recommendation') || {}).value || '',
        handover_id: handoverId ? handoverId.value : '',
        csrf_token: csrfToken ? csrfToken.value : '',
      };
    }

    function languageText(viText, enText, className) {
      const vi = document.createElement('span');
      vi.className = 'lang-vi';
      vi.textContent = viText;
      const en = document.createElement('span');
      en.className = 'lang-en';
      en.textContent = enText;
      const container = document.createElement('span');
      if (className) container.className = className;
      container.append(vi, en);
      return container;
    }

    function appendHistoryMessage(viText, enText) {
      if (!exists(historyBody)) return;
      const row = document.createElement('tr');
      row.id = 'sbar-history-empty';
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty-cell';
      cell.appendChild(languageText(viText, enText));
      row.appendChild(cell);
      historyBody.replaceChildren(row);
    }

    function formatHistoryTime(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const locale = document.body.classList.contains('lang-en-active')
        ? 'en-US'
        : 'vi-VN';
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    }

    function roleLabels(role) {
      const labels = {
        'shift-lead': ['Bác sĩ trưởng ca', 'Shift lead'],
        treating: ['Bác sĩ điều trị', 'Treating physician'],
        nurse: ['Điều dưỡng', 'Nurse'],
      };
      return labels[role] || [formatValue(role), formatValue(role)];
    }

    function statusLabels(value) {
      if (value === 'draft') return ['Bản nháp', 'Draft'];
      if (value === 'submitted') return ['Đã gửi', 'Submitted'];
      return [formatValue(value), formatValue(value)];
    }

    function renderHistory(handovers) {
      if (!exists(historyBody)) return;
      if (!Array.isArray(handovers) || handovers.length === 0) {
        appendHistoryMessage(
          'Chưa có bàn giao nào được ghi nhận',
          'No handovers recorded yet'
        );
        return;
      }

      const rows = handovers.map((handover) => {
        const row = document.createElement('tr');
        const values = [
          formatValue(handover.handover_id),
          formatHistoryTime(handover.timestamp),
          roleLabels(handover.staff_role),
          statusLabels(handover.status),
        ];
        values.forEach((value, index) => {
          const cell = document.createElement('td');
          if (index < 2) {
            cell.textContent = value;
          } else {
            cell.appendChild(languageText(value[0], value[1]));
          }
          row.appendChild(cell);
        });
        return row;
      });
      historyBody.replaceChildren(...rows);
    }

    function localizedApiMessage(error, fallbackVi, fallbackEn) {
      const payload = error && error.payload;
      if (payload && payload.message_vi && payload.message_en) {
        return [payload.message_vi, payload.message_en];
      }
      return [fallbackVi, fallbackEn];
    }

    async function loadHistory() {
      try {
        const response = await fetchJson('/api/sbar', { method: 'GET' });
        if (!response || response.success !== true || !response.data) {
          throw apiError('Invalid handover history response.', 500, response);
        }
        renderHistory(response.data.handovers);
      } catch (error) {
        const message = localizedApiMessage(
          error,
          'Không thể tải lịch sử bàn giao. Vui lòng thử tải lại trang.',
          'Could not load handover history. Please refresh the page.'
        );
        appendHistoryMessage(message[0], message[1]);
      }
    }

    async function saveHandover(isDraft) {
      if (requestInFlight) return;
      requestInFlight = true;
      disableBtn(btnDraft, true);
      disableBtn(btnSubmit, true);
      showStatus(
        status,
        isDraft ? 'Đang lưu bản nháp…' : 'Đang gửi bàn giao…',
        isDraft ? 'Saving draft…' : 'Submitting handover…',
        'processing'
      );

      try {
        const data = collectFields();
        const response = await fetchJson(
          isDraft ? '/api/sbar/drafts' : '/api/sbar',
          {
            method: 'POST',
            headers: { 'X-CSRF-Token': data.csrf_token },
            body: JSON.stringify(data),
          }
        );
        if (!response || response.success !== true || !response.data) {
          throw apiError('The server did not confirm the handover.', 500, response);
        }

        if (isDraft && handoverId) {
          handoverId.value = response.data.handover_id;
        }
        if (!isDraft) {
          ['sbar-case-ref', 'sbar-situation', 'sbar-background',
            'sbar-assessment', 'sbar-recommendation'].forEach((id) => {
            const field = document.getElementById(id);
            if (field) field.value = '';
          });
          if (handoverId) handoverId.value = '';
        }

        const message = [
          response.message_vi || (isDraft ? 'Đã lưu bản nháp bàn giao.' : 'Đã gửi bàn giao thành công.'),
          response.message_en || (isDraft ? 'Handover draft saved.' : 'Handover submitted successfully.'),
        ];
        showStatus(status, message[0], message[1], 'success');
        await loadHistory();
      } catch (error) {
        const message = localizedApiMessage(
          error,
          'Không thể lưu bàn giao. Vui lòng kiểm tra kết nối và thử lại.',
          'The handover could not be saved. Check your connection and try again.'
        );
        showStatus(status, message[0], message[1], 'error');
      } finally {
        requestInFlight = false;
        disableBtn(btnDraft, false);
        disableBtn(btnSubmit, false);
      }
    }

    if (exists(btnDraft)) {
      btnDraft.addEventListener('click', () => saveHandover(true));
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveHandover(false);
    });

    loadHistory();
  }

  /* ================================================================
     11. HOSPITAL PORTAL — SHARED RECORD PACKET VIEWER
     ================================================================ */

  const PACKET_EXPLORER_BASE = 'https://testnet.snowtrace.io/tx/';
  const PACKET_REQUEST_TIMEOUT_MS = 15000;

  function apiError(message, status, payload) {
    const error = new Error(message);
    error.status = status;
    error.payload = payload;
    return error;
  }

  async function fetchJson(url, options = {}) {
    const { headers = {}, ...rest } = options;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      PACKET_REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        ...rest,
        headers: {
          Accept: 'application/json',
          ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json() : null;
      const redirectedToLogin =
        response.redirected && /\/login(?:$|[?#])/.test(response.url);

      if (redirectedToLogin || (response.ok && !isJson)) {
        throw apiError(
          'Your session has expired. Please sign in again.',
          401,
          payload
        );
      }

      if (!response.ok) {
        const message =
          payload && (payload.message || payload.error)
            ? payload.message || payload.error
            : `Request failed (${response.status}).`;
        throw apiError(message, response.status, payload);
      }

      return payload;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw apiError('The request timed out. Please try again.', 408, null);
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function formatValue(value, fallback = '—') {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function setFieldValue(selector, value, fallback = '—') {
    const el = $(selector);
    if (!exists(el)) return;
    el.textContent = formatValue(value, fallback);
  }

  function setPacketBadge(selector, value, fallbackType = 'neutral') {
    const el = $(selector);
    if (!exists(el)) return;

    const label = formatValue(value, 'Unknown');
    const normalized = slugify(label);
    const badgeTypes = {
      verified: 'success',
      active: 'success',
      complete: 'success',
      completed: 'success',
      normal: 'success',
      pending: 'pending',
      high: 'high',
      low: 'low',
      abnormal: 'abnormal',
      inactive: 'failed',
      revoked: 'failed',
      failed: 'failed',
      critical: 'critical',
    };
    const type = badgeTypes[normalized] || fallbackType;

    el.textContent = label;
    el.className = `record-badge record-badge--${type}`;
  }

  function showRevokedConsentAlert() {
    const isEnglish = document.body.classList.contains('lang-en-active');
    window.alert(
      isEnglish
        ? 'Consent has been revoked. Record access is no longer available.'
        : 'Đồng thuận đã bị thu hồi. Không thể truy cập hồ sơ.'
    );
  }

  function hidePacketView() {
    setHidden($('#packet-content'), true);
    setHidden($('#packet-empty'), false);
    setHidden($('#record-access-lock'), false);
  }

  function getRecordIdFromContext(preferred) {
    const preferredId = formatValue(preferred, '');
    if (preferredId) return preferredId;

    const panel = $('#packet-panel');
    const panelRecordId = panel && panel.dataset ? panel.dataset.recordId : '';
    if (panelRecordId && panelRecordId.trim()) return panelRecordId.trim();

    try {
      const queryId = new URLSearchParams(window.location.search).get('record_id');
      if (queryId && queryId.trim()) return queryId.trim();
    } catch {
      /* ignore malformed URL */
    }

    const recordIdEl = $('#packet-record-id');
    const displayedId = recordIdEl ? recordIdEl.textContent.trim() : '';
    if (displayedId && displayedId !== '—' && displayedId !== '-') {
      return displayedId;
    }

    return '';
  }

  function renderRecordTable(labResults) {
    const table = $('#packet-record-table');
    const tbody = table ? table.querySelector('tbody') : null;
    if (!exists(tbody)) return;

    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

    const rows = Array.isArray(labResults) ? labResults : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty-cell';
      const vi = document.createElement('span');
      vi.className = 'lang-vi';
      vi.textContent = 'Không có kết quả xét nghiệm.';
      const en = document.createElement('span');
      en.className = 'lang-en';
      en.textContent = 'No laboratory results are available.';
      td.appendChild(vi);
      td.appendChild(en);
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((test) => {
      if (!test || typeof test !== 'object') return;

      const tr = document.createElement('tr');
      const values = [
        test.test_name || test.name || '—',
        test.result !== undefined ? test.result : test.result_value,
        test.unit,
        test.reference_range || test.referenceRange,
      ];

      values.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = formatValue(value);
        tr.appendChild(td);
      });

      const statusTd = document.createElement('td');
      const badge = document.createElement('span');
      const status = formatValue(test.status, 'Unknown');
      const statusType =
        {
          normal: 'success',
          high: 'high',
          low: 'low',
          abnormal: 'abnormal',
          critical: 'critical',
          pending: 'pending',
        }[slugify(status)] || 'neutral';
      badge.className = `record-badge record-badge--${statusType}`;
      badge.textContent = status;
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);
      tbody.appendChild(tr);
    });
  }

  function renderAuditTimeline(events) {
    const timeline = $('#packet-audit-timeline');
    if (!exists(timeline)) return;

    while (timeline.firstChild) timeline.removeChild(timeline.firstChild);

    const items = Array.isArray(events) ? events : [];
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'audit-event audit-event--pending';
      const marker = document.createElement('span');
      marker.className = 'audit-event__marker';
      marker.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      content.className = 'audit-event__content';
      const title = document.createElement('h4');
      title.className = 'audit-event__title';
      title.textContent = 'No audit events recorded';
      content.appendChild(title);
      li.appendChild(marker);
      li.appendChild(content);
      timeline.appendChild(li);
      return;
    }

    items.forEach((event) => {
      if (!event || typeof event !== 'object') return;

      const status = slugify(event.status || 'complete') || 'complete';
      const li = document.createElement('li');
      li.className = `audit-event audit-event--${status}`;

      const marker = document.createElement('span');
      marker.className = 'audit-event__marker';
      marker.setAttribute('aria-hidden', 'true');

      const content = document.createElement('div');
      content.className = 'audit-event__content';

      const head = document.createElement('div');
      head.className = 'audit-event__head';

      const title = document.createElement('h4');
      title.className = 'audit-event__title';
      title.textContent = formatValue(event.label || event.type, 'Audit Event');

      const time = document.createElement('time');
      time.className = 'audit-event__time';
      time.textContent = formatValue(
        event.time || event.timestamp || event.datetime
      );
      if (event.datetime) time.setAttribute('datetime', String(event.datetime));

      head.appendChild(title);
      head.appendChild(time);

      const description = document.createElement('p');
      description.className = 'audit-event__desc';
      description.textContent = formatValue(event.description, '');

      content.appendChild(head);
      if (description.textContent) content.appendChild(description);

      li.appendChild(marker);
      li.appendChild(content);
      timeline.appendChild(li);
    });
  }

  function unlockRecordView(record, consent) {
    if (!record || typeof record !== 'object') {
      hidePacketView();
      return false;
    }

    const consentActive =
      consent && typeof consent.active === 'boolean'
        ? consent.active === true
        : record.consent_active === true || record.consent_status === 'Active';

    if (!consentActive) {
      hidePacketView();
      return false;
    }

    setFieldValue('#packet-record-id', record.record_id || record.recordId);
    setFieldValue('#packet-record-type', record.record_type || record.recordType);
    setPacketBadge(
      '#packet-verification-status',
      record.verification_status || record.verificationStatus,
      'pending'
    );
    setFieldValue(
      '#packet-patient-id',
      record.patient_identifier || record.patientIdentifier
    );
    setFieldValue('#packet-upload-date', record.uploaded_date || record.uploadDate);

    setFieldValue('#packet-scope', record.consent_scope || record.scope, '');
    setFieldValue('#packet-expiry', record.consent_expiry || record.expiry, '');

    const consentStatus =
      record.consent_status || (consentActive ? 'Active' : 'Inactive');
    setFieldValue('#packet-consent', consentStatus);
    setFieldValue(
      '#packet-consent-scope',
      record.consent_scope || record.scope,
      ''
    );
    setFieldValue(
      '#packet-consent-expiry',
      record.consent_expiry || record.expiry,
      ''
    );

    renderRecordTable(record.lab_results || record.labResults || []);
    renderAuditTimeline(
      record.audit_events || record.auditEvents || record.audit_timeline || []
    );

    const txHash = formatValue(record.tx_hash || record.txHash, '');
    const txHashEl = $('#packet-tx-hash');
    const txLink = $('#packet-tx-link');
    const txState = $('#packet-tx-state');

    if (exists(txHashEl)) txHashEl.textContent = txHash || '—';

    if (exists(txLink)) {
      if (txHash) {
        txLink.href = `${PACKET_EXPLORER_BASE}${encodeURIComponent(txHash)}`;
        setHidden(txLink, false);
      } else {
        txLink.removeAttribute('href');
        setHidden(txLink, true);
      }
    }

    if (exists(txState)) {
      txState.className = txHash
        ? 'tx-state tx-state--success'
        : 'tx-state tx-state--idle';
    }

    setHidden($('#packet-empty'), true);
    setHidden($('#record-access-lock'), true);
    setHidden($('#packet-content'), false);
    return true;
  }

  async function loadSharedRecord(recordId) {
    const resolvedId = getRecordIdFromContext(recordId);
    if (!resolvedId) {
      throw apiError('Record ID is required.', 400, null);
    }

    const payload = await fetchJson(
      `/api/shared-records/${encodeURIComponent(resolvedId)}`
    );
    const record =
      payload && (payload.data || payload.record)
        ? payload.data || payload.record
        : payload;

    if (!record || typeof record !== 'object' || !Object.keys(record).length) {
      throw apiError('Shared record data is unavailable.', 502, payload);
    }

    return record;
  }

  async function verifyConsent(token) {
    const inputEl = $('#consent-token-input');
    const value = String(
      token !== undefined && token !== null
        ? token
        : inputEl
          ? inputEl.value
          : ''
    ).trim();

    if (!value) {
      throw apiError('Consent token is required.', 400, null);
    }

    let payload;
    try {
      payload = await fetchJson('/api/consent/verify', {
        method: 'POST',
        body: JSON.stringify({ token: value }),
      });
    } catch (err) {
      const code =
        err && err.payload
          ? err.payload.error_code || err.payload.error || ''
          : '';
      if (
        err &&
        err.status === 403 &&
        ['CONSENT_INACTIVE', 'CONSENT_REVOKED', 'REVOKED'].includes(code)
      ) {
        showRevokedConsentAlert();
        return {
          exists: true,
          active: false,
          record_id: getRecordIdFromContext(value),
        };
      }
      throw err;
    }

    const result =
      payload && payload.data && typeof payload.data.active === 'boolean'
        ? payload.data
        : payload;
    const exists = Boolean(result && result.exists === true);
    const active = Boolean(result && result.active === true);
    const recordId =
      (result && (result.record_id || result.recordId)) ||
      getRecordIdFromContext(value);

    if (exists && !active) showRevokedConsentAlert();

    return { exists, active, record_id: recordId };
  }

  async function handleSharedRecordAccess(rawToken) {
    const inputEl = $('#consent-token-input');
    const token = String(
      rawToken !== undefined && rawToken !== null
        ? rawToken
        : inputEl
          ? inputEl.value
          : ''
    ).trim();
    const verifyStatus = $('#verify-status');
    const verifyBtn = $('#btn-verify-token');

    if (!token) {
      showStatus(
        verifyStatus,
        'Vui lòng nhập token hoặc quét QR.',
        'Please enter a token or scan a QR.',
        'error'
      );
      hidePacketView();
      return false;
    }

    showStatus(
      verifyStatus,
      'Đang xác minh đồng thuận…',
      'Verifying consent…',
      'processing'
    );
    disableBtn(verifyBtn, true);
    hidePacketView();

    try {
      if (!window.MediLinkConsent) {
        throw new Error('Consent client is unavailable.');
      }
      const connection = await window.MediLinkConsent.connect();
      const ownerInput = $('#consent-owner-input');
      const recordRefInput = $('#consent-record-ref-input');
      const ownerAddress = ownerInput ? ownerInput.value.trim() : '';
      const recordRef = recordRefInput ? recordRefInput.value.trim() : '';
      if (!ownerAddress || !recordRef) {
        throw new Error('Patient wallet and opaque record reference are required.');
      }
      if (token !== recordRef) {
        showStatus(
          verifyStatus,
          'Token phải trùng với mã hồ sơ ẩn danh đã được bệnh nhân chia sẻ.',
          'The token must match the opaque record reference shared by the patient.',
          'error'
        );
        return false;
      }
      const chainConsent = await window.MediLinkConsent.getConsentStatus(
        ownerAddress,
        connection.address,
        recordRef
      );
      const auditWallet = $('#audit-wallet');
      const auditConsent = $('#audit-consent');
      if (exists(auditWallet)) setText(auditWallet, connection.address, connection.address);
      if (exists(auditConsent)) {
        setText(
          auditConsent,
          chainConsent.active ? 'Đang có hiệu lực trên chuỗi' : 'Không có đồng thuận đang hoạt động',
          chainConsent.active ? 'Active on-chain' : 'No active on-chain consent'
        );
      }
      if (!chainConsent.exists) {
        showStatus(
          verifyStatus,
          'Không tìm thấy đồng thuận trên Avalanche Fuji.',
          'No consent was found on Avalanche Fuji.',
          'error'
        );
        return false;
      }
      if (!chainConsent.active) {
        showStatus(
          verifyStatus,
          'Đồng thuận đã bị thu hồi. Gói hồ sơ vẫn bị khóa.',
          'Consent has been revoked. The packet remains locked.',
          'error'
        );
        return false;
      }

      const consent = await verifyConsent(token);

      if (!consent.exists) {
        showStatus(
          verifyStatus,
          'Không tìm thấy đồng thuận cho token này.',
          'No consent was found for this token.',
          'error'
        );
        return false;
      }

      if (consent.active !== true) {
        showStatus(
          verifyStatus,
          'Đồng thuận không còn hiệu lực. Hồ sơ vẫn bị khóa.',
          'Consent is not active. The record remains locked.',
          'error'
        );
        return false;
      }

      const record = await loadSharedRecord(consent.record_id || token);
      if (!unlockRecordView(record, consent)) {
        showStatus(
          verifyStatus,
          'Không thể mở hồ sơ vì đồng thuận không hoạt động.',
          'Unable to unlock the record because consent is not active.',
          'error'
        );
        return false;
      }

      showStatus(
        verifyStatus,
        'Đồng thuận hợp lệ. Hồ sơ đã được mở khóa.',
        'Consent verified. The shared record has been unlocked.',
        'success'
      );
      return true;
    } catch (err) {
      hidePacketView();
      const client = window.MediLinkConsent;
      const messageVi = client
        ? client.describeError(err, 'vi')
        : 'Không thể xác minh đồng thuận trên chuỗi. Hãy thử lại.';
      const messageEn = client
        ? client.describeError(err, 'en')
        : 'Unable to verify on-chain consent. Please try again.';
      showStatus(
        verifyStatus,
        messageVi,
        messageEn,
        'error'
      );
      return false;
    } finally {
      disableBtn(verifyBtn, false);
    }
  }

  /* ================================================================
     12. HOSPITAL PORTAL — QR SCANNER & TOKEN VERIFY
     ================================================================ */

  let html5QrCodeInstance = null;

  function initQrScanner() {
    const btnStart = $('#btn-start-scan');
    const btnStop = $('#btn-stop-scan');
    const btnVerify = $('#btn-verify-token');
    const tokenInput = $('#consent-token-input');
    const verifyStatus = $('#verify-status');
    const reader = $('#qr-reader');
    if (!exists(btnStart) && !exists(btnVerify)) return;

    hidePacketView();

    function onScanSuccess(decodedText) {
      if (exists(tokenInput)) tokenInput.value = decodedText;
      stopScanner();
      handleSharedRecordAccess(decodedText);
    }

    function startScanner() {
      if (typeof Html5Qrcode === 'undefined') {
        showStatus(
          verifyStatus,
          'Thư viện quét QR chưa được tải (html5-qrcode).',
          'QR scanner library not loaded (html5-qrcode).',
          'error'
        );
        return;
      }
      if (!exists(reader)) return;

      // Clear placeholder
      const placeholder = reader.querySelector('.qr-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      html5QrCodeInstance = new Html5Qrcode('qr-reader');
      html5QrCodeInstance
        .start(
          { facingMode: 'environment' },
          { fps: 8, qrbox: { width: 220, height: 220 } },
          onScanSuccess,
          () => {} // ignore scan failures
        )
        .then(() => {
          disableBtn(btnStart, true);
          disableBtn(btnStop, false);
        })
        .catch((err) => {
          showStatus(
            verifyStatus,
            'Không thể mở camera. Kiểm tra quyền hoặc dùng nhập thủ công.',
            'Cannot open camera. Check permissions or use manual entry.',
            'error'
          );
          console.warn('QR start error', err);
        });
    }

    function stopScanner() {
      if (html5QrCodeInstance) {
        html5QrCodeInstance
          .stop()
          .then(() => {
            html5QrCodeInstance.clear();
            html5QrCodeInstance = null;
          })
          .catch(() => {
            html5QrCodeInstance = null;
          });
      }
      disableBtn(btnStart, false);
      disableBtn(btnStop, true);
      const placeholder = reader && reader.querySelector('.qr-placeholder');
      if (placeholder) placeholder.style.display = '';
    }

    if (exists(btnStart)) btnStart.addEventListener('click', startScanner);
    if (exists(btnStop)) btnStop.addEventListener('click', stopScanner);

    if (exists(btnVerify)) {
      btnVerify.addEventListener('click', () => {
        handleSharedRecordAccess();
      });
    }

    // Release camera on page hide
    window.addEventListener('pagehide', stopScanner);
  }

  /* ================================================================
     13. BLOCKCHAIN AUDIT PANEL (staff)
     ================================================================ */

  function initAuditPanel() {
    const walletEl = $('#audit-wallet');
    if (!exists(walletEl)) return;
    const connectBtn = $('#btn-audit-connect');
    const contractEl = $('#audit-contract-address');
    const txIdle = $('#audit-tx-idle');
    const txPending = $('#audit-tx-pending');
    const txSuccess = $('#audit-tx-success');
    const txFailed = $('#audit-tx-failed');

    if (window.MediLinkConsent && exists(contractEl)) {
      contractEl.textContent =
        window.MediLinkConsent.getConfig().contractAddress || '—';
    }

    if (!window.ethereum) {
      setText(walletEl, 'Chưa cài MetaMask', 'MetaMask not installed');
      return;
    }
    setText(walletEl, 'Chưa kết nối', 'Not connected');

    if (exists(connectBtn)) {
      connectBtn.addEventListener('click', async () => {
        disableBtn(connectBtn, true);
        [txIdle, txPending, txSuccess, txFailed].forEach((el) => setHidden(el, true));
        setHidden(txPending, false);
        try {
          if (!window.MediLinkConsent) {
            throw new Error('Consent client is unavailable.');
          }
          const connection = await window.MediLinkConsent.connect();
          setText(walletEl, connection.address, connection.address);
          walletEl.classList.remove('status-value--disconnected');
          walletEl.classList.add('status-value--connected');
          const dashboardStatus = $('#dash-blockchain-status');
          if (isConsentConfigured()) {
            setText(dashboardStatus, 'Đã kết nối Fuji', 'Connected to Fuji');
          } else {
            setConsentConfigWarning(dashboardStatus);
          }
          if (exists(dashboardStatus)) {
            dashboardStatus.classList.remove('status-value--disconnected');
            dashboardStatus.classList.add('status-value--connected');
          }
          setHidden(txPending, true);
          setHidden(txIdle, false);
        } catch (error) {
          setHidden(txPending, true);
          setHidden(txFailed, false);
          const errorEl = $('#audit-tx-error');
          if (exists(errorEl)) {
            errorEl.textContent = window.MediLinkConsent
              ? window.MediLinkConsent.describeError(error)
              : (document.body.classList.contains('lang-en-active')
                ? 'Consent client unavailable. Reload the page and try again.'
                : 'Không tải được tiện ích đồng thuận. Hãy tải lại trang và thử lại.');
          }
          setText(walletEl, 'Kết nối thất bại', 'Connection failed');
        } finally {
          disableBtn(connectBtn, false);
        }
      });
    }
  }

  function initRecordDetailsConsent() {
    const verifyBtn = $('#verify-consent-btn');
    if (!exists(verifyBtn)) return;
    const statusEl = $('#consent-status');
    const badgeEl = $('#record-consent-badge');
    const walletEl = $('#wallet-status');
    const contractEl = $('#contract-address');
    const txHashEl = $('#tx-hash');
    const txLink = $('#view-transaction-btn');

    if (window.MediLinkConsent && exists(contractEl)) {
      contractEl.textContent =
        window.MediLinkConsent.getConfig().contractAddress || '—';
    }
    verifyBtn.addEventListener('click', async () => {
      disableBtn(verifyBtn, true);
      try {
        if (!window.MediLinkConsent) {
          throw new Error('Consent client is unavailable.');
        }
        const connection = await window.MediLinkConsent.connect();
        const ownerInput = $('#record-consent-owner');
        const recordRefInput = $('#record-consent-ref');
        const owner = ownerInput ? ownerInput.value.trim() : '';
        const recordRef = recordRefInput ? recordRefInput.value.trim() : '';
        if (!owner || !recordRef) {
          throw new Error('Patient wallet and opaque record reference are required.');
        }
        const result = await window.MediLinkConsent.getConsentStatus(
          owner,
          connection.address,
          recordRef
        );
        if (exists(walletEl)) walletEl.textContent = connection.address;
        const text = !result.exists
          ? ['Không tìm thấy', 'Not found']
          : result.active
            ? ['Đang có hiệu lực', 'Active']
            : ['Đã thu hồi', 'Revoked'];
        setText(statusEl, text[0], text[1]);
        setText(
          badgeEl,
          `Đồng thuận ${text[0].toLowerCase()}`,
          `Consent ${text[1].toLowerCase()}`
        );
        if (exists(statusEl)) {
          statusEl.className = result.active
            ? 'status-value status-value--verified'
            : 'status-value status-value--disconnected';
        }
      } catch (error) {
        const client = window.MediLinkConsent;
        const message = client
          ? client.describeError(error)
          : (document.body.classList.contains('lang-en-active')
            ? 'Consent client unavailable. Reload the page and try again.'
            : 'Không tải được tiện ích đồng thuận. Hãy tải lại trang và thử lại.');
        if (exists(statusEl)) setText(statusEl, message, message);
        if (exists(badgeEl)) setText(badgeEl, 'Chưa xác minh', 'Not verified');
      } finally {
        disableBtn(verifyBtn, false);
      }
    });

    if (exists(txHashEl) && txHashEl.textContent.trim() === '—' && exists(txLink)) {
      setHidden(txLink, true);
    }
    if (window.ethereum && typeof window.ethereum.on === 'function') {
      window.ethereum.on('accountsChanged', () => {
        setText(statusEl, 'Chưa xác minh', 'Not verified');
        setText(badgeEl, 'Đồng thuận chưa xác minh', 'Consent not verified');
      });
      window.ethereum.on('chainChanged', () => {
        setText(statusEl, 'Chưa xác minh', 'Not verified');
        setText(badgeEl, 'Đồng thuận chưa xác minh', 'Consent not verified');
      });
    }
  }

  function initBlockchainConfiguration() {
    if (isConsentConfigured()) return;

    const patientStatus = $('#consent-status-value');
    const grantButton = $('#btn-grant-consent');
    const revokeButton = $('#btn-revoke-consent');
    const auditConsent = $('#audit-consent');
    const dashboardStatus = $('#dash-blockchain-status');
    const verifyStatus = $('#verify-status');
    const hospitalVerifyButton = $('#btn-verify-token');
    const recordStatus = $('#consent-status');
    const recordBadge = $('#record-consent-badge');
    const recordVerifyButton = $('#verify-consent-btn');
    const notConfigured = document.body.classList.contains('lang-en-active')
      ? 'Not configured'
      : 'Chưa cấu hình';

    setConsentConfigWarning(patientStatus);
    if (exists(patientStatus)) {
      patientStatus.classList.remove('status-value--connected');
      patientStatus.classList.add('status-value--disconnected');
    }
    if (exists($('#patient-contract-address'))) {
      $('#patient-contract-address').textContent = notConfigured;
    }
    disableBtn(grantButton, true);
    disableBtn(revokeButton, true);

    setConsentConfigWarning(auditConsent);
    setConsentConfigWarning(dashboardStatus);
    if (exists($('#audit-contract-address'))) {
      $('#audit-contract-address').textContent = notConfigured;
    }
    if (exists(verifyStatus)) {
      showStatus(
        verifyStatus,
        'Chưa cấu hình địa chỉ hợp đồng đồng thuận. Hãy đặt CONSENT_CONTRACT_ADDRESS trong .env.',
        'Consent contract address is not configured. Set CONSENT_CONTRACT_ADDRESS in .env.',
        'error'
      );
    }
    disableBtn(hospitalVerifyButton, true);

    if (exists(recordVerifyButton)) {
      setConsentConfigWarning(recordStatus);
      setConsentConfigWarning(recordBadge);
      if (exists($('#contract-address'))) {
        $('#contract-address').textContent = notConfigured;
      }
      disableBtn(recordVerifyButton, true);
    }
  }

  /* ================================================================
     14. INITIALIZATION
     ================================================================ */

  function init() {
    initLanguage();
    initTheme();
    initMobileNav();
    initLogin();
    initOcrUpload();
    initFollowUp();
    initPatientConsent();
    initShift();
    initSbar();
    initQrScanner();
    initAuditPanel();
    initRecordDetailsConsent();
    initBlockchainConfiguration();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();