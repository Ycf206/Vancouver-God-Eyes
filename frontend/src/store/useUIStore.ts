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
    sharedBikes: boolean;
    bikeways: boolean;
    trafficCameras: boolean;
    safetyCameras: boolean;
    fireHalls: boolean;
    police: boolean;
    disasterHubs: boolean;
    communityCentres: boolean;
    hospitals: boolean;
    parks: boolean;
    parksFacilities: boolean;
    communityGardens: boolean;
    drinkingFountains: boolean;
    publicWashrooms: boolean;
    schools: boolean;
    libraries: boolean;
    foodVendors: boolean;
    aed: boolean;
    homelessShelters: boolean;
    airports: boolean;
    carSharing: boolean;
    contours: boolean;
    localAreaBoundary: boolean;
  };
  contourInterval: 'off' | '1m' | '2m' | '10m';
  setContourInterval: (interval: 'off' | '1m' | '2m' | '10m') => void;
  timeFormat: '12h' | '24h';
  setTimeFormat: (format: '12h' | '24h') => void;
  distanceUnit: 'metric' | 'imperial';
  setDistanceUnit: (unit: 'metric' | 'imperial') => void;
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  toggleSettingsModal: () => void;
  toggleLayer: (layer: keyof UIState['layers']) => void;
  enableLayer: (layer: keyof UIState['layers']) => void;
  searchTarget: SearchTarget | null;
  setSearchTarget: (target: SearchTarget | null) => void;
  isLayerPanelOpen: boolean;
  toggleLayerPanel: () => void;
  setLayerPanelOpen: (open: boolean) => void;
  isFlightScheduleOpen: boolean;
  toggleFlightSchedule: () => void;
  setFlightScheduleOpen: (open: boolean) => void;
  selectedFlightId: string | null;
  setSelectedFlightId: (id: string | null) => void;
}


export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mapStyleType: 'dark',
      setMapStyleType: (type) => set({ mapStyleType: type }),
      contourInterval: 'off',
      setContourInterval: (interval) =>
        set((state) => ({
          contourInterval: interval,
          layers: {
            ...state.layers,
            contours: interval !== 'off',
          },
        })),
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
        carSharing: false,
        sharedBikes: false,
        bikeways: false,
        trafficCameras: false,
        safetyCameras: false,
        fireHalls: false,
        police: false,
        disasterHubs: false,
        communityCentres: false,
        hospitals: false,
        parks: false,
        parksFacilities: false,
        communityGardens: false,
        drinkingFountains: false,
        publicWashrooms: false,
        schools: false,
        libraries: false,
        foodVendors: false,
        aed: false,
        homelessShelters: false,
        airports: true,
        contours: false,
        localAreaBoundary: false,
      },
      timeFormat: '24h',
      setTimeFormat: (format) => set({ timeFormat: format }),
      distanceUnit: 'metric',
      setDistanceUnit: (unit) => set({ distanceUnit: unit }),
      isSettingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
      toggleSettingsModal: () => set((state) => ({ isSettingsModalOpen: !state.isSettingsModalOpen })),
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
      isLayerPanelOpen: true,
      toggleLayerPanel: () => set((state) => ({ isLayerPanelOpen: !state.isLayerPanelOpen })),
      setLayerPanelOpen: (open) => set({ isLayerPanelOpen: open }),
      isFlightScheduleOpen: false,
      toggleFlightSchedule: () => set((state) => ({ isFlightScheduleOpen: !state.isFlightScheduleOpen })),
      setFlightScheduleOpen: (open) => set({ isFlightScheduleOpen: open }),
      selectedFlightId: null,
      setSelectedFlightId: (id) => set({ selectedFlightId: id }),
    }),

    {
      name: 'vancouver-gods-eye-ui-storage',
      partialize: (state) => ({
        mapStyleType: state.mapStyleType,
        layers: state.layers,
        isLayerPanelOpen: state.isLayerPanelOpen,
        contourInterval: state.contourInterval,
        timeFormat: state.timeFormat,
        distanceUnit: state.distanceUnit,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      merge: (persistedState: any, currentState: UIState) => {
        const contourInterval = persistedState?.contourInterval || (persistedState?.layers?.contours ? '10m' : 'off');
        return {
          ...currentState,
          ...persistedState,
          contourInterval,
          timeFormat: persistedState?.timeFormat || '24h',
          distanceUnit: persistedState?.distanceUnit || 'metric',
          layers: {
            ...currentState.layers,
            ...(persistedState?.layers || {}),
            contours: contourInterval !== 'off',
            localAreaBoundary: persistedState?.layers?.localAreaBoundary || false,
          },
        };
      },
    }
  )
);
