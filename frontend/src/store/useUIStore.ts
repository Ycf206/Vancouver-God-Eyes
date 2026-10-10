import { create } from 'zustand';

interface UIState {
  layers: {
    traffic: boolean;
    transit: boolean;
    ferries: boolean;
    weather: boolean;
    parking: boolean;
  };
  toggleLayer: (layer: keyof UIState['layers']) => void;
}

export const useUIStore = create<UIState>((set) => ({
  layers: {
    traffic: true,
    transit: true,
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
