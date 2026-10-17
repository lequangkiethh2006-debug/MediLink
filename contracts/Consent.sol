// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MediLink Consent & SBAR Audit
 * @author MediLink Prototype
 * @notice Minimal consent-state and SBAR audit-hash contract for Avalanche Fuji.
 * @dev This is a prototype. It does NOT store medical records, names, citizen IDs,
 *      phone numbers, diagnoses or laboratory results. Backend authorization and
 *      professional identity verification remain mandatory off-chain.
 *
 * Target network: Avalanche Fuji (chainId 43113 / 0xA869)
 * Compiler: Solidity 0.8.20+
 */

contract Consent {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct ConsentRecord {
        address grantor;           // who granted consent
        address recipient;         // who is authorized to access
        bytes32 recordRef;         // pseudonymous reference / hash of off-chain record
        bytes32 scope;             // permission scope (e.g. keccak256("read-referral"))
        uint64 createdAt;          // block timestamp at creation
        uint64 expiresAt;          // expiry timestamp (0 = no expiry)
        bool active;               // false after revocation
        bool exists;               // true once created
    }

    struct SbarAudit {
        bytes32 handoverRef;       // unique handover identifier (hash or ID)
        bytes32 reportHash;        // keccak256 of finalized off-chain SBAR content
        address submitter;         // staff wallet that submitted the hash
        uint64 timestamp;          // block timestamp
        bool exists;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address public owner;

    /// @dev consentId => ConsentRecord
    mapping(bytes32 => ConsentRecord) private _consents;

    /// @dev handoverRef => SbarAudit
    mapping(bytes32 => SbarAudit) private _sbarAudits;

    /// @dev staff allowlist (demonstration role management)
    mapping(address => bool) private _staff;

    // -------------------------------------------------------------------------
    // Events (minimal, no PHI)
    // -------------------------------------------------------------------------

    event ConsentGranted(
        bytes32 indexed consentId,
        address indexed grantor,
        address indexed recipient,
        bytes32 recordRef,
        bytes32 scope,
        uint64 expiresAt
    );

    event ConsentRevoked(
        bytes32 indexed consentId,
        address indexed revokedBy,
        uint64 timestamp
    );

    event StaffUpdated(
        address indexed staff,
        bool authorized,
        address indexed updatedBy
    );

    event SbarRecorded(
        bytes32 indexed handoverRef,
        bytes32 reportHash,
        address indexed submitter,
        uint64 timestamp
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotOwner();
    error NotStaff();
    error NotAuthorized();
    error InvalidAddress();
    error InvalidExpiry();
    error ConsentNotFound();
    error ConsentInactive();
    error ConsentExpired();
    error ConsentAlreadyExists();
    error SbarAlreadyExists();
    error ZeroHash();

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyStaff() {
        if (!_staff[msg.sender] && msg.sender != owner) revert NotStaff();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
        _staff[msg.sender] = true; // deployer is initial staff
        emit StaffUpdated(msg.sender, true, msg.sender);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // -------------------------------------------------------------------------
    // Ownership & staff management
    // -------------------------------------------------------------------------

    /**
     * @notice Transfer contract ownership.
     * @param newOwner Address of the new owner (must be non-zero).
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /**
     * @notice Add or remove an authorized staff address.
     * @dev Only the owner may call this. Staff cannot self-register.
     * @param staff Address to update.
     * @param authorized True to grant staff role, false to revoke.
     */
    function setStaff(address staff, bool authorized) external onlyOwner {
        if (staff == address(0)) revert InvalidAddress();
        _staff[staff] = authorized;
        emit StaffUpdated(staff, authorized, msg.sender);
    }

    /**
     * @notice Check whether an address is on the staff allowlist.
     */
    function isStaff(address account) external view returns (bool) {
        return _staff[account] || account == owner;
    }

    // -------------------------------------------------------------------------
    // Consent — grant
    // -------------------------------------------------------------------------

    /**
     * @notice Create a consent record.
     * @dev Caller becomes the grantor. Does not accept medical data.
     * @param consentId Unique identifier chosen by the caller (e.g. keccak256 of off-chain token).
     * @param recipient Address authorized to act under this consent.
     * @param recordRef Pseudonymous reference or hash of the off-chain record.
     * @param scope Permission scope (e.g. keccak256("read-referral")).
     * @param expiresAt Unix timestamp when consent ends (0 = no expiry). Must be in the future if non-zero.
     */
    function grantConsent(
        bytes32 consentId,
        address recipient,
        bytes32 recordRef,
        bytes32 scope,
        uint64 expiresAt
    ) external {
        if (consentId == bytes32(0)) revert ZeroHash();
        if (recipient == address(0)) revert InvalidAddress();
        if (recordRef == bytes32(0)) revert ZeroHash();
        if (scope == bytes32(0)) revert ZeroHash();
        if (_consents[consentId].exists) revert ConsentAlreadyExists();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();

        _consents[consentId] = ConsentRecord({
            grantor: msg.sender,
            recipient: recipient,
            recordRef: recordRef,
            scope: scope,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            active: true,
            exists: true
        });

        emit ConsentGranted(
            consentId,
            msg.sender,
            recipient,
            recordRef,
            scope,
            expiresAt
        );
    }

    // -------------------------------------------------------------------------
    // Consent — revoke
    // -------------------------------------------------------------------------

    /**
     * @notice Revoke an existing consent.
     * @dev Only the original grantor or the contract owner may revoke.
     *      Repeated revocation is a no-op success (idempotent).
     * @param consentId The consent to revoke.
     */
    function revokeConsent(bytes32 consentId) external {
        ConsentRecord storage c = _consents[consentId];
        if (!c.exists) revert ConsentNotFound();

        if (msg.sender != c.grantor && msg.sender != owner) {
            revert NotAuthorized();
        }

        if (c.active) {
            c.active = false;
            emit ConsentRevoked(consentId, msg.sender, uint64(block.timestamp));
        }
        // if already inactive, silently succeed (safe repeated call)
    }

    // -------------------------------------------------------------------------
    // Consent — verify (read-only)
    // -------------------------------------------------------------------------

    /**
     * @notice Check whether a consent is currently valid for the given parameters.
     * @param consentId Consent identifier.
     * @param recipient Address that is requesting access.
     * @param recordRef Expected record reference.
     * @param scope Expected permission scope.
     * @return valid True only if the consent exists, is active, not expired,
     *         and matches recipient, recordRef and scope.
     */
    function verifyConsent(
        bytes32 consentId,
        address recipient,
        bytes32 recordRef,
        bytes32 scope
    ) external view returns (bool valid) {
        ConsentRecord storage c = _consents[consentId];

        if (!c.exists) return false;
        if (!c.active) return false;
        if (c.expiresAt != 0 && block.timestamp > c.expiresAt) return false;
        if (c.recipient != recipient) return false;
        if (c.recordRef != recordRef) return false;
        if (c.scope != scope) return false;

        return true;
    }

    /**
     * @notice Return the full consent record (for authorized off-chain indexing).
     * @dev Does not contain medical data. Anyone can read; authorization is enforced off-chain.
     */
    function getConsent(bytes32 consentId)
        external
        view
        returns (
            address grantor,
            address recipient,
            bytes32 recordRef,
            bytes32 scope,
            uint64 createdAt,
            uint64 expiresAt,
            bool active,
            bool exists
        )
    {
        ConsentRecord storage c = _consents[consentId];
        return (
            c.grantor,
            c.recipient,
            c.recordRef,
            c.scope,
            c.createdAt,
            c.expiresAt,
            c.active,
            c.exists
        );
    }

    // -------------------------------------------------------------------------
    // SBAR audit evidence
    // -------------------------------------------------------------------------

    /**
     * @notice Record a hash of a finalized SBAR handover report.
     * @dev Only staff (or owner) may call. Stores hash only — never the report text.
     * @param handoverRef Unique reference for this handover (e.g. keccak256 of off-chain ID).
     * @param reportHash keccak256 of the finalized SBAR content (computed off-chain).
     */
    function recordSbar(bytes32 handoverRef, bytes32 reportHash) external onlyStaff {
        if (handoverRef == bytes32(0)) revert ZeroHash();
        if (reportHash == bytes32(0)) revert ZeroHash();
        if (_sbarAudits[handoverRef].exists) revert SbarAlreadyExists();

        _sbarAudits[handoverRef] = SbarAudit({
            handoverRef: handoverRef,
            reportHash: reportHash,
            submitter: msg.sender,
            timestamp: uint64(block.timestamp),
            exists: true
        });

        emit SbarRecorded(handoverRef, reportHash, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Read an SBAR audit record.
     */
    function getSbar(bytes32 handoverRef)
        external
        view
        returns (
            bytes32 reportHash,
            address submitter,
            uint64 timestamp,
            bool exists
        )
    {
        SbarAudit storage s = _sbarAudits[handoverRef];
        return (s.reportHash, s.submitter, s.timestamp, s.exists);
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    /**
     * @notice Helper to compute a scope hash off-chain-friendly description.
     * @dev Pure convenience; callers may also compute keccak256 themselves.
     */
    function scopeHash(string calldata scopeLabel) external pure returns (bytes32) {
        return keccak256(bytes(scopeLabel));
    }
}