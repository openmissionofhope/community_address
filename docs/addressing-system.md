# Community Addressing System

## Overview

This document defines a **politics-neutral, long-lived community addressing system** for regions without official street addresses. The system is designed to remain valid for **50+ years**, regardless of political redistricting or administrative changes.

The system uses **geographic regions** based on major population centers and natural boundaries, **not** administrative or political divisions.

## Address Format

A complete community address looks like:

```
<HOUSE_NUMBER> <STREET_NAME_OR_SUBREGION>-<STREET_NUMBER>, <REGION>, <COUNTRY>
```

**Example (Uganda):**
```
30 C-105, KAM, Uganda
```

This means:
- House number 30
- Street 105 in the C (Central) subregion
- KAM (Kampala) region
- Uganda

**Example with named street:**
```
175 Yusuf Lule Road, KAM, Uganda
```

## Regions (3-letter codes)

Each country is divided into regions based on major population centers and natural geography. Region codes are 3-letter abbreviations.

### Design Principles

Regions are based on:
- **Major population centers** (cities with significant population)
- **Natural geographic boundaries** (lakes, mountains, rivers)
- **Historical cultural areas** (not administrative, but how people naturally refer to areas)
- **Transportation hubs** (where people naturally travel to/from)

Regions are **NOT** based on:
- District boundaries (these change frequently)
- Political constituencies
- Administrative units

### Example: Uganda Regions

| Code | Region Name | Center City | Approximate Coverage |
|------|-------------|-------------|---------------------|
| KAM | Kampala | Kampala | Greater Kampala, Wakiso, Mukono |
| JIN | Jinja | Jinja | Busoga area, Source of Nile |
| MBA | Mbarara | Mbarara | Ankole region |
| GUL | Gulu | Gulu | Acholi region |
| ARU | Arua | Arua | West Nile region |
| MBL | Mbale | Mbale | Bugisu, Mount Elgon area |
| LIR | Lira | Lira | Lango region |
| FTP | Fort Portal | Fort Portal | Toro, Rwenzori Mountains |
| MSK | Masaka | Masaka | Southern Lake Victoria shore |
| SOR | Soroti | Soroti | Teso region |
| HMA | Hoima | Hoima | Bunyoro, Albertine region |
| KBL | Kabale | Kabale | Kigezi, Southwest highlands |

## Subregions (1-2 letter codes)

Each region is divided into **subregions** using simple directional codes:

| Code | Meaning |
|------|---------|
| C | Central |
| N | North |
| S | South |
| E | East |
| W | West |
| NW | Northwest |
| NE | Northeast |
| SW | Southwest |
| SE | Southeast |

### Why These Codes?

- **Universal**: N, S, E, W are understood globally
- **Short**: Easy to write, speak, and remember
- **Intuitive**: Maps directly to compass directions
- **C for Central**: The urban core of each region

## Street Placeholder Naming

Many streets have no official names. The system assigns **placeholder street numbers** in the format:

```
<SUBREGION>-<NUMBER>
```

**Examples:**
- `C-105` (Street 105 in Central subregion)
- `N-1320` (Street 1320 in North subregion)
- `E-215` (Street 215 in East subregion)
- `SW-5005` (Street 5005 in Southwest subregion)

### Street Number Rules

1. **Multiples of 5**: All street numbers are multiples of 5 (105, 110, 115, 120...)
   - This leaves room for future streets to be added between existing ones

2. **No leading zeros**: Numbers naturally scale based on density
   - If a subregion has 83 unnamed streets → 3 digits (100-995)
   - If a subregion has 834 unnamed streets → 4 digits (1000-9995)
   - If a subregion has 8,340 unnamed streets → 5 digits (10000-99995)
   - Maximum: 5 digits (up to ~20,000 streets per subregion)

3. **Locality preservation**: Nearby streets have similar numbers
   - A neighborhood might have streets: C-105, C-110, C-115, C-120
   - This helps people understand relative locations

### How Street Numbers Are Assigned

Street numbers are assigned using a **spatial grid system**:

1. Each subregion is divided into a grid
2. Grid cells are numbered sequentially (like reading a book: left-to-right, top-to-bottom)
3. Streets within each cell receive numbers based on their position
4. Numbers increase as you move away from the region center

This ensures:
- Geographic locality (nearby streets have similar numbers)
- Predictable addressing (you can estimate location from the number)
- Room for growth (new streets can be added without renumbering)

## House Numbers

House numbers follow standard conventions:
- **Odd numbers** on the **left side** of the street (when facing increasing street numbers)
- **Even numbers** on the **right side** of the street
- Numbers are **multiples of 5** (5, 10, 15, 20, 25...)
- Numbers increase from the start to the end of the street

## Full Address Examples

**Uganda:**
```
15 C-105, KAM, Uganda
```
→ House 15 on Street 105 in Central Kampala

```
320 N-2150, GUL, Uganda
```
→ House 320 on Street 2150 in North Gulu

```
45 W-340, MBA, Uganda
```
→ House 45 on Street 340 in West Mbarara

## Longevity Design

This system is designed to last 50+ years because:

1. **No political dependency**: Regions are based on geography and population centers, not districts or constituencies

2. **Stable boundaries**: Natural features (lakes, mountains, rivers) don't change

3. **Expandable**: New streets can be added without renumbering existing ones

4. **Simple and memorable**: 3-letter codes are easy to remember and communicate

5. **Universal subregion codes**: Directional codes (N, S, E, W) are intuitive globally

## What This System Is NOT

- **NOT official postal addresses**: This is a community navigation system
- **NOT administrative boundaries**: Regions don't correspond to districts
- **NOT political statements**: Region names don't imply any political status
- **NOT permanent property identifiers**: For legal purposes, use official land titles

## Using the System

### For Navigation
- Use the region code to get to the general area
- Use the subregion to narrow down
- Use the street number to find the specific street
- Use the house number to find the building

### For Delivery Services
The address format is:
- **WhatsApp-friendly**: Easy to copy and share
- **Speakable**: Can be communicated over phone
- **Searchable**: Can be entered into mapping applications

### For Emergency Services
The hierarchical structure (Region → Subregion → Street → House) helps dispatchers quickly identify locations.

## Adding a New Country

To add support for a new country:

1. **Define regions**: Identify 8-15 major population centers
2. **Assign 3-letter codes**: Use city name abbreviations
3. **Set region boundaries**: Based on natural geography, not politics
4. **Update configuration**: Add to `database/generate-regions.py`
5. **Create migration**: Follow the pattern in `003_regions_subregions.sql`
6. **Generate shapefiles**: Run `python generate-regions.py <country_code>`

---

## Data Sources

- Population data: National census data
- Geographic data: OpenStreetMap, Google Open Buildings
- City coordinates: Geographic databases

## Version

- System Version: 1.0
- Last Updated: December 2025
- Maintainer: Community Address Project
