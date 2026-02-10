import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabaseServer";

const walletEmail = (address: string) => `wallet_${address}@baseline.test`;

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY on server." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return NextResponse.json({ error: "Missing access token." }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(
    accessToken
  );

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const user = userData.user;
  const walletAddressRaw = user.user_metadata?.wallet_address;

  if (typeof walletAddressRaw !== "string" || !walletAddressRaw.trim()) {
    return NextResponse.json(
      { error: "Missing wallet_address metadata." },
      { status: 400 }
    );
  }

  const walletAddress = walletAddressRaw.toLowerCase();
  const currentEmail = user.email ?? "";

  if (!currentEmail.endsWith("@baseline.invalid")) {
    return NextResponse.json({ normalized: false });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    {
      email: walletEmail(walletAddress),
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        wallet_address: walletAddress,
      },
    }
  );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ normalized: true });
}
