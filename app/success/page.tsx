import Link from "next/link";

// Public post-payment landing. Mirrors the existing Guest Services
// /book/success semantics: the booking is finalised by the Stripe webhook, so
// this page reassures without asserting anything the backend has not confirmed.
/** A reference is only shown if it looks like one we generated. */
function safeRef(value: string | undefined): string | null {
  return typeof value === "string" && /^RES-[0-9A-Z]{1,12}$/.test(value) ? value : null;
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  // Only `ref` is read. Stripe session details are never displayed, and no
  // booking data is fetched from the browser.
  const ref = safeRef((await searchParams).ref);

  return (
    <main className="status-wrap">
      <div className="status-card">
        <div className="status-icon status-icon-ok" aria-hidden>
          ✓
        </div>
        <h1 className="status-title">Payment received</h1>
        <p className="status-body">
          Thank you — your payment went through and your request is being finalised. Our concierge
          team will confirm the details with you shortly.
        </p>
        {ref ? (
          <p className="status-ref">
            Booking reference: <strong>{ref}</strong>
          </p>
        ) : null}
        <p className="status-body status-muted">
          Confirmation can take a moment to appear. If you have any questions, reply to your booking
          email or contact your apartment host{ref ? " quoting the reference above" : ""}.
        </p>
        <Link href="/" className="status-link">
          Make another booking
        </Link>
      </div>
    </main>
  );
}
