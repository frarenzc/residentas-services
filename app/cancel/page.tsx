import Link from "next/link";

// Public cancelled-payment landing. Mirrors the existing Guest Services
// /book/cancel semantics: nothing was charged and no booking was created.
export default function CancelPage() {
  return (
    <main className="status-wrap">
      <div className="status-card">
        <div className="status-icon status-icon-cancel" aria-hidden>
          ×
        </div>
        <h1 className="status-title">Payment not completed</h1>
        <p className="status-body">
          Your payment was cancelled, so nothing has been charged and no booking was created. You
          can start again whenever you are ready — it only takes a moment.
        </p>
        <Link href="/" className="status-link">
          Back to booking
        </Link>
      </div>
    </main>
  );
}
