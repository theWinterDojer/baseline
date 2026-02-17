// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import {ReentrancyGuard} from "./ReentrancyGuard.sol";

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract HabitRegistry is ReentrancyGuard {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant NO_RESPONSE_BENEFICIARY_BPS = 8_000;
    uint256 public constant MAX_REVIEW_WINDOW_SECONDS = 30 days;

    error NotOwner();
    error NotSettlementOperator();
    error CadenceZero();
    error HabitHashZero();
    error CommitmentNotFound();
    error CommitmentAlreadyCompleted();
    error CommitmentNotCompleted();
    error NotCommitmentCreator();
    error TimestampZero();
    error ProofHashZero();
    error InvalidUsdcToken();
    error AmountZero();
    error DeadlineInvalid();
    error DeadlineNotReached();
    error SelfSponsorshipBlocked();
    error PledgeNotFound();
    error PledgeInactive();
    error NotPledgeSponsor();
    error InvalidOperator();
    error InvalidReviewWindow();
    error ContractPaused();
    error SettlementWindowOpen();
    error MinimumCheckInsNotMet(uint256 actual, uint256 required);
    error UnsupportedRecoveryToken();
    error TokenTransferFailed();

    enum PledgeStatus {
        Active,
        Settled
    }

    struct Commitment {
        address creator;
        bytes32 habitHash;
        uint256 cadence;
        uint256 startDate;
        uint256 checkInCount;
        uint256 completedAt;
        uint256 createdAt;
        bool exists;
    }

    struct Pledge {
        uint256 commitmentId;
        address sponsor;
        address beneficiary;
        uint256 amount;
        uint256 deadline;
        uint256 minCheckIns;
        uint256 createdAt;
        uint256 settledAt;
        PledgeStatus status;
        bool exists;
    }

    IERC20 public immutable usdcToken;
    address public owner;
    bool public paused;
    uint256 public reviewWindowSeconds = 7 days;

    uint256 private _nextCommitmentId = 1;
    uint256 private _nextPledgeId = 1;
    mapping(uint256 => Commitment) public commitments;
    mapping(uint256 => Pledge) public pledges;
    mapping(address => bool) public settlementOperators;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SettlementOperatorUpdated(address indexed operator, bool enabled);
    event PausedUpdated(bool paused);
    event ReviewWindowUpdated(uint256 reviewWindowSeconds);

    event CommitmentCreated(
        uint256 indexed commitmentId,
        address indexed creator,
        bytes32 habitHash,
        uint256 cadence,
        uint256 startDate
    );

    event CheckInRecorded(
        uint256 indexed commitmentId,
        address indexed creator,
        bytes32 proofHash,
        uint256 timestamp,
        uint256 totalCheckIns
    );

    event CommitmentCompleted(
        uint256 indexed commitmentId,
        address indexed creator,
        uint256 completedAt
    );

    event PledgeCreated(
        uint256 indexed pledgeId,
        uint256 indexed commitmentId,
        address indexed sponsor,
        address beneficiary,
        uint256 amount,
        uint256 deadline,
        uint256 minCheckIns
    );

    event PledgeSettled(
        uint256 indexed pledgeId,
        uint256 indexed commitmentId,
        address indexed settledBy,
        uint256 beneficiaryAmount,
        uint256 sponsorRefund,
        bool sponsorApproved
    );
    event UnsupportedTokenRecovered(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    constructor(address usdcToken_) {
        if (usdcToken_ == address(0)) revert InvalidUsdcToken();
        usdcToken = IERC20(usdcToken_);
        owner = msg.sender;
        settlementOperators[msg.sender] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit SettlementOperatorUpdated(msg.sender, true);
        emit ReviewWindowUpdated(reviewWindowSeconds);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlementOperator() {
        if (!(msg.sender == owner || settlementOperators[msg.sender])) {
            revert NotSettlementOperator();
        }
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOperator();
        address previousOwner = owner;
        if (previousOwner != newOwner) {
            settlementOperators[previousOwner] = false;
            emit SettlementOperatorUpdated(previousOwner, false);
        }
        owner = newOwner;
        settlementOperators[newOwner] = true;

        emit OwnershipTransferred(previousOwner, newOwner);
        emit SettlementOperatorUpdated(newOwner, true);
    }

    function setSettlementOperator(address operator, bool enabled) external onlyOwner {
        if (operator == address(0)) revert InvalidOperator();
        settlementOperators[operator] = enabled;
        emit SettlementOperatorUpdated(operator, enabled);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PausedUpdated(nextPaused);
    }

    function setReviewWindowSeconds(uint256 nextReviewWindowSeconds) external onlyOwner {
        if (
            nextReviewWindowSeconds == 0 ||
            nextReviewWindowSeconds > MAX_REVIEW_WINDOW_SECONDS
        ) {
            revert InvalidReviewWindow();
        }
        reviewWindowSeconds = nextReviewWindowSeconds;
        emit ReviewWindowUpdated(nextReviewWindowSeconds);
    }

    function recoverUnsupportedToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert InvalidOperator();
        if (token == address(usdcToken)) revert UnsupportedRecoveryToken();
        if (to == address(0)) revert InvalidOperator();
        bool transferOk = IERC20(token).transfer(to, amount);
        if (!transferOk) revert TokenTransferFailed();
        emit UnsupportedTokenRecovered(token, to, amount);
    }

    function createCommitment(
        bytes32 habitHash,
        uint256 cadence,
        uint256 startDate
    ) external whenNotPaused returns (uint256 commitmentId) {
        if (cadence == 0) revert CadenceZero();
        if (habitHash == bytes32(0)) revert HabitHashZero();

        commitmentId = _nextCommitmentId++;
        commitments[commitmentId] = Commitment({
            creator: msg.sender,
            habitHash: habitHash,
            cadence: cadence,
            startDate: startDate,
            checkInCount: 0,
            completedAt: 0,
            createdAt: block.timestamp,
            exists: true
        });

        emit CommitmentCreated(commitmentId, msg.sender, habitHash, cadence, startDate);
    }

    function checkIn(
        uint256 commitmentId,
        bytes32 proofHash,
        uint256 timestamp
    ) external whenNotPaused {
        Commitment storage c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.creator != msg.sender) revert NotCommitmentCreator();
        if (proofHash == bytes32(0)) revert ProofHashZero();
        if (timestamp == 0) revert TimestampZero();

        unchecked {
            c.checkInCount += 1;
        }

        emit CheckInRecorded(commitmentId, msg.sender, proofHash, timestamp, c.checkInCount);
    }

    function markCommitmentCompleted(uint256 commitmentId) external whenNotPaused {
        Commitment storage c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.creator != msg.sender) revert NotCommitmentCreator();
        if (c.completedAt != 0) revert CommitmentAlreadyCompleted();

        c.completedAt = block.timestamp;

        emit CommitmentCompleted(commitmentId, msg.sender, c.completedAt);
    }

    function createPledge(
        uint256 commitmentId,
        uint256 amount,
        uint256 deadline,
        uint256 minCheckIns
    ) external whenNotPaused nonReentrant returns (uint256 pledgeId) {
        Commitment memory c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.completedAt != 0) revert CommitmentAlreadyCompleted();
        if (amount == 0) revert AmountZero();
        if (deadline <= block.timestamp) revert DeadlineInvalid();
        if (c.creator == msg.sender) revert SelfSponsorshipBlocked();

        bool transferOk = usdcToken.transferFrom(msg.sender, address(this), amount);
        if (!transferOk) revert TokenTransferFailed();

        pledgeId = _nextPledgeId++;
        pledges[pledgeId] = Pledge({
            commitmentId: commitmentId,
            sponsor: msg.sender,
            beneficiary: c.creator,
            amount: amount,
            deadline: deadline,
            minCheckIns: minCheckIns,
            createdAt: block.timestamp,
            settledAt: 0,
            status: PledgeStatus.Active,
            exists: true
        });

        emit PledgeCreated(
            pledgeId,
            commitmentId,
            msg.sender,
            c.creator,
            amount,
            deadline,
            minCheckIns
        );
    }

    function settlePledgeBySponsor(
        uint256 pledgeId
    ) external whenNotPaused nonReentrant {
        _settleBySponsor(pledgeId, msg.sender);
    }

    function settlePledgeNoResponse(
        uint256 pledgeId
    ) external whenNotPaused nonReentrant onlySettlementOperator {
        _settleNoResponse(pledgeId, msg.sender);
    }

    function settlePledge(uint256 pledgeId) external whenNotPaused nonReentrant {
        Pledge memory p = pledges[pledgeId];
        if (!p.exists) revert PledgeNotFound();

        if (msg.sender == p.sponsor) {
            _settleBySponsor(pledgeId, msg.sender);
        } else {
            if (!(msg.sender == owner || settlementOperators[msg.sender])) {
                revert NotSettlementOperator();
            }
            _settleNoResponse(pledgeId, msg.sender);
        }
    }

    function _settleBySponsor(uint256 pledgeId, address settledBy) internal {
        Pledge storage p = pledges[pledgeId];
        if (!p.exists) revert PledgeNotFound();
        if (p.status != PledgeStatus.Active) revert PledgeInactive();
        if (settledBy != p.sponsor) revert NotPledgeSponsor();

        Commitment memory c = commitments[p.commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.completedAt == 0) revert CommitmentNotCompleted();

        _settlePledge(p, pledgeId, settledBy, p.amount, 0, true);
    }

    function _settleNoResponse(uint256 pledgeId, address settledBy) internal {
        Pledge storage p = pledges[pledgeId];
        if (!p.exists) revert PledgeNotFound();
        if (p.status != PledgeStatus.Active) revert PledgeInactive();

        Commitment memory c = commitments[p.commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.completedAt == 0) revert CommitmentNotCompleted();
        if (block.timestamp <= p.deadline) revert DeadlineNotReached();
        if (block.timestamp <= c.completedAt + reviewWindowSeconds) revert SettlementWindowOpen();
        if (c.checkInCount < p.minCheckIns) {
            revert MinimumCheckInsNotMet(c.checkInCount, p.minCheckIns);
        }

        uint256 beneficiaryAmount = (p.amount * NO_RESPONSE_BENEFICIARY_BPS) /
            BPS_DENOMINATOR;
        uint256 sponsorRefund = p.amount - beneficiaryAmount;

        _settlePledge(p, pledgeId, settledBy, beneficiaryAmount, sponsorRefund, false);
    }

    function _settlePledge(
        Pledge storage p,
        uint256 pledgeId,
        address settledBy,
        uint256 beneficiaryAmount,
        uint256 sponsorRefund,
        bool sponsorApproved
    ) internal {
        p.status = PledgeStatus.Settled;
        p.settledAt = block.timestamp;

        if (beneficiaryAmount > 0) {
            bool payoutOk = usdcToken.transfer(p.beneficiary, beneficiaryAmount);
            if (!payoutOk) revert TokenTransferFailed();
        }

        if (sponsorRefund > 0) {
            bool refundOk = usdcToken.transfer(p.sponsor, sponsorRefund);
            if (!refundOk) revert TokenTransferFailed();
        }

        emit PledgeSettled(
            pledgeId,
            p.commitmentId,
            settledBy,
            beneficiaryAmount,
            sponsorRefund,
            sponsorApproved
        );
    }
}
