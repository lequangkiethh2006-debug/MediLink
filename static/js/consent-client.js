/**
 * MediLink Consent client — ethers.js v5 browser helper
 * contracts/ConsentClient.js
 *
 * This is the source for static/js/consent-client.js. It contains no private
 * keys, seed phrases, or patient data.
 *
 * Ethers version: v5 (providers.Web3Provider, Contract, utils).
 *
 * Read the contract address from the page's medilink-consent-address meta tag.
 * Load ethers v5 before this file and static/js/script.js after it.
 *
 * PRIVACY: recordRef must be an opaque random identifier or hash. Never pass a
 * patient name, citizen ID, phone number, medical record number, test result,
 * diagnosis, or image reference that can identify a person.
 */
(function (global) {
  "use strict";

  var FUJI_CHAIN_ID = 43113;
  var FUJI_CHAIN_ID_HEX = "0xa869";
  var FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
  var FUJI_EXPLORER = "https://testnet.snowtrace.io/";

  // The canonical ABI is in contracts/Consent.abi.json. Ethers v5 accepts this
  // human-readable form, which keeps the browser helper small and readable.
  var CONSENT_ABI = [
    "event ConsentGranted(address indexed owner, address indexed recipient, string recordRef)",
    "event ConsentRevoked(address indexed owner, address indexed recipient, string recordRef)",
    "error InvalidRecipient()",
    "error EmptyRecordRef()",
    "error ConsentAlreadyActive()",
    "error ConsentNotFound()",
    "error ConsentAlreadyRevoked()",
    "function grantConsent(address recipient, string recordRef)",
    "function revokeConsent(address recipient, string recordRef)",
    "function getConsentStatus(address consentOwner, address recipient, string recordRef) view returns (bool exists, bool active)"
  ];

  var addressMeta = global.document
    ? global.document.querySelector('meta[name="medilink-consent-address"]')
    : null;
  var contractAddress = String(
    addressMeta ? addressMeta.getAttribute("content") || "" : ""
  ).trim();

  function requireEthers() {
    if (
      !global.ethers ||
      !global.ethers.providers ||
      typeof global.ethers.providers.Web3Provider !== "function"
    ) {
      throw new Error(
        "ethers.js v5 is required. Load an ethers v5 UMD build before consent-client.js."
      );
    }
    return global.ethers;
  }

  function requireEthereum() {
    if (!global.ethereum) {
      throw new Error("MetaMask is not installed or window.ethereum is unavailable.");
    }
    return global.ethereum;
  }

  function isValidAddress(address) {
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return false;
    }
    // A zero address is syntactically valid but is only a placeholder here.
    if (/^0x0{40}$/i.test(address)) {
      return false;
    }
    if (global.ethers && global.ethers.utils) {
      return global.ethers.utils.isAddress(address);
    }
    return true;
  }

  function requireAddress() {
    if (!isValidAddress(contractAddress)) {
      throw new Error(
        "Consent contract address is not configured. Set CONSENT_CONTRACT_ADDRESS in the environment."
      );
    }
    return contractAddress;
  }

  function requireRecipient(recipient) {
    var ethers = requireEthers();
    if (!ethers.utils.isAddress(recipient) || /^0x0{40}$/i.test(String(recipient))) {
      throw new Error("Recipient must be a valid non-zero Ethereum address.");
    }
    return ethers.utils.getAddress(recipient);
  }

  function requireRecordRef(recordRef) {
    var value = String(recordRef == null ? "" : recordRef).trim();
    if (!value) {
      throw new Error("recordRef is required.");
    }
    if (value.length > 128) {
      throw new Error("recordRef must be 128 characters or fewer.");
    }
    return value;
  }

  async function currentChainId() {
    var ethereum = requireEthereum();
    var chainIdHex = await ethereum.request({ method: "eth_chainId" });
    return Number(BigInt(chainIdHex));
  }

  async function ensureFuji() {
    var ethereum = requireEthereum();
    if ((await currentChainId()) === FUJI_CHAIN_ID) {
      return;
    }

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: FUJI_CHAIN_ID_HEX }]
      });
    } catch (error) {
      // 4902 means MetaMask does not know the Fuji network yet.
      if (error && error.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: FUJI_CHAIN_ID_HEX,
              chainName: "Avalanche Fuji Testnet",
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: [FUJI_RPC],
              blockExplorerUrls: [FUJI_EXPLORER]
            }
          ]
        });
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: FUJI_CHAIN_ID_HEX }]
        });
      } else {
        if (error && error.code === 4001) {
          throw error;
        }
        throw error;
      }
    }

    if ((await currentChainId()) !== FUJI_CHAIN_ID) {
      throw new Error("Please switch MetaMask to Avalanche Fuji (43113).");
    }
  }

  async function getProvider() {
    var ethers = requireEthers();
    return new ethers.providers.Web3Provider(requireEthereum());
  }

  function getContract(runner) {
    var ethers = requireEthers();
    return new ethers.Contract(requireAddress(), CONSENT_ABI, runner);
  }

  async function requireDeployedContract(provider) {
    var code = await withTimeout(provider.getCode(requireAddress()));
    if (!code || code === "0x") {
      var error = new Error("Consent contract is unavailable at the configured address.");
      error.code = "CONTRACT_UNAVAILABLE";
      throw error;
    }
  }

  function withTimeout(promise) {
    var timeout;
    return Promise.race([
      promise,
      new Promise(function (_resolve, reject) {
        timeout = global.setTimeout(function () {
          var error = new Error("Network request timed out.");
          error.code = "MEDILINK_TIMEOUT";
          reject(error);
        }, 120000);
      })
    ]).finally(function () {
      global.clearTimeout(timeout);
    });
  }

  function configure(address) {
    var value = String(address || "").trim();
    if (value && !isValidAddress(value)) {
      throw new Error("Invalid consent contract address.");
    }
    contractAddress = value;
    return getConfig();
  }

  function getConfig() {
    return {
      contractAddress: contractAddress || null,
      configured: isValidAddress(contractAddress),
      chainId: FUJI_CHAIN_ID,
      chainIdHex: FUJI_CHAIN_ID_HEX,
      rpcUrl: FUJI_RPC,
      explorer: FUJI_EXPLORER,
      abi: CONSENT_ABI
    };
  }

  async function connect() {
    var ethereum = requireEthereum();
    var accounts = await ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) {
      throw new Error("MetaMask returned no account.");
    }
    await ensureFuji();
    return {
      address: requireEthers().utils.getAddress(accounts[0]),
      chainId: await currentChainId()
    };
  }

  async function getConsentStatus(consentOwner, recipient, recordRef) {
    requireAddress();
    var ethers = requireEthers();
    if (!ethers.utils.isAddress(consentOwner)) {
      throw new Error("consentOwner must be a valid Ethereum address.");
    }
    await ensureFuji();
    var provider = await getProvider();
    await requireDeployedContract(provider);
    var contract = getContract(provider);
    var result = await withTimeout(contract.getConsentStatus(
      ethers.utils.getAddress(consentOwner),
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    ));
    return {
      exists: Boolean(result.exists != null ? result.exists : result[0]),
      active: Boolean(result.active != null ? result.active : result[1])
    };
  }

  async function grantConsent(recipient, recordRef) {
    requireAddress();
    await ensureFuji();
    var provider = await getProvider();
    await requireDeployedContract(provider);
    var signer = provider.getSigner();
    var contract = getContract(signer);
    var tx = await withTimeout(contract.grantConsent(
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    ));
    var receipt = await withTimeout(tx.wait());
    return {
      hash: tx.hash,
      blockNumber: receipt ? receipt.blockNumber : null,
      status: receipt ? receipt.status : null,
      explorerUrl: txUrl(tx.hash)
    };
  }

  async function revokeConsent(recipient, recordRef) {
    requireAddress();
    await ensureFuji();
    var provider = await getProvider();
    await requireDeployedContract(provider);
    var signer = provider.getSigner();
    var contract = getContract(signer);
    var tx = await withTimeout(contract.revokeConsent(
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    ));
    var receipt = await withTimeout(tx.wait());
    return {
      hash: tx.hash,
      blockNumber: receipt ? receipt.blockNumber : null,
      status: receipt ? receipt.status : null,
      explorerUrl: txUrl(tx.hash)
    };
  }

  function txUrl(hash) {
    return FUJI_EXPLORER + "tx/" + String(hash || "");
  }

  function describeError(error, language) {
    var message = String(error && (error.reason || error.message) || "");
    var code = error && error.code;
    var english;
    var vietnamese;
    if (!global.ethereum) {
      english = "MetaMask is not installed or unavailable.";
      vietnamese = "Chưa cài đặt hoặc không thể truy cập MetaMask.";
    } else if (code === 4001 || code === "ACTION_REJECTED") {
      english = "The wallet request or transaction was rejected.";
      vietnamese = "Yêu cầu ví hoặc giao dịch đã bị từ chối.";
    } else if (/MEDILINK_TIMEOUT|TIMEOUT|timed? out/i.test(code + " " + message)) {
      english = "Network timeout. Check your connection and try again.";
      vietnamese = "Hết thời gian chờ mạng. Hãy kiểm tra kết nối và thử lại.";
    } else if (/CONTRACT_UNAVAILABLE|PENDING|contract address|contract is unavailable/i.test(code + " " + message)) {
      english = "The consent contract is unavailable. Check the configured Fuji contract address.";
      vietnamese = "Không thể truy cập hợp đồng đồng thuận. Hãy kiểm tra địa chỉ hợp đồng Fuji.";
    } else if (/ConsentNotFound|CONSENT_NOT_FOUND|not found/i.test(message)) {
      english = "No consent was found for this owner, recipient, and record reference.";
      vietnamese = "Không tìm thấy đồng thuận cho chủ sở hữu, bên nhận và mã hồ sơ này.";
    } else if (/ConsentAlreadyRevoked|revoked/i.test(message)) {
      english = "Consent has already been revoked.";
      vietnamese = "Đồng thuận đã bị thu hồi.";
    } else if (/wrong network|Please switch to Avalanche Fuji/i.test(message)) {
      english = "Wrong network. Switch your wallet to Avalanche Fuji (43113).";
      vietnamese = "Sai mạng. Hãy chuyển ví sang Avalanche Fuji (43113).";
    } else if (/NETWORK_ERROR|network|could not detect network/i.test(code + " " + message)) {
      english = "Network error. Confirm Avalanche Fuji is selected and reachable.";
      vietnamese = "Lỗi mạng. Hãy xác nhận Avalanche Fuji đang được chọn và có thể truy cập.";
    } else if (/ConsentAlreadyActive/i.test(message)) {
      english = "Consent is already active.";
      vietnamese = "Đồng thuận hiện đang có hiệu lực.";
    } else if (/required|valid .*address|invalid .*address|recordRef/i.test(message)) {
      english = "Enter a valid wallet address and opaque record reference.";
      vietnamese = "Hãy nhập địa chỉ ví hợp lệ và mã hồ sơ ẩn danh.";
    } else {
      english = "Wallet or contract operation failed. Please try again.";
      vietnamese = "Giao dịch ví hoặc hợp đồng thất bại. Hãy thử lại.";
    }
    return language
      ? (language === "en" ? english : vietnamese)
      : (documentLanguageIsEnglish() ? english : vietnamese);
  }

  function documentLanguageIsEnglish() {
    return !!(global.document && global.document.body &&
      global.document.body.classList.contains("lang-en-active"));
  }

  global.MediLinkConsent = {
    ABI: CONSENT_ABI,
    configure: configure,
    connect: connect,
    describeError: describeError,
    ensureFuji: ensureFuji,
    getConfig: getConfig,
    getConsentStatus: getConsentStatus,
    grantConsent: grantConsent,
    revokeConsent: revokeConsent,
    txUrl: txUrl
  };
})(typeof window !== "undefined" ? window : globalThis);
