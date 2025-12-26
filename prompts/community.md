### 🐱 **Claude Prompt: Community Addresses – Corrections, Alternatives, and Ambiguity**

You are helping design a **community-driven addressing system** for cities where official addresses are incomplete, ambiguous, or misleading (e.g. Kampala, Uganda).

**Core constraints and realities:**

* Many buildings have **multiple plausible addresses** depending on how they are accessed (different roads, gates, or lanes).
* Maps often ignore **walls, compounds, barbed wire, and dead gates**; adjacency ≠ access.
* Some addresses are **community-invented** (e.g. “735 Ssentongo Rd”) and may not be reachable from the named road.
* **Duplicate official street names** exist within the same city/region (e.g. multiple “Tank Hill Rd” intersecting the same major road), making string-based addresses inherently ambiguous.
* Addressing today relies heavily on **tribal knowledge**, phone calls, and landmarks.

**Design goals:**

1. Allow **multiple alternative addresses per building**, each treated as a *claim* about how to reach the place.
2. Distinguish clearly between:

   * canonical building identity (stable ID),
   * address labels (strings humans use),
   * access points (actual reachable gates/paths).
3. Support **corrections and annotations**, including:

   * reporting official address labels,
   * reporting official road names,
   * submitting access notes (e.g. “Go to C-1000; not accessible from C-1020” or “near Philadelphia International Church”).
4. Handle **duplicate street names** safely:

   * road names are *not* primary keys,
   * roads need stable internal IDs,
   * UI must disambiguate identical names by locality/landmarks.
5. Allow users to state that **multiple adjacent buildings share the same address** (e.g. within a compound).
6. Allow users to submit **where a building is actually accessed from**, even if that road is unnamed (e.g. assign synthetic IDs like `S-1045, KAM, UG` with locality hints).
7. Design a **lightweight trust system**:

   * corrections/notes can be submitted without full friction,
   * phone number / OTP may be required for higher-impact actions,
   * notes can decay over time if not reaffirmed,
   * logged-in users can affirm or reject notes,
   * corrections take effect once enough independent users agree.
8. Avoid claiming state authority:

   * clearly label addresses as *community*, *access-based*, or *official (reported)*.
   * never force a single “true” address when reality is plural.

**Requested output from you (Claude):**

* A concise **data model** (entities + relationships) that supports the above.
* A **correction workflow** describing how alternative addresses and access notes are submitted, reviewed, decay, and become accepted.
* UI/UX principles for presenting ambiguity honestly while remaining usable.
* Clear rules for when to generate “road-style” addresses vs neutral labels like “near / off / via”.
* Special handling strategy for **duplicate street names** within the same region.

Optimize for:

* minimal ceremony,
* additive truth (no hard deletes),
* real-world usability for delivery, visitors, and residents,
* scalability to other high-entropy cities.
