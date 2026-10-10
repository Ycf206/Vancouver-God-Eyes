'use client';

import * as React from 'react';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function AppMap() {
  return (
    <div className="w-full h-full absolute inset-0 z-0">
      <Map
        initialViewState={{
          longitude: -123.1207, // Vancouver longitude
          latitude: 49.2827,    // Vancouver latitude
          zoom: 11.5,
          pitch: 45,            // Tilt for 3D effect
          bearing: -17.6        // Slight rotation
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      />
    </div>
  );
}
