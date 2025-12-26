## 🐱 Claude Prompt — Community Address Naming System (Global, SSA-first, Long-Lived)

> You are a geospatial systems designer helping define a **politics-neutral, long-lived community addressing system**.
>
> The goal is to define **human-understandable region and subregion codes**, plus a **street placeholder numbering scheme**, that can remain valid for **50+ years**, regardless of political redistricting or administrative changes.
>
> This system is **not administrative** and must **not correspond to political subdivisions** (districts, counties, municipalities, etc.).
>
> The system should work globally, with **country-specific configurations** layered on top, but **the model itself must not be country-specific**.
>
> ---
>
> ## 1. Regions (3-letter codes)
>
> Define **3-letter region codes** using **only capital letters A–Z**.
>
> Requirements:
>
> * Codes must be **plausible and intuitive for local humans**
>
>   * Examples: `KAM`, `ENT`, `JIN`, `MBR`
> * Regions should be derived from:
>
>   * major **population centers** (urban clusters), and
>   * **area-based clusters** surrounding or between population centers
> * Regions must be defined **purely by geography, population density, and continuity**, not politics
> * Regions should feel like “areas people already talk about”, even if informal
> * Region codes **do not assert administrative status**
>
> ---
>
> ## 2. Subregions (3-letter codes inside each region)
>
> For **each region**, define **subregions**, also using **only capital A–Z**.
>
> Requirements:
>
> * Subregions must be **human-understandable and speakable**
> * Subregions may reflect:
>
>   * relative position (central, east, west, north, south), OR
>   * long-lived local area names that are **not political units**
> * **`CEN` is a reserved universal subregion code**
>
>   * `CEN` MUST always mean **central**
>   * Rationale: shared meaning across English, French, Spanish, Portuguese
> * Directional or semantic codes (e.g. `EAS`, `WES`, `NOR`, `SOU`) may be used
> * Subregions must remain stable even if political boundaries change
>
> ---
>
> ## 3. Street placeholder naming
>
> Many streets have no official names.
>
> Define a placeholder naming system of the form:
>
> ```
> LLL-XXX
> LLL-XXXX
> LLL-XXXXX
> ```
>
> Where:
>
> * `LLL` = subregion code
> * `XXX / XXXX / XXXXX` = numeric street identifier
>
> Rules:
>
> * Street numbers must be **multiples of 5**
>
>   * e.g. 105, 110, 115, 1320, 4515
> * This leaves room for **future infill**
> * **3 to 5 digits are allowed**
>
>   * use fewer digits where density is low
>   * use more digits in dense urban areas
> * Number assignment must preserve **locality**:
>
>   * streets near each other should usually have **similar numbers**
>   * a small neighborhood or informal settlement should cluster numerically
>
>     * e.g. `NAK-105`, `NAK-110`, `NAK-115`
>     * avoid large jumps like `NAK-545` unless geographically justified
> * Explain the spatial logic used (grid, ordering, locality preservation)
>
> ---
>
> ## 4. Full community address format
>
> The full human-readable address format is:
>
> ```
> <HOUSE_NUMBER> <SUBREGION-STREET>, <REGION>, <COUNTRY>
> ```
>
> Example:
>
> ```
> 30 NAK-105, KAM, Uganda
> ```
>
> Requirements:
>
> * WhatsApp-friendly
> * Speakable
> * Does not depend on administrative knowledge
>
> ---
>
> ## 5. Longevity constraint (critical)
>
> The system must:
>
> * remain usable for **50+ years**
> * survive redistricting, renaming, and political reorganization
> * treat region and subregion codes as **navigation clusters**, not legal claims
>
> Explain how the model achieves long-term stability.
>
> ---
>
> ## 6. Documentation
>
> Write a **clear explanatory document** for a general audience covering:
>
> * what regions and subregions are
> * what they are *not* (not political boundaries)
> * why `CEN` is universal
> * how street placeholder numbers work
> * why multiples of 5 are used
> * why 3–5 digit numbers are allowed
> * how this helps navigation where formal addresses do not exist
>
> Avoid technical jargon.
>
> ---
>
> ## 7. Country-specific geospatial implementation (parameterized)
>
> Describe how the system should be implemented **per country**:
>
> * using shapefiles or GeoJSON to define regions and subregions
> * keeping the model identical, only swapping country data
> * enabling visualization in tools like **Google Maps or OpenStreetMap**
>
> Emphasize **familiarity and navigation**, not authority.
>
> ---
>
> ## Output format
>
> Please return:
>
> 1. A generic global model description
> 2. A worked example for one country
> 3. The street placeholder numbering model
> 4. The full explanatory documentation
>
> Keep the solution **minimal, stable, and human-centered**.
> If there is a tradeoff, prefer **simplicity and longevity** over precision.
