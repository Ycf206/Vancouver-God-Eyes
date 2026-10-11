import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MapStyleType = 'street' | 'satellite' | 'light' | 'dark';

export interface SearchTarget {
  id: string;
  title: string;
  subtitle?: string;
  category: string;
  badge: string;
  icon: string;
  lon: number;
  lat: number;
  zoom?: number;
  layer_key?: keyof UIState['layers'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: any;
}

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
    bcferriesVehicles: boolean;
    bcferriesRoutes: boolean;
    bcferriesTerminals: boolean;
    parkingMeters: boolean;
    accessibleParking: boolean;
    motorcycleParking: boolean;
    evCharging: boolean;
    escooter: boolean;
    fireHalls: boolean;
    communityCentres: boolean;
  };
  toggleLayer: (layer: keyof UIState['layers']) => void;
  enableLayer: (layer: keyof UIState['layers']) => void;
  searchTarget: SearchTarget | null;
  setSearchTarget: (target: SearchTarget | null) => void;
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
        bcferriesVehicles: true,
        bcferriesRoutes: true,
        bcferriesTerminals: true,
        parkingMeters: false,
        accessibleParking: false,
        motorcycleParking: false,
        evCharging: false,
        escooter: false,
        fireHalls: false,
        communityCentres: false,
      },
      toggleLayer: (layer) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [layer]: !state.layers[layer],
          },
        })),
      enableLayer: (layer) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [layer]: true,
          },
        })),
      searchTarget: null,
      setSearchTarget: (target) => set({ searchTarget: target }),
    }),
    {
      name: 'vancouver-gods-eye-ui-storage',
      partialize: (state) => ({
        mapStyleType: state.mapStyleType,
        layers: state.layers,
      }),
    }
  )
);
