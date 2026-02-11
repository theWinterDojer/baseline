// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HabitRegistry {
    error CadenceZero();
    error CommitmentNotFound();
    error NotCommitmentCreator();
    error TimestampZero();
    error ProofHashZero();
    error AmountZero();
    error DeadlineInPast();
    error PledgeNotFound();
    error PledgeAlreadySettled();
    error PledgeSettlementNotAuthorized();
    error PledgeEscrowNotImplemented();

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
        uint256 amount;
        uint256 deadline;
        uint256 minCheckIns;
        uint256 createdAt;
        bool settled;
        bool exists;
    }

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
        uint256 amount,
        uint256 deadline,
        uint256 minCheckIns
    );

    event PledgeSettled(uint256 indexed pledgeId, address indexed settledBy);

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
    ) external payable returns (uint256 pledgeId) {
        if (msg.value != 0) revert PledgeEscrowNotImplemented();
        if (amount == 0) revert AmountZero();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        Commitment memory c = commitments[commitmentId];
        if (!c.exists) revert CommitmentNotFound();

        pledgeId = _nextPledgeId++;
        pledges[pledgeId] = Pledge({
            commitmentId: commitmentId,
            sponsor: msg.sender,
            amount: amount,
            deadline: deadline,
            minCheckIns: minCheckIns,
            createdAt: block.timestamp,
            settled: false,
            exists: true
        });

        emit PledgeCreated(
            pledgeId,
            commitmentId,
            msg.sender,
            amount,
            deadline,
            minCheckIns
        );
    }

    function settlePledge(uint256 pledgeId) external {
        Pledge storage pledge = pledges[pledgeId];
        if (!pledge.exists) revert PledgeNotFound();
        if (pledge.settled) revert PledgeAlreadySettled();

        Commitment memory c = commitments[pledge.commitmentId];
        if (msg.sender != pledge.sponsor && msg.sender != c.creator) {
            revert PledgeSettlementNotAuthorized();
        }

        pledge.settled = true;
        emit PledgeSettled(pledgeId, msg.sender);
    }
}
