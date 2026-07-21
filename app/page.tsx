import Image from "next/image";

import BookingForm from "@/components/BookingForm";

// Public booking entry point. Served at https://services.residentas.com/
// No authentication — this route must remain reachable by guests.
export default function BookingPage() {
  return (
    <main className="page-wrap">
      <header className="hero">
        {/* Decorative property photograph behind a scrim, as on /book. */}
        <Image
          src="/brand/arco-do-bandeira.jpg"
          alt=""
          fill
          sizes="100vw"
          className="hero-photo"
          priority
          aria-hidden
        />
        <div className="hero-scrim" />
        <div className="hero-logo">
          <Image
            src="/brand/residentas-logo.png"
            alt="Residentas Portugal"
            width={414}
            height={96}
            className="brand-logo-img"
            priority
          />
        </div>
        <p className="hero-eyebrow">Private arrivals · Signature stays</p>
        <h1 className="hero-title">Reserve your Lisbon arrival with ease</h1>
        <p className="hero-sub">
          Thoughtful airport transfers and curated tuk-tuk experiences, arranged for your stay.
        </p>
      </header>
      <BookingForm />
    </main>
  );
}
