/**
 * MediLink Consent client — ethers.js v6 browser helper
 * contracts/ConsentClient.js
 *
 * This file is intentionally self-contained so it can be copied to
 * static/js/consent-client.js during manual integration. It does not contain
 * private keys, seed phrases, or patient data.
 *
 * Ethers version: v6 only (BrowserProvider, Contract, isAddress, getAddress).
 * Do not load an ethers v5 build with this file.
 *
 * Load order in a template:
 *   1. ethers v6 UMD build
 *   2. optional inline config:
 *        <script>
 *          window.MEDILINK_CONSENT_ADDRESS = "0x..."; // deployed Fuji address
 *        </script>
 *   3. this file
 *   4. static/js/script.js
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

  // The canonical ABI is in contracts/Consent.abi.json. Ethers v6 accepts this
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

  // Set window.MEDILINK_CONSENT_ADDRESS before loading this file, or call
  // MediLinkConsent.configure("0x...") after deployment. Empty means PENDING.
  var contractAddress = String(global.MEDILINK_CONSENT_ADDRESS || "").trim();

  function requireEthers() {
    if (!global.ethers || typeof global.ethers.BrowserProvider !== "function") {
      throw new Error(
        "ethers.js v6 is required. Load an ethers v6 UMD build before consent-client.js."
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
    if (global.ethers && typeof global.ethers.isAddress === "function") {
      return global.ethers.isAddress(address);
    }
    return true;
  }

  function requireAddress() {
    if (!isValidAddress(contractAddress)) {
      throw new Error(
        "Consent contract address is PENDING. Deploy contracts/Consent.sol to Avalanche Fuji, then set window.MEDILINK_CONSENT_ADDRESS or call MediLinkConsent.configure(address)."
      );
    }
    return contractAddress;
  }

  function requireRecipient(recipient) {
    var ethers = requireEthers();
    if (!ethers.isAddress(recipient) || /^0x0{40}$/i.test(String(recipient))) {
      throw new Error("Recipient must be a valid non-zero Ethereum address.");
    }
    return ethers.getAddress(recipient);
  }

  function requireRecordRef(recordRef) {
    var value = String(recordRef == null ? "" : recordRef).trim();
    if (!value) {
      throw new Error("recordRef is required.");
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
        throw error;
      }
    }

    if ((await currentChainId()) !== FUJI_CHAIN_ID) {
      throw new Error("Please switch MetaMask to Avalanche Fuji (43113).");
    }
  }

  async function getProvider() {
    var ethers = requireEthers();
    return new ethers.BrowserProvider(requireEthereum());
  }

  function getContract(runner) {
    var ethers = requireEthers();
    return new ethers.Contract(requireAddress(), CONSENT_ABI, runner);
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
      address: accounts[0],
      chainId: await currentChainId()
    };
  }

  async function getConsentStatus(consentOwner, recipient, recordRef) {
    requireAddress();
    var ethers = requireEthers();
    if (!ethers.isAddress(consentOwner)) {
      throw new Error("consentOwner must be a valid Ethereum address.");
    }
    await ensureFuji();
    var provider = await getProvider();
    var contract = getContract(provider);
    var result = await contract.getConsentStatus(
      ethers.getAddress(consentOwner),
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    );
    return {
      exists: Boolean(result.exists != null ? result.exists : result[0]),
      active: Boolean(result.active != null ? result.active : result[1])
    };
  }

  async function grantConsent(recipient, recordRef) {
    requireAddress();
    await ensureFuji();
    var provider = await getProvider();
    var signer = await provider.getSigner();
    var contract = getContract(signer);
    var tx = await contract.grantConsent(
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    );
    var receipt = await tx.wait();
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
    var signer = await provider.getSigner();
    var contract = getContract(signer);
    var tx = await contract.revokeConsent(
      requireRecipient(recipient),
      requireRecordRef(recordRef)
    );
    var receipt = await tx.wait();
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

  function describeError(error) {
    if (!error) return "Unknown wallet error.";
    if (error.code === 4001 || error.code === "ACTION_REJECTED") {
      return "The wallet request was rejected.";
    }
    if (error.shortMessage) return error.shortMessage;
    if (error.message) return error.message;
    return "Wallet or contract operation failed.";
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
