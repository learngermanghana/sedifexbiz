import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { useActiveStore } from "../hooks/useActiveStore";
import "./Bookings.css";

type BookingRecord = {
  id: string;
  serviceId: string;
  serviceName: string;
  bookingDate: string | null;
  bookingTime: string | null;
  preferredBranch: string | null;
  paymentAmount: string | null;
  paymentMethod: string | null;
  status: string;
  bookingStatus: string;
  syncStatus: string;
  paymentStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  sourceLabel: string;
  reference: string | null;
  bookingId: string | null;
  paymentReference: string | null;
  duplicateMerged: boolean;
  sourcePath: "store" | "root" | "order";
  payment: Record<string, unknown>;
};

function pickString(
  data: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}

function pickTimestamp(
  data: Record<string, unknown>,
  keys: string[],
): Date | null {
  for (const key of keys) {
    const value = data[key];
    if (
      value &&
      typeof value === "object" &&
      typeof (value as Timestamp).toDate === "function"
    ) {
      return (value as Timestamp).toDate();
    }
  }
  return null;
}

const normalizeStatus = (value: unknown, fallback = "pending") =>
  typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : fallback;

const normalizePaymentStatus = (value: unknown) => {
  const normalized = normalizeStatus(value, "pending");
  if (["success", "confirmed", "paid"].includes(normalized)) return "paid";
  if (["payment_pending", "pending"].includes(normalized))
    return "payment_pending";
  return normalized;
};

const normalizeSource = (raw: unknown) => {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value.includes("market")) return "Sedifex Market";
  if (value.includes("website")) return "Website";
  if (value.includes("manual")) return "Manual";
  return "Website";
};

const statusLabel = (status: string) =>
  ({
    pending_approval: "Needs approval",
    pending: "Needs approval",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    deleted: "Cancelled",
    manual_review: "Manual review",
  })[status] ?? "Pending approval";

const paymentLabel = (status: string) =>
  ({
    payment_pending: "Payment pending",
    pending: "Payment pending",
    manual_review: "Manual review",
    paid: "Paid",
  })[status] ?? "Payment pending";

export default function Bookings() {
  const { storeId } = useActiveStore();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"paid_sedifex" | "direct_needs_approval">("paid_sedifex");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("30d");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");

  const hydrateBooking = useCallback(
    (
      id: string,
      data: Record<string, unknown>,
      serviceMap: Map<string, string>,
      sourcePath: "store" | "root" | "order",
    ) => {
      const nestedData =
        data.data && typeof data.data === "object"
          ? (data.data as Record<string, unknown>)
          : {};
      const customer =
        data.customer && typeof data.customer === "object"
          ? (data.customer as Record<string, unknown>)
          : {};
      const booking =
        data.booking && typeof data.booking === "object"
          ? (data.booking as Record<string, unknown>)
          : {};
      const payment =
        data.payment && typeof data.payment === "object"
          ? (data.payment as Record<string, unknown>)
          : {};
      const metadata =
        data.metadata && typeof data.metadata === "object"
          ? (data.metadata as Record<string, unknown>)
          : {};
      const firstItem =
        Array.isArray(data.items) &&
        data.items[0] &&
        typeof data.items[0] === "object"
          ? (data.items[0] as Record<string, unknown>)
          : {};
      const serviceId =
        pickString(data, ["serviceId"]) ??
        pickString(booking, ["serviceId"]) ??
        pickString(metadata, ["serviceId", "slotId", "itemId"]) ??
        pickString(firstItem, ["serviceId", "slotId", "itemId", "item_id"]) ??
        "—";
      const snapshotA =
        data.pricingSnapshot && typeof data.pricingSnapshot === "object"
          ? (data.pricingSnapshot as Record<string, unknown>)
          : {};
      const snapshotB =
        data.pricing_snapshot && typeof data.pricing_snapshot === "object"
          ? (data.pricing_snapshot as Record<string, unknown>)
          : {};
      const pickSnapshotName = (snapshot: Record<string, unknown>) => {
        const items = snapshot.items;
        if (
          !Array.isArray(items) ||
          !items.length ||
          typeof items[0] !== "object" ||
          !items[0]
        )
          return null;
        const first = items[0] as Record<string, unknown>;
        return typeof first.name === "string" && first.name.trim()
          ? first.name.trim()
          : null;
      };
      const serviceName =
        pickString(data, [
          "serviceName",
          "internalServiceName",
          "itemName",
          "productName",
        ]) ??
        pickString(booking, ["serviceName"]) ??
        pickString(nestedData, ["serviceName", "itemName"]) ??
        pickString(metadata, ["serviceName", "itemName"]) ??
        pickString(firstItem, ["serviceName", "name", "itemName"]) ??
        pickSnapshotName(snapshotA) ??
        pickSnapshotName(snapshotB) ??
        serviceMap.get(serviceId) ??
        "Service not named";

      return {
        id,
        serviceId,
        serviceName,
        bookingDate:
          pickString(data, ["bookingDate", "date"]) ??
          pickString(booking, ["preferredDate", "date"]) ??
          pickString(metadata, ["bookingDate", "eventDate"]),
        bookingTime:
          pickString(data, ["bookingTime", "time"]) ??
          pickString(booking, ["preferredTime", "time"]),
        preferredBranch: pickString(data, [
          "preferredBranch",
          "branch",
          "location",
        ]),
        paymentAmount:
          pickString(data, ["paymentAmount", "amount", "total", "price"]) ??
          pickString(payment, ["amount"]),
        paymentMethod:
          pickString(data, ["paymentMethod"]) ??
          pickString(payment, ["method"]),
        bookingStatus: normalizeStatus(data.bookingStatus ?? data.status),
        status: normalizeStatus(data.status),
        syncStatus: normalizeStatus(
          data.syncStatus ?? data.sync_status,
          "not_ready",
        ),
        paymentStatus:
          payment.confirmed === true
            ? "paid"
            : normalizePaymentStatus(
                data.paymentStatus ?? data.payment_status ?? payment.status,
              ),
        customerName:
          pickString(data, ["customerName", "name"]) ??
          pickString(customer, ["name"]),
        customerPhone:
          pickString(data, ["customerPhone", "phone"]) ??
          pickString(customer, ["phone"]),
        customerEmail:
          pickString(data, ["customerEmail", "email"]) ??
          pickString(customer, ["email"]),
        createdAt: pickTimestamp(data, [
          "createdAt",
          "createdAtServer",
          "updatedAt",
          "syncRequestedAt",
        ]),
        updatedAt: pickTimestamp(data, ["updatedAt"]),
        sourceLabel: normalizeSource(
          data.sourceChannel ??
            data.source_channel ??
            data.source ??
            data.channel,
        ),
        reference:
          pickString(data, ["reference"]) ?? pickString(payment, ["reference"]),
        bookingId: pickString(data, ["bookingId"]),
        paymentReference:
          pickString(data, ["paymentReference"]) ??
          pickString(payment, ["reference"]),
        duplicateMerged: false,
        sourcePath,
        payment,
      } satisfies BookingRecord;
    },
    [],
  );

  const loadBookings = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const serviceMap = new Map<string, string>();
      for (const collectionName of [
        "services",
        "integrationServices",
        "integrationAvailabilitySlots",
      ]) {
        const servicesSnapshot = await getDocs(
          collection(db, "stores", storeId, collectionName),
        );
        servicesSnapshot.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const name = pickString(data, ["name", "title", "serviceName"]);
          if (name) {
            serviceMap.set(docSnap.id, name);
            const serviceId = pickString(data, ["serviceId"]);
            if (serviceId) serviceMap.set(serviceId, name);
          }
        });
      }
      const [
        storeSnapshot,
        rootSnapshot,
        storeOrderSnapshot,
        rootOrderSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, "stores", storeId, "integrationBookings")),
        getDocs(
          query(
            collection(db, "integrationBookings"),
            where("storeId", "==", storeId),
          ),
        ),
        getDocs(collection(db, "stores", storeId, "integrationOrders")),
        getDocs(
          query(
            collection(db, "integrationOrders"),
            where("storeId", "==", storeId),
          ),
        ),
      ]);
      const merged = new Map<string, BookingRecord>();
      const makeKey = (b: BookingRecord) =>
        b.bookingId ||
        b.reference ||
        b.paymentReference ||
        `${(b.customerPhone || b.customerEmail || "unknown").toLowerCase()}|${b.serviceId}|${b.bookingDate || ""}|${b.bookingTime || ""}`;

      storeSnapshot.forEach((docSnap) => {
        const booking = hydrateBooking(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
          serviceMap,
          "store",
        );
        merged.set(makeKey(booking), booking);
      });
      rootSnapshot.forEach((docSnap) => {
        const booking = hydrateBooking(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
          serviceMap,
          "root",
        );
        const key = makeKey(booking);
        if (merged.has(key)) {
          const kept = merged.get(key);
          if (kept) merged.set(key, { ...kept, duplicateMerged: true });
          return;
        }
        merged.set(key, booking);
      });

      const mergeOrderBooking = (id: string, data: Record<string, unknown>) => {
        const recordType = normalizeStatus(
          data.recordType ?? data.orderType ?? data.order_type,
          "",
        );
        const metadata =
          data.metadata && typeof data.metadata === "object"
            ? (data.metadata as Record<string, unknown>)
            : {};
        const accountingType = normalizeStatus(
          data.accountingType ??
            data.accounting_type ??
            metadata.accountingType,
          "",
        );
        const quickPayType = pickString(metadata, [
          "quickPayType",
          "itemType",
        ])?.toLowerCase();
        if (
          recordType !== "service_booking" &&
          accountingType !== "booking" &&
          quickPayType !== "booking"
        )
          return;
        const booking = hydrateBooking(id, data, serviceMap, "order");
        const key = makeKey(booking);
        if (merged.has(key)) {
          const kept = merged.get(key);
          if (kept) merged.set(key, { ...kept, duplicateMerged: true });
          return;
        }
        merged.set(key, booking);
      };
      storeOrderSnapshot.forEach((docSnap) =>
        mergeOrderBooking(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
        ),
      );
      rootOrderSnapshot.forEach((docSnap) =>
        mergeOrderBooking(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
        ),
      );

      setBookings(
        Array.from(merged.values()).sort(
          (a, b) =>
            (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
        ),
      );
    } catch (error) {
      console.error(error);
      setErrorMessage("Unable to load bookings right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [hydrateBooking, storeId]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const todayStr = new Date().toDateString();
  const summary = {
    newToday: bookings.filter((b) => b.createdAt?.toDateString() === todayStr)
      .length,
    pending: bookings.filter(
      (b) =>
        ["pending", "pending_approval", "manual_review"].includes(b.status) ||
        b.bookingStatus === "pending_approval",
    ).length,
    paymentPending: bookings.filter((b) =>
      ["pending", "payment_pending", "manual_review"].includes(b.paymentStatus),
    ).length,
    paid: bookings.filter((b) => b.paymentStatus === "paid").length,
    confirmed: bookings.filter((b) => b.status === "confirmed").length,
    completed: bookings.filter((b) => b.status === "completed").length,
    cancelled: bookings.filter((b) =>
      ["cancelled", "deleted"].includes(b.status),
    ).length,
  };

  const visible = useMemo(
    () =>
      bookings.filter((b) => {
        const paymentMethod = (b.paymentMethod || "").toLowerCase();
        const isDirectPayment = ["pay_later", "momo", "mobile_money", "bank", "bank_transfer", "manual"].some((method) =>
          paymentMethod.includes(method),
        );
        const matchesPaymentView = activeTab === "paid_sedifex"
          ? b.paymentStatus === "paid" && !isDirectPayment
          : isDirectPayment &&
            !["cancelled", "deleted"].includes(b.status) &&
            ["pending", "payment_pending", "manual_review"].includes(b.paymentStatus);

        const queryText = search.trim().toLowerCase();
        const matchesSearch = !queryText || [b.reference, b.bookingId, b.serviceName, b.customerName, b.customerPhone, b.customerEmail, b.preferredBranch]
          .some((value) => (value || "").toLowerCase().includes(queryText));
        const matchesStatus = statusFilter === "all" || b.status === statusFilter || b.bookingStatus === statusFilter || b.paymentStatus === statusFilter;
        const matchesBranch = branchFilter === "all" || b.preferredBranch === branchFilter;

        const createdAt = b.createdAt?.getTime() ?? 0;
        const now = Date.now();
        const matchesDate = dateRange === "all" ||
          (dateRange === "today" && b.createdAt?.toDateString() === todayStr) ||
          (dateRange === "7d" && createdAt >= now - 7 * 24 * 60 * 60 * 1000) ||
          (dateRange === "30d" && createdAt >= now - 30 * 24 * 60 * 60 * 1000);

        return matchesPaymentView && matchesSearch && matchesStatus && matchesBranch && matchesDate;
      }),
    [activeTab, bookings, branchFilter, dateRange, search, statusFilter, todayStr],
  );

  const branchOptions = useMemo(
    () => Array.from(new Set(bookings.map((booking) => booking.preferredBranch).filter((branch): branch is string => Boolean(branch)))).sort(),
    [bookings],
  );

  const deleteBookingRecords = useCallback(
    async (booking: BookingRecord) => {
      if (!storeId) return;
      const collectionName =
        booking.sourcePath === "order"
          ? "integrationOrders"
          : "integrationBookings";
      await Promise.all([
        deleteDoc(doc(db, "stores", storeId, collectionName, booking.id)),
        deleteDoc(doc(db, collectionName, booking.id)),
      ]);
    },
    [storeId],
  );

  const handleDeleteBooking = useCallback(
    async (booking: BookingRecord) => {
      const label = booking.serviceName || booking.reference || "this booking";
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

      setDeletingIds((current) => [...new Set([...current, booking.id])]);
      setErrorMessage(null);
      setSuccessMessage(null);
      try {
        await deleteBookingRecords(booking);
        setBookings((current) =>
          current.filter((item) => item.id !== booking.id),
        );
        setSelectedIds((current) => current.filter((id) => id !== booking.id));
        setSuccessMessage("Booking deleted successfully.");
      } catch (error) {
        console.error(error);
        setErrorMessage("Unable to delete booking right now. Please try again.");
      } finally {
        setDeletingIds((current) => current.filter((id) => id !== booking.id));
      }
    },
    [deleteBookingRecords],
  );

  const handleBulkDelete = useCallback(async () => {
    const selected = bookings.filter((booking) =>
      selectedIds.includes(booking.id),
    );
    if (!selected.length) return;
    if (
      !window.confirm(
        `Delete ${selected.length} selected booking${
          selected.length === 1 ? "" : "s"
        }? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingIds((current) => [
      ...new Set([...current, ...selected.map((booking) => booking.id)]),
    ]);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await Promise.all(
        selected.map((booking) => deleteBookingRecords(booking)),
      );
      setBookings((current) =>
        current.filter((booking) => !selectedIds.includes(booking.id)),
      );
      setSelectedIds([]);
      setSuccessMessage(
        `${selected.length} booking${
          selected.length === 1 ? "" : "s"
        } deleted successfully.`,
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(
        "Unable to delete selected bookings right now. Please try again.",
      );
    } finally {
      setDeletingIds((current) =>
        current.filter((id) => !selected.some((booking) => booking.id === id)),
      );
    }
  }, [bookings, deleteBookingRecords, selectedIds]);

  return (
    <main className="page bookings-page">
      <section className="card stack gap-4 bookings-board">
        <header className="stack gap-2">
          <h1>Bookings</h1>
          <p className="bookings-page__intro">
            Manage today’s bookings, payments, confirmations, and follow-ups.
          </p>
          <div className="bookings-page__row-actions">
            <Link to="/bookings/new" className="btn btn-secondary">
              Add booking
            </Link>
            <Link to="/bookings/availability" className="btn btn-secondary">
              Manage availability
            </Link>
            <Link to="/reports/bookings" className="btn btn-secondary">
              Open reports
            </Link>
          </div>
          <Link to="/reports/bookings" className="bookings-page__report-link">
            Need export/audit? Open bookings report
          </Link>
        </header>

        <div className="bookings-page__summary-grid">
          {[
            ["New today", summary.newToday],
            ["Pending approval", summary.pending],
            ["Payment pending", summary.paymentPending],
            ["Paid", summary.paid],
            ["Confirmed", summary.confirmed],
            ["Completed", summary.completed],
            ["Cancelled", summary.cancelled],
          ].map(([label, value]) => (
            <article
              key={label as string}
              className="bookings-page__summary-card"
            >
              <p>{label}</p>
              <strong>{value as number}</strong>
            </article>
          ))}
        </div>

        <div className="bookings-page__tabs">
          {[
            ["paid_sedifex", "Paid through Sedifex"],
            ["direct_needs_approval", "Direct payment — needs approval"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`bookings-page__tab ${activeTab === id ? "is-active" : ""}`}
              onClick={() => setActiveTab(id as typeof activeTab)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="bookings-page__filters">
          <label>
            Date range
            <select value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label>
            Branch
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <option value="all">All branches</option>
              {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="pending_approval">Needs approval</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Search
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, phone, service or reference…" />
          </label>
        </div>

        {!loading && !errorMessage ? (
          <div className="bookings-page__bulk-actions">
            <span>{selectedIds.length} selected</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setSelectedIds(visible.map((booking) => booking.id))
              }
              disabled={!visible.length}
            >
              Select visible
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedIds([])}
              disabled={!selectedIds.length}
            >
              Clear selection
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handleBulkDelete()}
              disabled={!selectedIds.length || deletingIds.length > 0}
            >
              {deletingIds.length > 0 ? "Deleting…" : "Delete selected"}
            </button>
          </div>
        ) : null}

        {successMessage ? (
          <p className="form__success">{successMessage}</p>
        ) : null}

        {loading ? (
          <p>Loading bookings…</p>
        ) : errorMessage ? (
          <p className="form__error">{errorMessage}</p>
        ) : (
          <div className="bookings-table-wrap">
            <table className="table bookings-table">
              <thead>
                <tr>
                  <th className="bookings-table__select">
                    <input
                      type="checkbox"
                      aria-label="Select all visible bookings"
                      checked={
                        visible.length > 0 &&
                        visible.every((booking) =>
                          selectedIds.includes(booking.id),
                        )
                      }
                      onChange={(event) =>
                        setSelectedIds(
                          event.target.checked
                            ? Array.from(
                                new Set([
                                  ...selectedIds,
                                  ...visible.map((booking) => booking.id),
                                ]),
                              )
                            : selectedIds.filter(
                                (id) =>
                                  !visible.some((booking) => booking.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th>Booking</th>
                  <th>Customer</th>
                  <th>Schedule</th>
                  <th>Source</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => {
                  return (
                    <tr key={b.id}>
                      <td className="bookings-table__select">
                        <input
                          type="checkbox"
                          aria-label={`Select ${b.serviceName}`}
                          checked={selectedIds.includes(b.id)}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? Array.from(new Set([...current, b.id]))
                                : current.filter((id) => id !== b.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>{b.serviceName}</strong>
                        <small>
                          {b.reference || b.bookingId || "No reference"}
                        </small>
                        {b.serviceName === "Service not named" ? (
                          <small className="muted">
                            Service ID: {b.serviceId}
                          </small>
                        ) : null}
                        {b.duplicateMerged ? (
                          <span className="bookings-badge">
                            Duplicate records merged
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <strong>{b.customerName || "Customer"}</strong>
                        <small>
                          {b.customerPhone || b.customerEmail || "No contact"}
                        </small>
                      </td>
                      <td>
                        <strong>{b.bookingDate || "Date not set"}</strong>
                        <small>{b.bookingTime || "Time not set"}</small>
                        <small>{b.preferredBranch || "Main branch"}</small>
                      </td>
                      <td>
                        <span className="bookings-badge">{b.sourceLabel}</span>
                        <small>
                          {b.sourcePath === "order"
                            ? "Payment order"
                            : b.sourcePath === "root"
                              ? "Root booking"
                              : "Store booking"}
                        </small>
                      </td>
                      <td>
                        <strong>{b.paymentAmount || "—"}</strong>
                        <small>{paymentLabel(b.paymentStatus)}</small>
                        <small>{b.paymentMethod || "Method not set"}</small>
                      </td>
                      <td>
                        <span
                          className={`bookings-page__status bookings-page__status--${b.bookingStatus}`}
                        >
                          {statusLabel(b.bookingStatus)}
                        </span>
                        <small>
                          {b.paymentStatus === "paid" &&
                          b.bookingStatus !== "confirmed"
                            ? "Paid - waiting for store confirmation"
                            : ""}
                        </small>
                        <small>
                          {b.syncStatus === "pending"
                            ? "Sync pending"
                            : b.syncStatus === "synced"
                              ? "Synced"
                              : ""}
                        </small>
                      </td>
                      <td>
                        <div className="bookings-page__row-actions">
                          <Link
                            className="btn btn-secondary"
                            to={`/bookings/${b.id}`}
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void handleDeleteBooking(b)}
                            disabled={deletingIds.includes(b.id)}
                          >
                            {deletingIds.includes(b.id)
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="bookings-cards">
              {visible.map((b) => (
                <article key={`${b.id}-card`} className="bookings-card">
                  <h3>{b.serviceName}</h3>
                  <p>
                    {b.customerName || "Customer"} •{" "}
                    {b.bookingDate || "Date not set"} {b.bookingTime || ""}
                  </p>
                  <p>
                    {statusLabel(b.status)} • {paymentLabel(b.paymentStatus)}
                  </p>
                  <label className="bookings-card__select">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(b.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, b.id]))
                            : current.filter((id) => id !== b.id),
                        )
                      }
                    />
                    Select
                  </label>
                  <div className="bookings-page__row-actions">
                    <Link
                      className="btn btn-secondary"
                      to={`/bookings/${b.id}`}
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void handleDeleteBooking(b)}
                      disabled={deletingIds.includes(b.id)}
                    >
                      {deletingIds.includes(b.id) ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
