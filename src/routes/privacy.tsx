import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PublicAppShell } from "@/components/arc/PublicAppShell";

const TITLE = "Privacy — Ayden's Revenue Compass";
const DESCRIPTION =
  "How Ayden's Revenue Compass (ARC) handles sign-in email, contract data, uploaded PDFs and AI processing.";
const CONTACT = "arcompass.developer@gmail.com";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <PublicAppShell>
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Privacy</h1>
          <p className="text-sm text-muted-foreground">Last updated: September 26, 2026</p>
          <p className="text-sm leading-6 text-muted-foreground">
            This statement describes how Ayden&apos;s Revenue Compass (ARC) handles information
            when you use the service at ayden-rc.com.
          </p>
        </header>

        <Block title="Information ARC collects">
          <p>
            <strong className="text-foreground">Account email.</strong> If you sign in, ARC uses
            your email address to send a one-time sign-in link. ARC does not use passwords.
          </p>
          <p>
            <strong className="text-foreground">Contract facts and judgments.</strong> The customer,
            contract terms, accounting judgments and other inputs you enter are processed to
            produce the analysis. Signed-in users can save analyses to My Contracts.
          </p>
          <p>
            <strong className="text-foreground">Uploaded PDFs.</strong> Contract PDFs you upload are
            stored in private storage and are opened through short-lived private links, not public
            addresses.
          </p>
        </Block>

        <Block title="Guest use">
          <p>
            You can use ARC without an account. A guest workspace expires nine hours after it is
            created; after expiry it can no longer be opened, and ARC&apos;s scheduled maintenance
            removes expired guest workspaces and their files.
          </p>
        </Block>

        <Block title="AI processing">
          <p>
            When you start an AI analysis, text is extracted on the server from the PDFs you
            selected and sent to OpenAI for contract-analysis processing. The full extracted page
            text used for the AI analysis is temporary and is not saved.
          </p>
          <p>
            The uploaded source PDFs, the structured analysis, and references linking AI-drafted
            content to its source may be kept as part of your workspace or saved contract.
            AI-drafted content is presented for review: you can accept it, change it, or resolve
            items manually. The number of AI runs is limited per guest workspace or account.
          </p>
        </Block>

        <Block title="Service providers and sharing">
          <p>
            ARC does not sell personal information. ARC uses service providers, including Lovable
            (hosting), Supabase (database, file storage and sign-in), OpenAI (contract-analysis
            processing) and Resend (sign-in email delivery), to operate the service.
          </p>
        </Block>

        <Block title="Browser storage and cookies">
          <p>
            ARC keeps your sign-in session in your browser&apos;s local storage, and uses a secure,
            HTTP-only cookie to reconnect you to your guest workspace. These are needed for the
            service to work.
          </p>
        </Block>

        <Block title="Security">
          <p>
            ARC uses access controls designed to restrict signed-in users to their own saved data
            and private files, and guest visitors to their own temporary workspace. No online
            service can guarantee absolute security.
          </p>
        </Block>

        <Block title="Your choices and deletion">
          <p>
            Signed-in users can delete their account from Account settings. Deletion removes the
            account together with the data it owns — saved customers, contracts and analyses — and
            purges associated temporary guest data. Guest data you do not save expires
            automatically as described above.
          </p>
        </Block>

        <Block title="Changes to this statement">
          <p>
            If this statement changes, the updated version will be posted on this page with a new
            &ldquo;Last updated&rdquo; date.
          </p>
        </Block>

        <Block title="Contact">
          <p>
            Questions about privacy can be sent to{" "}
            <a
              href={`mailto:${CONTACT}`}
              className="text-foreground underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CONTACT}
            </a>
            .
          </p>
        </Block>
      </main>
    </PublicAppShell>
  );
}
