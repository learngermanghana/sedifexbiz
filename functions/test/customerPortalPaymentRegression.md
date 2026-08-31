# Customer portal payment regression

Regression case for PR #1655:

- booking payment status is `paid`
- `paymentAmount` contains the full paid total
- `depositAmount` is absent or stored as `0`
- no explicit `amountReceived`, `amountPaid`, or `paidAmount` is present

Expected portal behavior: the payment confirmation must show the full booking total, not GHS 0.00. A positive deposit remains authoritative for partial-payment records when no explicit received amount exists.
