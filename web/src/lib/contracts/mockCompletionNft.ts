type MintResult = {
  tokenId: string;
  txHash: string;
};

const randomHex = (bytes: number) => {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  let value = "";
  for (let i = 0; i < bytes; i += 1) {
    value += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return value;
};

export const mockCompletionNft = {
  async mint(): Promise<MintResult> {
    const tokenId = parseInt(randomHex(4), 16).toString();
    const txHash = `0x${randomHex(32)}`;
    return { tokenId, txHash };
  },
};
