export const habitRegistryAbi = [
  {
    type: "function",
    name: "reviewWindowSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createCommitment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "habitHash", type: "bytes32" },
      { name: "cadence", type: "uint256" },
      { name: "startDate", type: "uint256" },
    ],
    outputs: [{ name: "commitmentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "checkIn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitmentId", type: "uint256" },
      { name: "proofHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "createPledge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitmentId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "minCheckIns", type: "uint256" },
    ],
    outputs: [{ name: "pledgeId", type: "uint256" }],
  },
  {
    type: "function",
    name: "markCommitmentCompleted",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitmentId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settlePledgeBySponsor",
    stateMutability: "nonpayable",
    inputs: [{ name: "pledgeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settlePledgeNoResponse",
    stateMutability: "nonpayable",
    inputs: [{ name: "pledgeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settlePledge",
    stateMutability: "nonpayable",
    inputs: [{ name: "pledgeId", type: "uint256" }],
    outputs: [],
  },
] as const;

export type HabitRegistryAbi = typeof habitRegistryAbi;
