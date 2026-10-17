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
    msg.innerHTML =
      `<span class="lang-vi">${messageVi}</span>` +
      `<span class="lang-en">${messageEn}</span>`;
    container.innerHTML = '';
    container.appendChild(msg);
  }

  function disableBtn(btn, disabled = true) {
    if (!exists(btn)) return;
    btn.disabled = !!disabled;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
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
    if (!exists(input)) return;

    function resetOcr() {
      input.value = '';
      if (exists(previewContent)) previewContent.innerHTML = '';
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
        showStatus(
          status,
          'Tệp vượt quá 10 MB. Vui lòng chọn tệp nhỏ hơn.',
          'File exceeds 10 MB. Please choose a smaller file.',
          'error'
        );
        resetOcr();
        return;
      }

      const typeOk =
        OCR_ACCEPT.includes(file.type) ||
        /\.(pdf|jpe?g|png)$/i.test(file.name);
      if (!typeOk) {
        showStatus(
          status,
          'Định dạng không hỗ trợ. Chỉ nhận PDF, JPG, PNG.',
          'Unsupported format. Only PDF, JPG, PNG are accepted.',
          'error'
        );
        resetOcr();
        return;
      }

      disableBtn(clearBtn, false);
      setHidden(status, true);
      setHidden(result, true);

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

      // No automatic upload — backend route not assumed
      showStatus(
        status,
        'Tệp đã sẵn sàng. OCR sẽ chạy khi backend được kết nối (prototype).',
        'File ready. OCR will run when the backend is connected (prototype).',
        'idle'
      );
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
    const statusValue = $('#consent-status-value');
    const qrArea = $('#consent-qr-area');
    const txIdle = $('#tx-state-idle');
    const txPending = $('#tx-state-pending');
    const txSuccess = $('#tx-state-success');
    const txFailed = $('#tx-state-failed');
    if (!exists(btnConnect)) return;

    function setTxState(state) {
      [txIdle, txPending, txSuccess, txFailed].forEach((el) => setHidden(el, true));
      if (state === 'pending') setHidden(txPending, false);
      else if (state === 'success') setHidden(txSuccess, false);
      else if (state === 'failed') setHidden(txFailed, false);
      else setHidden(txIdle, false);
    }

    btnConnect.addEventListener('click', async () => {
      // Prototype: only attempt real connection if ethereum + config exist
      if (typeof window.ethereum === 'undefined') {
        if (exists(statusValue)) {
          setText(
            statusValue,
            'MetaMask chưa được cài đặt (prototype)',
            'MetaMask not installed (prototype)'
          );
        }
        setTxState('failed');
        const errEl = $('#tx-error-msg');
        if (exists(errEl)) {
          errEl.textContent = document.body.classList.contains('lang-en-active')
            ? 'Install MetaMask or use a wallet-enabled browser.'
            : 'Cài MetaMask hoặc dùng trình duyệt hỗ trợ ví.';
        }
        return;
      }

      disableBtn(btnConnect, true);
      setTxState('pending');

      try {
        // Request accounts — user gesture required
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        });
        if (!accounts || !accounts.length) {
          throw new Error('No accounts');
        }

        // Check chain (Avalanche Fuji = 43113 / 0xa869)
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const fuji = '0xa869';
        if (chainId !== fuji) {
          if (exists(statusValue)) {
            setText(
              statusValue,
              'Sai mạng — hãy chuyển sang Avalanche Fuji (43113)',
              'Wrong network — switch to Avalanche Fuji (43113)'
            );
          }
          // Attempt switch if wallet supports it
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: fuji }],
            });
          } catch (switchErr) {
            setTxState('failed');
            const errEl = $('#tx-error-msg');
            if (exists(errEl)) {
              errEl.textContent = document.body.classList.contains('lang-en-active')
                ? 'Please switch to Avalanche Fuji testnet manually.'
                : 'Vui lòng chuyển sang Avalanche Fuji testnet thủ công.';
            }
            disableBtn(btnConnect, false);
            return;
          }
        }

        if (exists(statusValue)) {
          setText(
            statusValue,
            'Ví đã kết nối (prototype — chưa ghi on-chain)',
            'Wallet connected (prototype — no on-chain write yet)'
          );
          statusValue.classList.remove('status-value--disconnected');
          statusValue.classList.add('status-value--connected');
        }

        // Do NOT show QR or success tx unless a real consent token/tx exists
        setHidden(qrArea, true);
        setTxState('idle');
      } catch (err) {
        setTxState('failed');
        if (exists(statusValue)) {
          setText(
            statusValue,
            'Kết nối bị từ chối hoặc thất bại',
            'Connection rejected or failed'
          );
        }
        const errEl = $('#tx-error-msg');
        if (exists(errEl)) {
          errEl.textContent = document.body.classList.contains('lang-en-active')
            ? 'User rejected or wallet error.'
            : 'Người dùng từ chối hoặc lỗi ví.';
        }
      } finally {
        disableBtn(btnConnect, false);
      }
    });
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

    function collectFields() {
      return {
        case_ref: ($('#sbar-case-ref') || {}).value || '',
        situation: ($('#sbar-situation') || {}).value || '',
        background: ($('#sbar-background') || {}).value || '',
        assessment: ($('#sbar-assessment') || {}).value || '',
        recommendation: ($('#sbar-recommendation') || {}).value || '',
      };
    }

    function validateSbar(data) {
      if (!data.situation.trim() || !data.assessment.trim() || !data.recommendation.trim()) {
        return false;
      }
      return true;
    }

    if (exists(btnDraft)) {
      btnDraft.addEventListener('click', () => {
        const data = collectFields();
        // Prototype: local only — no server call assumed
        showStatus(
          status,
          'Nháp đã lưu cục bộ (prototype — chưa gửi máy chủ).',
          'Draft saved locally (prototype — not sent to server).',
          'idle'
        );
        try {
          sessionStorage.setItem('medilink-sbar-draft', JSON.stringify(data));
        } catch {
          /* ignore */
        }
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault(); // Prevent real submit until backend exists
      const data = collectFields();
      if (!validateSbar(data)) {
        showStatus(
          status,
          'Vui lòng điền Situation, Assessment và Recommendation.',
          'Please fill Situation, Assessment and Recommendation.',
          'error'
        );
        return;
      }
      disableBtn(btnSubmit, true);
      showStatus(
        status,
        'Prototype: bàn giao chưa được gửi. Cần endpoint backend để lưu.',
        'Prototype: handover not submitted. Backend endpoint required.',
        'idle'
      );
      disableBtn(btnSubmit, false);
    });

    // Restore draft if present
    try {
      const raw = sessionStorage.getItem('medilink-sbar-draft');
      if (raw) {
        const data = safeJsonParse(raw);
        if (data) {
          const map = {
            'sbar-case-ref': data.case_ref,
            'sbar-situation': data.situation,
            'sbar-background': data.background,
            'sbar-assessment': data.assessment,
            'sbar-recommendation': data.recommendation,
          };
          Object.keys(map).forEach((id) => {
            const el = document.getElementById(id);
            if (exists(el) && map[id]) el.value = map[id];
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  /* ================================================================
     11. HOSPITAL PORTAL — QR SCANNER & TOKEN VERIFY
     ================================================================ */

  let html5QrCodeInstance = null;

  function initQrScanner() {
    const btnStart = $('#btn-start-scan');
    const btnStop = $('#btn-stop-scan');
    const btnVerify = $('#btn-verify-token');
    const tokenInput = $('#consent-token-input');
    const verifyStatus = $('#verify-status');
    const reader = $('#qr-reader');
    const lock = $('#record-access-lock');
    const packetEmpty = $('#packet-empty');
    const packetContent = $('#packet-content');
    if (!exists(btnStart) && !exists(btnVerify)) return;

    function onScanSuccess(decodedText) {
      if (exists(tokenInput)) tokenInput.value = decodedText;
      stopScanner();
      showStatus(
        verifyStatus,
        'Đã quét token. Đang chờ xác minh backend (prototype).',
        'Token scanned. Awaiting backend verification (prototype).',
        'idle'
      );
      // Do NOT unlock packet here — backend must confirm
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

    // Manual token verify — prototype only
    if (exists(btnVerify)) {
      btnVerify.addEventListener('click', () => {
        const token = (tokenInput && tokenInput.value.trim()) || '';
        if (!token) {
          showStatus(
            verifyStatus,
            'Vui lòng nhập token hoặc quét QR.',
            'Please enter a token or scan a QR.',
            'error'
          );
          return;
        }
        // No real backend call — keep packet locked
        showStatus(
          verifyStatus,
          'Prototype: token chưa được xác minh bởi máy chủ. Gói hồ sơ vẫn bị khóa.',
          'Prototype: token not verified by server. Packet remains locked.',
          'idle'
        );
        // Explicitly keep locked
        setHidden(lock, false);
        setHidden(packetEmpty, false);
        setHidden(packetContent, true);
      });
    }

    // Release camera on page hide
    window.addEventListener('pagehide', stopScanner);
  }

  /* ================================================================
     12. BLOCKCHAIN AUDIT PANEL (staff)
     ================================================================ */

  function initAuditPanel() {
    const walletEl = $('#audit-wallet');
    if (!exists(walletEl)) return;

    // Reflect simple presence of ethereum; full connect is on patient consent button
    if (typeof window.ethereum !== 'undefined') {
      setText(walletEl, 'MetaMask khả dụng', 'MetaMask available');
    } else {
      setText(walletEl, 'Chưa kết nối / Không có ví', 'Not connected / No wallet');
    }
  }

  /* ================================================================
     13. INITIALIZATION
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();