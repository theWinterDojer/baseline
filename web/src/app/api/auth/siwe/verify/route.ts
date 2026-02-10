import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SiweMessage } from "siwe";
import { supabaseAdmin, supabaseServer } from "@/lib/supabaseServer";

const walletEmail = (address: string) => `wallet_${address}@baseline.test`;

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

const findUserByWalletAddress = async (
  address: string,
  adminClient: NonNullable<typeof supabaseAdmin>
) => {
  const perPage = 200;
  let page = 1;

  while (page <= 10) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return { error };
    }

    const user = data.users.find((candidate) => {
      const walletAddress = candidate.user_metadata?.wallet_address;
      return typeof walletAddress === "string" && walletAddress.toLowerCase() === address;
    });

    if (user) {
      return { user };
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return {};
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
  } catch {
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
  } catch {
    return NextResponse.json({ error: "SIWE verification failed." }, { status: 401 });
  }

  const address = siweMessage.address.toLowerCase();
  const { user: existingUser, error: userLookupError } =
    await findUserByWalletAddress(address, supabaseAdmin);

  if (userLookupError) {
    return NextResponse.json({ error: userLookupError.message }, { status: 500 });
  }

  const metadata = {
    ...(existingUser?.user_metadata ?? {}),
    wallet_address: address,
    chain_id: siweMessage.chainId,
  };

  const existingEmail = existingUser?.email;
  const normalizedEmail =
    !existingEmail || existingEmail.endsWith("@baseline.invalid")
      ? walletEmail(address)
      : existingEmail;
  const email = normalizedEmail;
  const shouldCreateUser = !existingUser;

  if (shouldCreateUser) {
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (createError && !isDuplicateUserError(createError.message)) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
  } else if (existingUser?.id) {
    await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      ...(existingEmail !== normalizedEmail
        ? { email: normalizedEmail, email_confirm: true }
        : {}),
      user_metadata: metadata,
    });
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
