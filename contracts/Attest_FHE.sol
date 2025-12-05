pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract AttestFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool active;
        uint256 createdAt;
        uint256 closedAt;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsUpdated(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId, uint256 timestamp);
    event BatchClosed(uint256 indexed batchId, uint256 timestamp);
    event AttestationSubmitted(address indexed provider, uint256 indexed batchId, bytes32 encryptedData);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, bytes32 resultHash);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchNotActive();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default cooldown
        _openNewBatch();
    }

    function transferOwnership(address newOwner) public onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) public onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) public onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() public onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldown) public onlyOwner {
        require(newCooldown > 0, "Cooldown must be positive");
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSecondsUpdated(oldCooldown, newCooldown);
    }

    function _openNewBatch() internal {
        currentBatchId++;
        batches[currentBatchId] = Batch({
            id: currentBatchId,
            active: true,
            createdAt: block.timestamp,
            closedAt: 0
        });
        emit BatchOpened(currentBatchId, block.timestamp);
    }

    function closeCurrentBatch() public onlyOwner {
        Batch storage batch = batches[currentBatchId];
        if (batch.id == 0) revert InvalidBatch();
        if (!batch.active) revert BatchNotActive();
        batch.active = false;
        batch.closedAt = block.timestamp;
        emit BatchClosed(currentBatchId, block.timestamp);
        _openNewBatch();
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded() internal {
        euint32 memory dummy;
        dummy.isInitialized();
    }

    function _requireInitialized(euint32 memory x) internal pure {
        if (!x.isInitialized()) revert("FHE value not initialized");
    }
    function _requireInitialized(ebool memory x) internal pure {
        if (!x.isInitialized()) revert("FHE value not initialized");
    }

    function submitAttestation(euint32 memory encryptedData) public onlyProvider whenNotPaused respectCooldown {
        _initIfNeeded();
        _requireInitialized(encryptedData);
        lastSubmissionTime[msg.sender] = block.timestamp;

        Batch storage currentBatch = batches[currentBatchId];
        if (!currentBatch.active) revert BatchNotActive();

        // Store encrypted attestation (example storage, real implementation would be more complex)
        // For this example, we'll just emit it.
        emit AttestationSubmitted(msg.sender, currentBatchId, encryptedData.toBytes32());
    }

    function requestBatchValidation(uint256 batchId) public onlyOwner whenNotPaused respectCooldown {
        if (batchId == 0 || batchId >= currentBatchId || batches[batchId].closedAt == 0) {
            revert InvalidBatch();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        // Placeholder: Collect ciphertexts for validation.
        // In a real scenario, this would involve fetching all attestations for the batch.
        // For this example, we'll use a dummy ciphertext.
        euint32 memory dummyCiphertext;
        dummyCiphertext.asEuint32(0); // Ensure it's initialized
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = dummyCiphertext.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // Rebuild ciphertexts in the exact same order as in requestBatchValidation
        euint32 memory dummyCiphertext;
        dummyCiphertext.asEuint32(0);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = dummyCiphertext.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        try FHE.checkSignatures(requestId, cleartexts, proof) {
            // For this example, we expect one uint32 cleartext
            if (cleartexts.length != 32) revert DecryptionFailed();
            uint32 result = uint32(bytes32(cleartexts));

            decryptionContexts[requestId].processed = true;
            emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, bytes32(cleartexts));
        } catch {
            revert DecryptionFailed();
        }
    }
}