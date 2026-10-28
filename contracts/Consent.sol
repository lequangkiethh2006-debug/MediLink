// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MediLink Consent
 * @notice Demonstration contract for granting, revoking, and checking
 *         permission to share an off-chain medical-record reference.
 *
 * @dev PRIVACY: this contract must never store patient names, dates of birth,
 *      diagnoses, examination results, laboratory values, images, or any other
 *      sensitive medical information. Only a non-identifying record reference
 *      is accepted. That reference is also written to public event logs, so it
 *      must be an opaque identifier (for example, a random ID or a hash) that
 *      does not contain personal information.
 *
 *      This is a prototype for the MediLink demo. It is not a production
 *      healthcare consent-management system and does not by itself prove that
 *      a patient gave legally valid consent.
 *
 *      A consent is identified by the combination:
 *          (consent owner, recipient, record reference)
 *
 *      Rules:
 *      - The caller of grantConsent becomes the consent owner.
 *      - Granting the same consent while it is already active reverts.
 *      - Revoking an unknown or already-revoked consent reverts.
 *      - A revoked consent may be granted again later. This reactivates the
 *        same consent and emits a new ConsentGranted event.
 */
contract Consent {
    struct ConsentRecord {
        bool exists; // true after the first grant
        bool active; // true while the consent is active
    }

    /// @dev Hash of (consent owner, recipient, record reference) => state.
    mapping(bytes32 => ConsentRecord) private _consents;

    // `owner` and `recipient` are indexed so the frontend can filter events.
    // `recordRef` is a dynamic string, so it is emitted as plain event data.

    /// @notice Emitted when a consent owner grants permission.
    event ConsentGranted(
        address indexed owner,
        address indexed recipient,
        string recordRef
    );

    /// @notice Emitted when a consent owner revokes permission.
    event ConsentRevoked(
        address indexed owner,
        address indexed recipient,
        string recordRef
    );

    error InvalidRecipient();
    error EmptyRecordRef();
    error ConsentAlreadyActive();
    error ConsentNotFound();
    error ConsentAlreadyRevoked();

    /**
     * @notice Grant permission to `recipient` for one record reference.
     * @dev The caller (msg.sender) is the consent owner. If this consent was
     *      revoked before, calling this function again reactivates it.
     * @param recipient Address allowed to access the record reference.
     * @param recordRef Non-identifying reference to the off-chain record.
     */
    function grantConsent(address recipient, string calldata recordRef) external {
        if (recipient == address(0)) revert InvalidRecipient();
        if (bytes(recordRef).length == 0) revert EmptyRecordRef();

        bytes32 key = _consentKey(msg.sender, recipient, recordRef);
        ConsentRecord storage consent = _consents[key];

        // Reject duplicate active grants. After a revocation, exists is true
        // but active is false, so the consent can be granted again.
        if (consent.active) revert ConsentAlreadyActive();

        // Only write `exists` on the first grant. Re-granting a revoked
        // consent only needs to flip `active` back to true.
        if (!consent.exists) {
            consent.exists = true;
        }
        consent.active = true;

        emit ConsentGranted(msg.sender, recipient, recordRef);
    }

    /**
     * @notice Revoke a consent previously granted by the caller.
     * @dev The key includes msg.sender, so a caller can only revoke a consent
     *      that they themselves granted. Revoking twice reverts.
     * @param recipient The recipient named in the original grant.
     * @param recordRef The record reference named in the original grant.
     */
    function revokeConsent(address recipient, string calldata recordRef) external {
        bytes32 key = _consentKey(msg.sender, recipient, recordRef);
        ConsentRecord storage consent = _consents[key];

        if (!consent.exists) revert ConsentNotFound();
        if (!consent.active) revert ConsentAlreadyRevoked();

        consent.active = false;

        emit ConsentRevoked(msg.sender, recipient, recordRef);
    }

    /**
     * @notice Read the consent state for an owner, recipient, and record.
     * @dev This is a view function: the frontend can call it without sending
     *      a transaction or paying gas.
     * @param consentOwner Address that granted the consent.
     * @param recipient Address named in the consent.
     * @param recordRef Non-identifying record reference.
     * @return exists True if this consent has ever been granted.
     * @return active True if the consent is currently active.
     */
    function getConsentStatus(
        address consentOwner,
        address recipient,
        string calldata recordRef
    ) external view returns (bool exists, bool active) {
        ConsentRecord storage consent = _consents[
            _consentKey(consentOwner, recipient, recordRef)
        ];

        return (consent.exists, consent.active);
    }

    /// @dev Build a unique mapping key. abi.encode avoids ambiguous packing.
    function _consentKey(
        address consentOwner,
        address recipient,
        string memory recordRef
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(consentOwner, recipient, recordRef));
    }
}
