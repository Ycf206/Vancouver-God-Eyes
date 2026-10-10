import { create } from 'zustand';

export type MapStyleType = 'street' | 'satellite' | 'light' | 'dark';

interface UIState {
  mapStyleType: MapStyleType;
  setMapStyleType: (type: MapStyleType) => void;
  layers: {
    traffic: boolean;
    transit: boolean; // deprecated, use fine-grained
    bus: boolean;
    busStops: boolean;
    skytrain: boolean;
    skytrainStops: boolean;
    ferries: boolean;
    weather: boolean;
    parking: boolean;
  };
  toggleLayer: (layer: keyof UIState['layers']) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mapStyleType: 'dark',
  setMapStyleType: (type) => set({ mapStyleType: type }),
  layers: {
    traffic: true,
    transit: true,
    bus: true,
    busStops: false,
    skytrain: true,
    skytrainStops: true,
    ferries: false,
    weather: false,
    parking: false,
  },
  toggleLayer: (layer) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [layer]: !state.layers[layer],
      },
    })),
}));
