"use client";

import { cloneElement, isValidElement, useRef, useState } from "react";

import {
  BAG_OPTIONS,
  CABIN_BAG_OPTIONS,
  CHILD_SEAT_OPTIONS,
  DIRECTIONS,
  DIRECTION_HINTS,
  DIRECTION_LABELS,
  TRANSFER_FIELD_LABELS,
  DURATIONS,
  DURATION_LABELS,
  PAX_OPTIONS,
  PROPERTIES,
  ROUTES,
  ROUTE_LABELS,
  SERVICE_LABELS,
  SERVICE_TYPES,
  type Direction,
  type ServiceType,
} from "@/lib/catalog";
import { computePriceEuros } from "@/lib/pricing";
import {
  EMPTY_BOOKING,
  isValid,
  validateBooking,
  type BookingInput,
  type FieldErrors,
} from "@/lib/bookingSchema";
import { formatQuoteTotal, quoteInputsFor } from "@/lib/quote";
import { PriceCallout } from "./PriceCallout";
import { useQuote } from "./useQuote";

// Public booking form, migrated from the Guest Services /book page.
// Field names, allowed values and required/optional behaviour are preserved so
// the payload stays compatible with the authoritative Guest Services backend.
// No price is calculated here — Guest Services computes it server-side.

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

export function openPickerForInput(input: HTMLInputElement | null) {
  if (!input) return;

  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Browser refused (unsupported / not a user gesture). Focus still gives a
      // keyboard/user-operable control without changing the selected value.
    }
  }

  input.focus();
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  // Every control here is identified by its booking-field key, so wire the
  // label, id and name from this one place. Repeating them on each control
  // let some inputs drift without a `name`.
  const control = isValidElement<{ id?: string; name?: string }>(children)
    ? cloneElement(children, { id, name: id })
    : children;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PickerInput({
  id,
  type,
  value,
  ariaInvalid,
  onChange,
}: {
  id: keyof BookingInput;
  type: "date" | "time";
  value: string;
  ariaInvalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <span className="picker-control">
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onClick={(event) => openPickerForInput(event.currentTarget)}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={ariaInvalid}
      />
    </span>
  );
}

function Icon({ name }: { name: "car" | "tuktuk" | "plane" | "home" | "arrows" | "people" | "luggage" | "calendar" | "clock" | "pin" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    car: (
      <>
        <path d="M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16" />
        <rect x="3" y="16" width="18" height="4" rx="1.5" />
        <circle cx="7.5" cy="20" r="1.3" />
        <circle cx="16.5" cy="20" r="1.3" />
      </>
    ),
    tuktuk: (
      <>
        <path d="M5 17V9a3 3 0 0 1 3-3h4l4 5h2a2 2 0 0 1 2 2v4" />
        <path d="M5 17h14" />
        <circle cx="7.5" cy="19.3" r="1.5" />
        <circle cx="17.5" cy="19.3" r="1.5" />
      </>
    ),
    plane: (
      <>
        <path d="M22 2 11 13" />
        <path d="m22 2-7 20-4-9-9-4Z" />
      </>
    ),
    home: (
      <>
        <path d="m4 11 8-7 8 7" />
        <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
      </>
    ),
    arrows: (
      <>
        <path d="M7 16V6M4 9l3-3 3 3" />
        <path d="M17 8v10M14 15l3 3 3-3" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle cx="17" cy="9" r="2.3" />
        <path d="M15.5 14a5 5 0 0 1 5.5 5" />
      </>
    ),
    luggage: (
      <>
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" />
        <path d="M4 13h16" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    pin: (
      <>
        <path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12Z" />
        <circle cx="12" cy="10" r="2.3" />
      </>
    ),
  };

  return (
    <svg className="icn" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function SectionTitle({ icon, children }: { icon: React.ComponentProps<typeof Icon>["name"]; children: React.ReactNode }) {
  return (
    <legend className="section-label">
      <Icon name={icon} />
      {children}
    </legend>
  );
}

function directionIcon(direction: Direction): React.ComponentProps<typeof Icon>["name"] {
  if (direction === "airport-apt") return "plane";
  if (direction === "apt-airport") return "home";
  return "arrows";
}

function directionShort(direction: Direction) {
  if (direction === "airport-apt") return "Airport → Apt";
  if (direction === "apt-airport") return "Apt → Airport";
  return "Both ways";
}

export default function BookingForm() {
  const [values, setValues] = useState<BookingInput>(EMPTY_BOOKING);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  // Guards checkout against rapid repeat clicks; see onSubmit.
  const submitLock = useRef(false);

  const service = values.service as ServiceType;
  const direction = values.direction as Direction;

  // Estimated price. Inputs are null until the selection is priceable, which is
  // what keeps us from asking Guest Services too early. Changing service, pax,
  // direction or duration produces new inputs and therefore a fresh quote.
  const quoteState = useQuote(quoteInputsFor(values));

  function update<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setState({ kind: "idle" });
  }

  function selectService(next: ServiceType) {
    setValues((current) => ({ ...current, service: next }));
    setErrors({});
    setState({ kind: "idle" });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Double-submit guard. This MUST be a ref, not React state: several clicks
    // dispatched in the same task all observe the pre-render state value, so a
    // state-based check lets each one through and creates a Stripe session per
    // click. The ref flips synchronously on the first call.
    if (submitLock.current) return;
    submitLock.current = true;

    const found = validateBooking(values);
    setErrors(found);
    if (!isValid(found)) {
      setState({ kind: "error", message: "Please correct the highlighted fields." });
      submitLock.current = false;
      return;
    }

    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The displayed estimate is never sent: the server recomputes the
        // authoritative amount from these booking inputs.
        body: JSON.stringify(values),
      });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        ref?: string;
        error?: string;
        errors?: FieldErrors;
      } | null;

      if (!response.ok || typeof data?.url !== "string" || !data.url) {
        if (data?.errors) setErrors(data.errors);
        setState({
          kind: "error",
          message: data?.error ?? "Checkout is temporarily unavailable. Please try again in a moment.",
        });
        submitLock.current = false;
        return;
      }

      // Hand off to Stripe. The lock stays engaged: the browser is leaving, and
      // a session has already been created.
      setState({ kind: "redirecting" });
      window.location.assign(data.url);
    } catch {
      setState({ kind: "error", message: "Network error. Please check your connection and try again." });
      submitLock.current = false;
    }
  }

  const submitting = state.kind === "submitting" || state.kind === "redirecting";
  const transferDate =
    direction === "apt-airport" ? values.depDate : direction === "both" ? values.bthArrDate : values.arrDate;
  const transferTime =
    direction === "apt-airport" ? values.depPickup : direction === "both" ? values.bthArrTime : values.arrTime;

  return (
    <form className="booking-form" onSubmit={onSubmit} noValidate>
      {/* Service selection */}
      <fieldset className="service-toggle-wrap">
        <legend className="sr-only">Choose your service</legend>
        <div className="service-toggle" role="group" aria-label="Service type">
          {SERVICE_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              className={`service-btn ${service === option ? "active" : ""}`}
              aria-pressed={service === option}
              onClick={() => selectService(option)}
            >
              <Icon name={option === "transfer" ? "car" : "tuktuk"} />
              {SERVICE_LABELS[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="form-card">
      {/* Guest details */}
      <fieldset className="form-section">
        <SectionTitle icon="people">Guest details</SectionTitle>
        <div className="field-grid">
          <Field id="firstName" label="First name" error={errors.firstName}>
            <input
              id="firstName"
              name="firstName"
              value={values.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              aria-invalid={Boolean(errors.firstName)}
              autoComplete="given-name"
            />
          </Field>
          <Field id="lastName" label="Last name" error={errors.lastName}>
            <input
              id="lastName"
              name="lastName"
              value={values.lastName}
              onChange={(e) => update("lastName", e.target.value)}
              aria-invalid={Boolean(errors.lastName)}
              autoComplete="family-name"
            />
          </Field>
          <Field id="email" label="Email address" error={errors.email}>
            <input
              id="email"
              name="email"
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
              aria-invalid={Boolean(errors.email)}
              autoComplete="email"
            />
          </Field>
          <Field id="phone" label="Phone / WhatsApp" error={errors.phone}>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={values.phone}
              onChange={(e) => update("phone", e.target.value)}
              autoComplete="tel"
            />
          </Field>
          <Field id="hotel" label="Apartment" error={errors.hotel}>
            <select
              id="hotel"
              name="hotel"
              value={values.hotel}
              onChange={(e) => update("hotel", e.target.value)}
              aria-invalid={Boolean(errors.hotel)}
            >
              <option value="">— Select your apartment —</option>
              {PROPERTIES.map((property) => (
                <option key={property} value={property}>
                  {property}
                </option>
              ))}
            </select>
          </Field>
          <Field id="room" label="Room number (optional)">
            <input id="room" name="room" value={values.room} onChange={(e) => update("room", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {/* Transfer-specific */}
      {service === "transfer" ? (
        <fieldset className="form-section" data-testid="transfer-fields">
          <SectionTitle icon="plane">Arrival &amp; departure</SectionTitle>

          {/* Direction picker. /book renders these as clickable divs, which are
              not keyboard-reachable; the same design is kept here as a real
              radio group so it can be tabbed and arrowed through. */}
          <div
            className="direction-cards"
            role="radiogroup"
            aria-label="Direction"
            data-testid="direction-cards"
          >
            {DIRECTIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={values.direction === value}
                className={`dir-card ${values.direction === value ? "selected" : ""}`}
                onClick={() => update("direction", value)}
              >
                <span className="dir-icon">
                  <Icon name={directionIcon(value)} />
                </span>
                <span className="dir-name">{DIRECTION_LABELS[value]}</span>
                <span className="dir-hint">{DIRECTION_HINTS[value]}</span>
              </button>
            ))}
          </div>
          {errors.direction ? (
            <p className="field-error" role="alert">
              {errors.direction}
            </p>
          ) : null}

          {direction === "airport-apt" || direction === "both" ? (
            <div className="field-grid" data-testid="arrival-fields">
              <Field
                id={direction === "both" ? "bthArrDate" : "arrDate"}
                label="Arrival date"
                error={direction === "both" ? errors.bthArrDate : errors.arrDate}
              >
                <PickerInput
                  id={direction === "both" ? "bthArrDate" : "arrDate"}
                  type="date"
                  value={direction === "both" ? values.bthArrDate : values.arrDate}
                  ariaInvalid={Boolean(direction === "both" ? errors.bthArrDate : errors.arrDate)}
                  onChange={(value) => update(direction === "both" ? "bthArrDate" : "arrDate", value)}
                />
              </Field>
              <Field
                id={direction === "both" ? "bthArrFlight" : "arrFlight"}
                label={TRANSFER_FIELD_LABELS.arrFlight[direction === "both" ? "both" : "oneWay"]}
              >
                <input
                  id={direction === "both" ? "bthArrFlight" : "arrFlight"}
                  value={direction === "both" ? values.bthArrFlight : values.arrFlight}
                  onChange={(e) => update(direction === "both" ? "bthArrFlight" : "arrFlight", e.target.value)}
                />
              </Field>
              <Field id={direction === "both" ? "bthArrTime" : "arrTime"} label="Landing time">
                <PickerInput
                  id={direction === "both" ? "bthArrTime" : "arrTime"}
                  type="time"
                  value={direction === "both" ? values.bthArrTime : values.arrTime}
                  onChange={(value) => update(direction === "both" ? "bthArrTime" : "arrTime", value)}
                />
              </Field>
              <Field
                id={direction === "both" ? "bthArrOrigin" : "arrOrigin"}
                label={TRANSFER_FIELD_LABELS.arrOrigin[direction === "both" ? "both" : "oneWay"]}
              >
                <input
                  id={direction === "both" ? "bthArrOrigin" : "arrOrigin"}
                  value={direction === "both" ? values.bthArrOrigin : values.arrOrigin}
                  onChange={(e) => update(direction === "both" ? "bthArrOrigin" : "arrOrigin", e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {direction === "apt-airport" || direction === "both" ? (
            <div className="field-grid" data-testid="departure-fields">
              <Field
                id={direction === "both" ? "bthDepDate" : "depDate"}
                label="Departure date"
                error={direction === "both" ? errors.bthDepDate : errors.depDate}
              >
                <PickerInput
                  id={direction === "both" ? "bthDepDate" : "depDate"}
                  type="date"
                  value={direction === "both" ? values.bthDepDate : values.depDate}
                  ariaInvalid={Boolean(direction === "both" ? errors.bthDepDate : errors.depDate)}
                  onChange={(value) => update(direction === "both" ? "bthDepDate" : "depDate", value)}
                />
              </Field>
              <Field
                id={direction === "both" ? "bthDepFlight" : "depFlight"}
                label={TRANSFER_FIELD_LABELS.depFlight[direction === "both" ? "both" : "oneWay"]}
              >
                <input
                  id={direction === "both" ? "bthDepFlight" : "depFlight"}
                  value={direction === "both" ? values.bthDepFlight : values.depFlight}
                  onChange={(e) => update(direction === "both" ? "bthDepFlight" : "depFlight", e.target.value)}
                />
              </Field>
              <Field id={direction === "both" ? "bthDepPickup" : "depPickup"} label="Pick-up time at apartment">
                <PickerInput
                  id={direction === "both" ? "bthDepPickup" : "depPickup"}
                  type="time"
                  value={direction === "both" ? values.bthDepPickup : values.depPickup}
                  onChange={(value) => update(direction === "both" ? "bthDepPickup" : "depPickup", value)}
                />
              </Field>
              <Field
                id={direction === "both" ? "bthDepDest" : "depDest"}
                label={TRANSFER_FIELD_LABELS.depDest[direction === "both" ? "both" : "oneWay"]}
              >
                <input
                  id={direction === "both" ? "bthDepDest" : "depDest"}
                  value={direction === "both" ? values.bthDepDest : values.depDest}
                  onChange={(e) => update(direction === "both" ? "bthDepDest" : "depDest", e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          <div className="transfer-summary-grid">
            <div className="summary-card">
              <span className="summary-card-icon">
                <Icon name="calendar" />
              </span>
              <span>
                <span className="summary-card-label">Date &amp; time</span>
                <strong>{transferDate || "—"} {transferTime || "--:--"}</strong>
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-card-icon">
                <Icon name="pin" />
              </span>
              <span>
                <span className="summary-card-label">Pickup / drop-off</span>
                <strong>{directionShort(direction)}</strong>
              </span>
            </div>
          </div>

          <section className="passenger-section" aria-labelledby="passenger-count-title">
            <div className="passenger-heading">
              <span className="passenger-icon">
                <Icon name="people" />
              </span>
              <div>
                <h2 id="passenger-count-title">Passenger count</h2>
                <p>Select the number of passengers to see your price options.</p>
              </div>
            </div>
            <input id="pax" name="pax" type="hidden" value={values.pax ?? ""} />
            <div className="pax-grid" role="radiogroup" aria-label="Number of passengers">
              {PAX_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  role="radio"
                  aria-checked={values.pax === count}
                  className={`pax-card ${values.pax === count ? "selected" : ""}`}
                  onClick={() => update("pax", count)}
                >
                  <span className="pax-card-title">
                    <span className="pax-card-icon">
                      <Icon name="people" />
                    </span>
                    {count} PAX
                  </span>
                  <span className="pax-prices">
                    {DIRECTIONS.map((option) => {
                      const price = computePriceEuros({ service: "transfer", pax: count, direction: option });
                      const isActive = values.pax === count && direction === option;
                      return (
                        <span className="pax-row" key={option}>
                          <span>{directionShort(option)}</span>
                          <span className={`pax-val ${isActive ? "active-price" : ""}`}>{price}€</span>
                        </span>
                      );
                    })}
                  </span>
                </button>
              ))}
            </div>
            {errors.pax ? (
              <p className="field-error" role="alert">
                {errors.pax}
              </p>
            ) : null}
            <PriceCallout state={quoteState} />
            <div className="good-to-know">
              <span className="good-to-know-icon">
                <Icon name="plane" />
              </span>
              <span>
                <strong>Good to know</strong>
                Prices are fixed per vehicle. All trips include tolls, taxes and up to 60 minutes of waiting time.
              </span>
            </div>
          </section>

        </fieldset>
      ) : null}

      {/* Luggage & comforts — /book groups these separately from the flight
          details rather than running one long transfer section. */}
      {service === "transfer" ? (
        <fieldset className="form-section" data-testid="luggage-fields">
          <SectionTitle icon="luggage">Luggage &amp; comforts</SectionTitle>

          <div className="field-grid field-grid-3">
            <Field id="bagsCheckin" label="Check-in bags">
              <select id="bagsCheckin" value={values.bagsCheckin} onChange={(e) => update("bagsCheckin", e.target.value)}>
                {BAG_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o} bags</option>
                ))}
              </select>
            </Field>
            <Field id="bagsCabin" label="Cabin bags">
              <select id="bagsCabin" value={values.bagsCabin} onChange={(e) => update("bagsCabin", e.target.value)}>
                {CABIN_BAG_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o} bags</option>
                ))}
              </select>
            </Field>
            <Field id="childSeats" label="Child seats">
              <select id="childSeats" value={values.childSeats} onChange={(e) => update("childSeats", e.target.value)}>
                {CHILD_SEAT_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o === "0" ? "None" : `${o} seat${o === "1" ? "" : "s"}`}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="transferNotes" label="Additional notes (optional)">
            <input
              id="transferNotes"
              value={values.transferNotes}
              onChange={(e) => update("transferNotes", e.target.value)}
            />
          </Field>
        </fieldset>
      ) : null}

      {/* Tuk-tuk specific */}
      {service === "tuktuk" ? (
        <fieldset className="form-section" data-testid="tuktuk-fields">
          <SectionTitle icon="tuktuk">Tuk-tuk tour details</SectionTitle>

          <Field id="route" label="Preferred route" error={errors.route}>
            <select id="route" value={values.route ?? ""} onChange={(e) => update("route", e.target.value || null)}>
              <option value="">— No preference —</option>
              {ROUTES.map((value) => (
                <option key={value} value={value}>
                  {ROUTE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field id="durationMins" label="Tour duration" error={errors.durationMins}>
            <select
              id="durationMins"
              value={values.durationMins ?? ""}
              onChange={(e) => update("durationMins", e.target.value ? Number(e.target.value) : null)}
              aria-invalid={Boolean(errors.durationMins)}
            >
              <option value="">— Select duration —</option>
              {DURATIONS.map((mins) => (
                <option key={mins} value={mins}>
                  {DURATION_LABELS[mins]}
                </option>
              ))}
            </select>
          </Field>

          <PriceCallout state={quoteState} />

          <div className="field-grid">
            <Field id="tuktukDate" label="Tour date" error={errors.tuktukDate}>
              <PickerInput
                id="tuktukDate"
                type="date"
                value={values.tuktukDate}
                ariaInvalid={Boolean(errors.tuktukDate)}
                onChange={(value) => update("tuktukDate", value)}
              />
            </Field>
            <Field id="tuktukTime" label="Pick-up time at apartment door">
              <PickerInput
                id="tuktukTime"
                type="time"
                value={values.tuktukTime}
                onChange={(value) => update("tuktukTime", value)}
              />
            </Field>
            <Field id="tuktukPax" label="Number of passengers">
              <input
                id="tuktukPax"
                type="number"
                min="1"
                max="6"
                value={values.tuktukPax}
                onChange={(e) => update("tuktukPax", e.target.value)}
              />
            </Field>
          </div>

          <Field id="tuktukNotes" label="Special requests (optional)">
            <input
              id="tuktukNotes"
              value={values.tuktukNotes}
              onChange={(e) => update("tuktukNotes", e.target.value)}
            />
          </Field>
        </fieldset>
      ) : null}

      {/* Submit + states */}
      <div className="submit-wrap">
        {/* Summary total. Only shown once a quote for the CURRENT selection has
            arrived, so a stale figure can never sit next to the submit button. */}
        {quoteState.status === "ready" ? (
          <p className="summary-total" data-testid="summary-total">
            <span className="summary-total-label">Estimated total</span>
            <span className="summary-total-value">{formatQuoteTotal(quoteState.quote)}</span>
          </p>
        ) : null}
        {quoteState.status === "loading" ? (
          <p className="summary-total" data-testid="summary-total-updating">
            <span className="summary-total-label">Estimated total</span>
            <span className="summary-total-value price-callout-pending">Updating…</span>
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="submit-error" role="alert" data-testid="form-error">
            {state.message}
          </p>
        ) : null}
        <p className="submit-note">
          A member of our concierge team will follow up shortly to confirm every detail.
        </p>
        <button type="submit" className="submit-btn" disabled={submitting} data-testid="submit">
          {state.kind === "redirecting"
            ? "Redirecting to secure checkout…"
            : state.kind === "submitting"
              ? "Starting secure checkout…"
              : "Continue to payment"}
        </button>
      </div>
      </div>
    </form>
  );
}
