/**
 * @fileoverview Region layer component for rendering region boundaries on the map.
 * Displays regions as semi-transparent GeoJSON polygons with labels showing
 * region codes. Regions are visible at lower zoom levels and fade as you zoom in.
 */

import { useEffect, useState, useCallback, memo } from 'react';
import { GeoJSON, useMap } from 'react-leaflet';
import type { Layer } from 'leaflet';
import L from 'leaflet';
import type { RegionFeature, RegionCollection } from '../types';
import { fetchRegionsGeoJson } from '../services/api';

/**
 * Props for the RegionLayer component.
 */
interface RegionLayerProps {
  country?: string;
}

/**
 * Renders region boundaries on the map as semi-transparent polygons.
 * Visible at zoom levels below 13, fades out at higher zooms.
 */
function RegionLayerComponent({ country = 'UG' }: RegionLayerProps) {
  const [regions, setRegions] = useState<RegionCollection | null>(null);
  const [visible, setVisible] = useState(true);
  const map = useMap();

  // Load regions on mount
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const data = await fetchRegionsGeoJson(country, 1);
        setRegions(data);
      } catch (error) {
        console.error('Failed to load regions:', error);
      }
    };
    loadRegions();
  }, [country]);

  // Control visibility based on zoom level
  useEffect(() => {
    const handleZoom = () => {
      const zoom = map.getZoom();
      // Show regions at zoom < 13, hide at higher zoom levels
      setVisible(zoom < 13);
    };

    handleZoom(); // Set initial state
    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map]);

  const onEachFeature = useCallback(
    (feature: RegionFeature, layer: Layer) => {
      if (feature.properties) {
        const { code, name } = feature.properties;
        layer.bindTooltip(`<strong>${code}</strong><br/>${name}`, {
          permanent: false,
          direction: 'center',
          className: 'region-tooltip',
        });
      }
    },
    []
  );

  const getStyle = useCallback(() => {
    return {
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      color: '#2563eb',
      weight: 2,
      dashArray: '5, 5',
    };
  }, []);

  if (!regions || regions.features.length === 0 || !visible) {
    return null;
  }

  return (
    <GeoJSON
      key={`regions-${country}`}
      data={regions as unknown as GeoJSON.GeoJsonObject}
      style={getStyle}
      onEachFeature={onEachFeature as unknown as (feature: GeoJSON.Feature, layer: L.Layer) => void}
    />
  );
}

/**
 * Memoized version of RegionLayerComponent.
 */
export const RegionLayer = memo(RegionLayerComponent);
