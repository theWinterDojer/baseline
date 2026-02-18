This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Wallet Auth Behavior

- Wallet connection and wallet sign-in are separate:
  - Connect wallet via RainbowKit.
  - Authenticate with SIWE via `Sign in with wallet`.
- If connected wallet changes and no longer matches active session wallet metadata, app signs out stale session and routes to `/`.
- After wallet-switch sign-out, SIWE stays manual-only (no automatic sign prompt).
- Public-goal check-ins can auto-refresh stale on-chain commitment anchors after contract upgrades, but only when there are no active sponsorship pledges.

## Dashboard Behavior

- Header navigation uses dedicated actions for `Discover`, `Settings`, and `Sign out`.
- Owner `Your goals` card is owner-only data (recent activity + owned goals) and does not include public-goal preview cards.
- `Recent activity` and `Goals` each use compact, conditional overflow scrolling for dense accounts.
