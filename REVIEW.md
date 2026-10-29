# Code review

no auth.\*\* It's a server action, so it's a public endpoint. Anyone can call it with Beta's org id and read their totals. Fix: no orgId param, get the caller from the session, use their membership's org, 401 if none.

1. **L102** `getCollections` no auth -> it's a public endpoint. Anyone can call it with Beta's org id and read their totals.
   Fix: no orgId param, get the caller from the session

2. **L13** Role comes from `user_metadata` -> A tenant can make themselves a manager here. Read the role from `memberships`. Also return 401, not 403, when there is no user.

3. **L18** Lease is fetched by id with no org filter -> A Beta manager can add fees to a Northwind lease. Filter by the caller's org, 404 otherwise.

4. **L80-87** `paid_amount` is never compared with the bill amount. Compare before writing.

5. **L33-46** Not in a transaction and not idempotent. A failure half-way leaves partial fees, and calling twice doubles them.

6. **L31-32** Float money: `paid/amount >= 0.995` treats a 99.5% paid invoice as paid, divides by zero on a 0-sen invoice, and the fee is rounded through a float. Use integers.
