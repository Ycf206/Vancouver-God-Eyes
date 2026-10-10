import { create } from 'zustand';

export type MapStyleType = 'street' | 'satellite' | 'light' | 'dark';

interface UIState {
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

export const useUIStore = create<UIState>((set) => ({
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
}));
