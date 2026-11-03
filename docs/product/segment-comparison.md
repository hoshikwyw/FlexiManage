# Decision D1 preparation: candidate segment comparison

Prepared 2026-11-03 by the product-planner agent for the project lead, who owns decision D1
(due 2026-11-15, see `docs/PLANNING.md` section 2). This document is a recommendation, not the
decision. Every price, market-size and response-rate figure below is a **hypothesis** to be tested
in Phase 0 and Phase 6; none is validated.

## Candidates

| Id | Segment | Candidate workflow named in D1 |
|----|---------|--------------------------------|
| S1 | Service offices: small law, accounting and consulting practices (1 to 10 people) | Tracking clients and the jobs (matters, engagements, projects) done for them |
| S2 | Small retail teams: single shop or 2 to 3 shops | Tracking inventory and supplier orders |
| S3 | Accommodation operators: guesthouses, B&Bs, small hotels, hostels, multi-unit short-term-rental hosts (3 to 20 rooms or units) | Tracking bookings and housekeeping |

## Scoring

Scale 1 (worst) to 5 (best) in every column, so "Low competition" scores 5 when incumbents are
weak and "Low relationship risk" scores 5 when the workflow fits one flat module. Equal weights;
the total is a tie-breaker, not a precise measure.

| Criterion | S1 Service offices | S2 Small retail | S3 Accommodation |
|-----------|:-:|:-:|:-:|
| Reachability for a solo introvert founder (asynchronous, public contact points) | 3 | 3 | 4 |
| Willingness to pay | 4 | 2 | 3 |
| Workflow simplicity for a custom-fields-only MVP | 3 | 2 | 4 |
| Low competition from incumbents | 2 | 1 | 3 |
| Low risk that the workflow needs relationships between tables (excluded per D2 recommendation) | 2 | 1 | 4 |
| **Total** | **14** | **9** | **18** |

### S1 Service offices (14)

Professionals are listed in public registers and association directories and are used to paying
for software (hypothesis: practice-management tools cost 30 to 100 USD per user per month), so
willingness to pay is the highest of the three. The problems are reachability (inboxes are
screened by staff, and tax and court seasons close the door for weeks) and a crowded field: Clio,
PracticePanther, Karbon, TaxDome and generic CRMs already sell "clients and matters". The workflow
is also inherently two entities, clients and jobs, and the first feature request will be "show me
all jobs for this client", which is exactly the relationship the MVP excludes. A flat "Jobs" module
with the client name as a text field works for a pilot, but it fights the segment's mental model.

### S2 Small retail (9)

Shops are easy to find and owners answer Instagram and Facebook messages, but margins are thin and
the free tiers of Square, Shopify POS and Loyverse already include inventory, so paying for a
separate tracker is a hard sell (hypothesis: willingness to pay under 10 USD per month). Inventory
is also the worst fit for custom fields only: a supplier order has line items, a product has
stock movements, and quantities must be adjusted transactionally. Every realistic version of this
workflow needs products, suppliers and order lines as related tables. Not recommended for the MVP.

### S3 Accommodation operators (18)

Every operator has public contact points (Booking.com and Airbnb listings, Google Maps, tourism
board directories) and answering written messages from strangers is part of the job, which suits
asynchronous, low-pressure outreach. They already pay commissions and tooling fees (hypothesis:
15 percent OTA commission, 20 to 50 USD per month for a channel manager), so a small monthly fee is
normal. Bookings themselves are served by OTAs and channel managers with availability-conflict
logic we should not rebuild; housekeeping and turnover coordination between bookings, however, is
typically run on WhatsApp, paper or a whiteboard. Dedicated tools exist (Turno, Properly,
Breezeway, Operto) but target larger or US-centric portfolios, and channel-manager add-ons are
rarely used by operators with under 20 rooms (hypothesis, to verify in interviews). A turnover
task is one flat row: room, date, type, status, who, notes. The room is a fixed list, so a select
field covers it without a Rooms table.

## Recommendation

**Segment:** S3, accommodation operators with 3 to 20 rooms or units, self-managed or with a
small housekeeping team or contractor.

**Workflow:** housekeeping turnover tracking: every room change-over or scheduled clean is
recorded as a task, assigned, completed and inspected, so nothing is missed between check-out and
the next check-in. Not bookings: bookings stay in the OTA or channel manager, and the task carries
the dates it needs.

**Why this one and not S1:** S1 has stronger willingness to pay, but S3 wins on the two criteria
that decide whether a solo founder can validate anything in 90 days: it is reachable without
phone calls, and its workflow fits one module without relationships. If outreach in Phase 0 shows
S3 does not respond (fewer than 3 conversations by 2026-11-10), fall back to S1 with a flat "Jobs"
module (client name as text) and a consulting-first prospect list, because consultancies have
fewer incumbents than law or accounting.

### Default module: "Housekeeping tasks"

Only MVP field types are used (text, number, date, select, checkbox, currency). Order is the
display order. Select options are starting values the operator edits in module settings.

| # | Field | Type | Required | Options / notes |
|---|-------|------|:--------:|-----------------|
| 1 | Room | select | yes | "Room 1" to "Room 6" seeded as placeholders; operator renames to their rooms or units. First field, so it is the record label in lists. |
| 2 | Due date | date | yes | Day the room must be ready (normally the check-out day). |
| 3 | Task type | select | yes | Checkout clean, Stayover refresh, Deep clean, Maintenance check |
| 4 | Status | select | yes | To do, In progress, Done |
| 5 | Assigned to | text | no | Housekeeper's name. A text field on purpose: a "user" or "member" field type is deferred. |
| 6 | Guests arriving | number | no | Number of guests for the next stay (bed set-up, extra towels). |
| 7 | Notes | text | no | Special requests, damage found, supplies missing. |
| 8 | Inspected | checkbox | no | Ticked by the owner or supervisor after checking the room. |

A ninth field, "Extra charge" (currency, optional, for laundry or damage costs), is a candidate if
interviews show operators track it per turnover; the template stays within 8 fields until then.

### Scope notes for the security reviewer and D2

- Workspace isolation: the module, its fields and records are ordinary tenant rows with
  `workspace_id`; the template itself is shipped as code, not as tenant data (see Epic B6 in
  `docs/PLANNING.md`).
- Plan limits: the template consumes 1 of the workspace's module allowance (Free plan hypothesis:
  1 module, 200 records). A 6-room property with daily turnovers creates roughly 120 to 180
  records per month (hypothesis), so a Free workspace hits 200 records in about 5 to 7 weeks,
  which is a useful conversion moment for the Pro tier.
- Temptations toward relationships, all kept out: a Rooms table linked to tasks (use the select
  field), Assigned-to linked to members (text field), bookings linked to tasks (tasks carry the
  dates), automatic task creation from a booking calendar (integration, deferred).

## Open questions for the project lead

1. Region: which country or city do we source the first 20 prospects from? Reachability and
   willingness to pay vary by market; the discovery kit assumes operators who read and write
   English or the founder's language.
2. Buyer: is the owner-operator the buyer, or a co-host or small property manager running 5 to 20
   units for owners? The latter has a stronger coordination problem and higher willingness to pay
   (hypothesis), but is a smaller population.
3. If D1 lands on S3, should the pilot price be a one-time fee (section 8 of the plan allows an
   onboarding fee for early pilots) or the Pro monthly hypothesis from day one? See
   `docs/product/discovery-kit.md` for the proposed pilot offer.
