// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

contract HabitRegistry {
    error CadenceZero();
    error CommitmentNotFound();
    error NotCommitmentCreator();
    error TimestampZero();
    error ProofHashZero();
    error PledgeFlowDisabled();

    struct Commitment {
        address creator;
        bytes32 habitHash;
        uint256 cadence;
        uint256 startDate;
        uint256 createdAt;
        bool exists;
    }

    uint256 private _nextCommitmentId = 1;

    mapping(uint256 => Commitment) public commitments;

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
        uint256,
        uint256,
        uint256,
        uint256
    ) external payable returns (uint256) {
        revert PledgeFlowDisabled();
    }

    function settlePledge(uint256) external {
        revert PledgeFlowDisabled();
    }
}
