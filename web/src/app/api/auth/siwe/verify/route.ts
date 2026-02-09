import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SiweMessage } from "siwe";
import { supabaseAdmin, supabaseServer } from "@/lib/supabaseServer";

const walletEmail = (address: string) => `wallet_${address}@baseline.invalid`;

const isDuplicateUserError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("already exists") ||
    normalized.includes("user already registered") ||
    normalized.includes("duplicate")
  );
};

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY on server." },
      { status: 500 }
    );
  }

  const cookieStore = await cookies();
  const nonce = cookieStore.get("siwe_nonce")?.value;

  if (!nonce) {
    return NextResponse.json({ error: "Missing nonce." }, { status: 400 });
  }

  const body = await request.json();
  const message = body?.message;
  const signature = body?.signature;

  if (!message || !signature) {
    return NextResponse.json(
      { error: "Missing SIWE message or signature." },
      { status: 400 }
    );
  }

  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(message);
  } catch (error) {
    return NextResponse.json({ error: "Invalid SIWE message." }, { status: 400 });
  }

  const host = request.headers.get("host") ?? "";

  try {
    const verifyResult = await siweMessage.verify({
      signature,
      nonce,
      domain: host,
      time: new Date().toISOString(),
    });

    if (!verifyResult.success) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  } catch (error) {
    return NextResponse.json({ error: "SIWE verification failed." }, { status: 401 });
  }

  const address = siweMessage.address.toLowerCase();
  const email = walletEmail(address);
  const metadata = { wallet_address: address, chain_id: siweMessage.chainId };

  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (createError && !isDuplicateUserError(createError.message)) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  const { data: linkData, error: linkError } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { data: metadata },
    });

  if (linkError || !linkData?.properties?.email_otp) {
    return NextResponse.json(
      { error: linkError?.message ?? "Failed to generate session link." },
      { status: 500 }
    );
  }

  if (linkData.user?.id) {
    await supabaseAdmin.auth.admin.updateUserById(linkData.user.id, {
      user_metadata: metadata,
    });
  }

  const { data: sessionData, error: verifyError } =
    await supabaseServer.auth.verifyOtp({
      email,
      token: linkData.properties.email_otp,
      type: "magiclink",
    });

  if (verifyError || !sessionData?.session) {
    return NextResponse.json(
      { error: verifyError?.message ?? "Failed to create session." },
      { status: 500 }
    );
  }

  cookieStore.set("siwe_nonce", "", { maxAge: 0, path: "/" });

  return NextResponse.json({
    session: sessionData.session,
    user: sessionData.user,
  });
}
