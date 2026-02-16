// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract HabitRegistry {
    error CadenceZero();
    error CommitmentNotFound();
    error NotCommitmentCreator();
    error TimestampZero();
    error ProofHashZero();
    error InvalidUsdcToken();
    error AmountZero();
    error DeadlineInvalid();
    error SelfSponsorshipBlocked();
    error PledgeNotFound();
    error PledgeInactive();
    error SettlementWindowOpen();
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
    uint256 private _nextCommitmentId = 1;
    uint256 private _nextPledgeId = 1;

    mapping(uint256 => Commitment) public commitments;
    mapping(uint256 => Pledge) public pledges;

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
        uint256 timestamp
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

    constructor(address usdcToken_) {
        if (usdcToken_ == address(0)) revert InvalidUsdcToken();
        usdcToken = IERC20(usdcToken_);
    }

    function createCommitment(
        bytes32 habitHash,
        uint256 cadence,
        uint256 startDate
    ) external returns (uint256 commitmentId) {
        if (cadence == 0) revert CadenceZero();

        commitmentId = _nextCommitmentId++;
        commitments[commitmentId] = Commitment({
            creator: msg.sender,
            habitHash: habitHash,
            cadence: cadence,
            startDate: startDate,
            createdAt: block.timestamp,
            exists: true
        });

        emit CommitmentCreated(commitmentId, msg.sender, habitHash, cadence, startDate);
    }

    function checkIn(
        uint256 commitmentId,
        bytes32 proofHash,
        uint256 timestamp
    ) external {
        Commitment memory c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();
        if (c.creator != msg.sender) revert NotCommitmentCreator();
        if (proofHash == bytes32(0)) revert ProofHashZero();
        if (timestamp == 0) revert TimestampZero();

        emit CheckInRecorded(commitmentId, msg.sender, proofHash, timestamp);
    }

    function createPledge(
        uint256 commitmentId,
        uint256 amount,
        uint256 deadline,
        uint256 minCheckIns
    ) external returns (uint256 pledgeId) {
        Commitment memory c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();
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

    function settlePledge(uint256 pledgeId) external {
        Pledge storage p = pledges[pledgeId];
        if (!p.exists) revert PledgeNotFound();
        if (p.status != PledgeStatus.Active) revert PledgeInactive();

        uint256 beneficiaryAmount;
        uint256 sponsorRefund;
        bool sponsorApproved = msg.sender == p.sponsor;

        if (sponsorApproved) {
            beneficiaryAmount = p.amount;
            sponsorRefund = 0;
        } else {
            if (block.timestamp <= p.deadline) revert SettlementWindowOpen();
            beneficiaryAmount = (p.amount * 80) / 100;
            sponsorRefund = p.amount - beneficiaryAmount;
        }

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
            msg.sender,
            beneficiaryAmount,
            sponsorRefund,
            sponsorApproved
        );
    }
}
