export type MockCommitment = {
  id: string;
  habitHash: string;
  cadence: string;
  startDate: string;
  creator?: string;
  createdAt: string;
};

export type MockCheckIn = {
  id: string;
  commitmentId: string;
  proofHash: string | null;
  timestamp: string;
  createdAt: string;
};

export type MockPledgeStatus = "active" | "settled";

export type MockPledge = {
  id: string;
  commitmentId: string;
  amount: string;
  deadline: string;
  minCheckIns: string;
  sponsor?: string;
  status: MockPledgeStatus;
  createdAt: string;
  settledAt?: string;
};

type MockState = {
  commitmentSeq: number;
  pledgeSeq: number;
  checkInSeq: number;
  commitments: MockCommitment[];
  pledges: MockPledge[];
  checkIns: MockCheckIn[];
};

type Stringish = string | number | bigint;

const STORAGE_KEY = "baseline.mockHabitRegistry.v1";

const defaultState = (): MockState => ({
  commitmentSeq: 0,
  pledgeSeq: 0,
  checkInSeq: 0,
  commitments: [],
  pledges: [],
  checkIns: [],
});

let cachedState: MockState | null = null;

const loadState = (): MockState => {
  if (cachedState) return cachedState;
  if (typeof window === "undefined") {
    cachedState = defaultState();
    return cachedState;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      cachedState = defaultState();
      return cachedState;
    }
    const parsed = JSON.parse(stored) as MockState;
    cachedState = parsed;
    return parsed;
  } catch {
    cachedState = defaultState();
    return cachedState;
  }
};

const persistState = (state: MockState) => {
  cachedState = state;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence errors in mock.
  }
};

const asString = (value: Stringish) => value.toString();

const nextId = (current: number) => ({
  id: (current + 1).toString(),
  next: current + 1,
});

export const mockHabitRegistry = {
  async createCommitment(params: {
    habitHash: string;
    cadence: Stringish;
    startDate: Stringish;
    creator?: string;
  }) {
    const state = loadState();
    const { id, next } = nextId(state.commitmentSeq);
    const commitment: MockCommitment = {
      id,
      habitHash: params.habitHash,
      cadence: asString(params.cadence),
      startDate: asString(params.startDate),
      creator: params.creator,
      createdAt: new Date().toISOString(),
    };

    const nextState: MockState = {
      ...state,
      commitmentSeq: next,
      commitments: [commitment, ...state.commitments],
    };

    persistState(nextState);

    return { commitmentId: id, commitment };
  },

  async checkIn(params: {
    commitmentId: Stringish;
    proofHash?: string | null;
    timestamp: Stringish;
  }) {
    const state = loadState();
    const commitmentId = asString(params.commitmentId);
    const commitment = state.commitments.find((item) => item.id === commitmentId);

    if (!commitment) {
      throw new Error("Commitment not found.");
    }

    const { id, next } = nextId(state.checkInSeq);
    const checkIn: MockCheckIn = {
      id,
      commitmentId,
      proofHash: params.proofHash ?? null,
      timestamp: asString(params.timestamp),
      createdAt: new Date().toISOString(),
    };

    const nextState: MockState = {
      ...state,
      checkInSeq: next,
      checkIns: [checkIn, ...state.checkIns],
    };

    persistState(nextState);

    return { checkInId: id, checkIn };
  },

  async createPledge(params: {
    commitmentId: Stringish;
    amount: Stringish;
    deadline: Stringish;
    minCheckIns: Stringish;
    sponsor?: string;
  }) {
    const state = loadState();
    const commitmentId = asString(params.commitmentId);
    const commitment = state.commitments.find((item) => item.id === commitmentId);

    if (!commitment) {
      throw new Error("Commitment not found.");
    }

    const { id, next } = nextId(state.pledgeSeq);
    const pledge: MockPledge = {
      id,
      commitmentId,
      amount: asString(params.amount),
      deadline: asString(params.deadline),
      minCheckIns: asString(params.minCheckIns),
      sponsor: params.sponsor,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    const nextState: MockState = {
      ...state,
      pledgeSeq: next,
      pledges: [pledge, ...state.pledges],
    };

    persistState(nextState);

    return { pledgeId: id, pledge };
  },

  async settlePledge(params: { pledgeId: Stringish }) {
    const state = loadState();
    const pledgeId = asString(params.pledgeId);
    const pledgeIndex = state.pledges.findIndex((item) => item.id === pledgeId);

    if (pledgeIndex === -1) {
      throw new Error("Pledge not found.");
    }

    const pledge = state.pledges[pledgeIndex];
    const updated: MockPledge = {
      ...pledge,
      status: "settled",
      settledAt: new Date().toISOString(),
    };

    const nextPledges = [...state.pledges];
    nextPledges[pledgeIndex] = updated;

    const nextState: MockState = {
      ...state,
      pledges: nextPledges,
    };

    persistState(nextState);

    return { pledge: updated };
  },

  listCommitments() {
    return loadState().commitments;
  },

  listPledges(commitmentId?: Stringish) {
    const { pledges } = loadState();
    if (!commitmentId) return pledges;
    const id = asString(commitmentId);
    return pledges.filter((item) => item.commitmentId === id);
  },

  listCheckIns(commitmentId?: Stringish) {
    const { checkIns } = loadState();
    if (!commitmentId) return checkIns;
    const id = asString(commitmentId);
    return checkIns.filter((item) => item.commitmentId === id);
  },

  reset() {
    const state = defaultState();
    persistState(state);
    return state;
  },
};
