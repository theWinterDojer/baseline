import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateNonce } from "siwe";

export async function POST() {
  const cookieStore = await cookies();
  const nonce = generateNonce();
  cookieStore.set("siwe_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.json({ nonce });
}
