#!/usr/bin/env python3
"""
Generate region and subregion shapefiles/GeoJSON for community addressing.

This script creates GeoJSON files for a country's community addressing regions
and subregions based on major population centers and natural geography.

Usage:
    python generate-regions.py [country_code]

Examples:
    python generate-regions.py           # Generate for all configured countries
    python generate-regions.py uganda    # Generate only for Uganda
    python generate-regions.py UG        # Same as above (case-insensitive)
"""

import argparse
import json
import math
from pathlib import Path
from typing import Dict, Any, Tuple, List

# Subregion definitions (directional) - universal for all countries
# Using single/double letter codes for simplicity
SUBREGIONS = {
    "C": {"name": "Central", "offset": (0, 0), "radius_factor": 0.25},
    "N": {"name": "North", "offset": (0, 0.65), "radius_factor": 0.28},
    "S": {"name": "South", "offset": (0, -0.65), "radius_factor": 0.28},
    "E": {"name": "East", "offset": (0.65, 0), "radius_factor": 0.28},
    "W": {"name": "West", "offset": (-0.65, 0), "radius_factor": 0.28},
    "NW": {"name": "Northwest", "offset": (-0.5, 0.5), "radius_factor": 0.25},
    "NE": {"name": "Northeast", "offset": (0.5, 0.5), "radius_factor": 0.25},
    "SW": {"name": "Southwest", "offset": (-0.5, -0.5), "radius_factor": 0.25},
    "SE": {"name": "Southeast", "offset": (0.5, -0.5), "radius_factor": 0.25},
}

# Country configurations
# To add a new country, add a new entry to this dictionary
COUNTRIES: Dict[str, Dict[str, Any]] = {
    "UG": {
        "name": "Uganda",
        "center": (32.2903, 1.3733),
        "bbox": [[29.5, -1.5], [29.5, 4.2], [35.0, 4.2], [35.0, -1.5], [29.5, -1.5]],
        "regions": {
            "KAM": {"name": "Kampala", "center": (32.5825, 0.3476), "radius_km": 35},
            "JIN": {"name": "Jinja", "center": (33.2041, 0.4244), "radius_km": 40},
            "MBA": {"name": "Mbarara", "center": (30.6545, -0.6072), "radius_km": 50},
            "GUL": {"name": "Gulu", "center": (32.2997, 2.7747), "radius_km": 55},
            "ARU": {"name": "Arua", "center": (30.9110, 3.0303), "radius_km": 50},
            "MBL": {"name": "Mbale", "center": (34.1750, 1.0821), "radius_km": 45},
            "LIR": {"name": "Lira", "center": (32.5400, 2.2347), "radius_km": 50},
            "FTP": {"name": "Fort Portal", "center": (30.2750, 0.6710), "radius_km": 45},
            "MSK": {"name": "Masaka", "center": (31.7350, -0.3136), "radius_km": 40},
            "SOR": {"name": "Soroti", "center": (33.6173, 1.7147), "radius_km": 45},
            "HMA": {"name": "Hoima", "center": (31.3522, 1.4331), "radius_km": 50},
            "KBL": {"name": "Kabale", "center": (29.9833, -1.2500), "radius_km": 40},
        },
    },
    # Add more countries here following the same pattern:
    # "KE": {
    #     "name": "Kenya",
    #     "center": (37.9062, -0.0236),
    #     "bbox": [[33.9, -4.7], [33.9, 5.0], [41.9, 5.0], [41.9, -4.7], [33.9, -4.7]],
    #     "regions": {
    #         "NRB": {"name": "Nairobi", "center": (36.8219, -1.2921), "radius_km": 40},
    #         # ... more regions
    #     },
    # },
}


def km_to_degrees(km: float, latitude: float = 0) -> float:
    """Convert kilometers to degrees (approximate)."""
    lat_factor = math.cos(math.radians(latitude))
    return km / (111 * lat_factor)


def create_circle_polygon(
    center_lon: float, center_lat: float, radius_km: float, num_points: int = 32
) -> List[List[List[float]]]:
    """Create a circular polygon approximation."""
    coords = []
    radius_deg = km_to_degrees(radius_km, center_lat)

    for i in range(num_points):
        angle = 2 * math.pi * i / num_points
        lon = center_lon + radius_deg * math.cos(angle)
        lat = center_lat + radius_deg * math.sin(angle) * 0.9
        coords.append([round(lon, 6), round(lat, 6)])

    coords.append(coords[0])
    return [coords]


def create_region_geojson(country_code: str, country_config: Dict[str, Any]) -> Dict[str, Any]:
    """Create GeoJSON for all regions in a country."""
    features = []

    for code, info in country_config["regions"].items():
        lon, lat = info["center"]
        coords = create_circle_polygon(lon, lat, info["radius_km"])

        feature = {
            "type": "Feature",
            "properties": {
                "code": code,
                "name": info["name"],
                "level": 1,
                "parent_code": country_code,
                "center_lon": lon,
                "center_lat": lat,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": coords,
            },
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "name": f"{country_config['name'].lower()}_regions",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }


def create_subregion_geojson(country_code: str, country_config: Dict[str, Any]) -> Dict[str, Any]:
    """Create GeoJSON for all subregions in a country."""
    features = []

    for region_code, region_info in country_config["regions"].items():
        region_lon, region_lat = region_info["center"]
        region_radius = region_info["radius_km"]

        for sub_code, sub_info in SUBREGIONS.items():
            offset_x, offset_y = sub_info["offset"]
            radius_factor = sub_info["radius_factor"]

            offset_deg = km_to_degrees(region_radius * 0.5, region_lat)
            sub_lon = region_lon + offset_x * offset_deg
            sub_lat = region_lat + offset_y * offset_deg * 0.9

            sub_radius = region_radius * radius_factor
            coords = create_circle_polygon(sub_lon, sub_lat, sub_radius)

            full_code = f"{region_code}-{sub_code}"

            feature = {
                "type": "Feature",
                "properties": {
                    "code": full_code,
                    "subregion_code": sub_code,
                    "name": f"{sub_info['name']} {region_info['name']}",
                    "level": 2,
                    "parent_code": region_code,
                    "center_lon": round(sub_lon, 6),
                    "center_lat": round(sub_lat, 6),
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": coords,
                },
            }
            features.append(feature)

    return {
        "type": "FeatureCollection",
        "name": f"{country_config['name'].lower()}_subregions",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }


def create_country_geojson(country_code: str, country_config: Dict[str, Any]) -> Dict[str, Any]:
    """Create GeoJSON for a country boundary (simplified)."""
    return {
        "type": "FeatureCollection",
        "name": f"{country_config['name'].lower()}_country",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "code": country_code,
                    "name": country_config["name"],
                    "level": 0,
                    "parent_code": None,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [country_config["bbox"]],
                },
            }
        ],
    }


def generate_country(country_code: str, country_config: Dict[str, Any], base_dir: Path) -> None:
    """Generate all GeoJSON files for a country."""
    country_name = country_config["name"].lower()
    output_dir = base_dir / "shapefiles" / country_name
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate country boundary
    country_geojson = create_country_geojson(country_code, country_config)
    with open(output_dir / f"{country_name}_country.geojson", "w") as f:
        json.dump(country_geojson, f, indent=2)
    print(f"Created: {output_dir / f'{country_name}_country.geojson'}")

    # Generate regions
    regions_geojson = create_region_geojson(country_code, country_config)
    with open(output_dir / f"{country_name}_regions.geojson", "w") as f:
        json.dump(regions_geojson, f, indent=2)
    print(f"Created: {output_dir / f'{country_name}_regions.geojson'}")
    print(f"  - {len(regions_geojson['features'])} regions")

    # Generate subregions
    subregions_geojson = create_subregion_geojson(country_code, country_config)
    with open(output_dir / f"{country_name}_subregions.geojson", "w") as f:
        json.dump(subregions_geojson, f, indent=2)
    print(f"Created: {output_dir / f'{country_name}_subregions.geojson'}")
    print(f"  - {len(subregions_geojson['features'])} subregions")

    # Create combined file
    combined = {
        "country": country_geojson,
        "regions": regions_geojson,
        "subregions": subregions_geojson,
    }
    with open(output_dir / f"{country_name}_all.json", "w") as f:
        json.dump(combined, f, indent=2)
    print(f"Created: {output_dir / f'{country_name}_all.json'}")

    # Print summary
    print(f"\n=== {country_config['name']} Regions Summary ===")
    for code, info in country_config["regions"].items():
        print(f"  {code}: {info['name']} (center: {info['center'][0]:.4f}, {info['center'][1]:.4f})")


def main():
    parser = argparse.ArgumentParser(
        description="Generate region and subregion GeoJSON files for community addressing."
    )
    parser.add_argument(
        "country",
        nargs="?",
        help="Country code or name (e.g., 'UG' or 'uganda'). If omitted, generates for all countries.",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).parent

    # Determine which countries to generate
    if args.country:
        # Normalize input (case-insensitive, handle both code and name)
        country_input = args.country.upper()

        # Try to find by code
        if country_input in COUNTRIES:
            countries_to_generate = {country_input: COUNTRIES[country_input]}
        else:
            # Try to find by name
            found = None
            for code, config in COUNTRIES.items():
                if config["name"].upper() == country_input:
                    found = (code, config)
                    break

            if found:
                countries_to_generate = {found[0]: found[1]}
            else:
                available = ", ".join(f"{k} ({v['name']})" for k, v in COUNTRIES.items())
                print(f"Error: Country '{args.country}' not found.")
                print(f"Available countries: {available}")
                return
    else:
        countries_to_generate = COUNTRIES

    # Generate for each country
    for country_code, country_config in countries_to_generate.items():
        print(f"\n{'='*60}")
        print(f"Generating regions for {country_config['name']} ({country_code})")
        print(f"{'='*60}\n")
        generate_country(country_code, country_config, base_dir)

    print("\n=== Subregion Codes (Universal) ===")
    for sub_code, sub_info in SUBREGIONS.items():
        print(f"  {sub_code}: {sub_info['name']}")


if __name__ == "__main__":
    main()
