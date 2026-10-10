import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MapStyleType = 'street' | 'satellite' | 'light' | 'dark';

export interface UIState {
  mapStyleType: MapStyleType;
  setMapStyleType: (type: MapStyleType) => void;
  layers: {
    traffic: boolean;
    bus: boolean;
    busRoutes: boolean;
    busStops: boolean;
    skytrainRoutes: boolean;
    skytrainStops: boolean;
    seabusVehicles: boolean;
    seabusRoutes: boolean;
    seabusStops: boolean;
  };
  toggleLayer: (layer: keyof UIState['layers']) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mapStyleType: 'dark',
      setMapStyleType: (type) => set({ mapStyleType: type }),
      layers: {
        traffic: true,
        bus: true,
        busRoutes: true,
        busStops: false,
        skytrainRoutes: true,
        skytrainStops: true,
        seabusVehicles: true,
        seabusRoutes: true,
        seabusStops: true,
      },
      toggleLayer: (layer) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [layer]: !state.layers[layer],
          },
        })),
    }),
    {
      name: 'vancouver-gods-eye-ui-storage', // name of the item in the storage (must be unique)
    }
  )
);
