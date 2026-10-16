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
    skytrainTrains: boolean;
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
    foodBanks: boolean;
    aed: boolean;
    homelessShelters: boolean;
    airports: boolean;
    carSharing: boolean;
    contours: boolean;
    localAreaBoundary: boolean;
    fuel: boolean;
    tesla: boolean;
    oneWayStreets: boolean;
    snowRemovalRoutes: boolean;
    maritimeShipping: boolean;
    marineTerminals: boolean;
    crimeAreas: boolean;
    waterDistributionMains: boolean;
    sewerMains: boolean;
    trafficSpeedLimits: boolean;
    bikeRacks: boolean;
    postalCodeFSA: boolean;
    wirelessFacilities: boolean;
    trafficCrosswalks: boolean;
    litterContainers: boolean;
  };
  contourInterval: 'off' | '1m' | '2m' | '10m';
  setContourInterval: (interval: 'off' | '1m' | '2m' | '10m') => void;
  timeFormat: '12h' | '24h';
  setTimeFormat: (format: '12h' | '24h') => void;
  timeZone: string;
  setTimeZone: (timeZone: string) => void;
  distanceUnit: 'metric' | 'imperial';
  setDistanceUnit: (unit: 'metric' | 'imperial') => void;
  temperatureUnit: 'celsius' | 'fahrenheit';
  setTemperatureUnit: (unit: 'celsius' | 'fahrenheit') => void;
  newsRefreshInterval: number;
  setNewsRefreshInterval: (interval: number) => void;
  userLocation: {
    address: string;
    displayName?: string;
    lat: number;
    lon: number;
    confirmed: boolean;
  } | null;
  setUserLocation: (loc: {
    address: string;
    displayName?: string;
    lat: number;
    lon: number;
    confirmed: boolean;
  } | null) => void;
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  toggleSettingsModal: () => void;
  isExploreOpen: boolean;
  setExploreOpen: (open: boolean) => void;
  toggleExplore: () => void;
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
        skytrainTrains: true,
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
        foodBanks: false,
        aed: false,
        homelessShelters: false,
        airports: true,
        contours: false,
        localAreaBoundary: false,
        fuel: false,
        tesla: false,
        oneWayStreets: false,
        snowRemovalRoutes: false,
        maritimeShipping: true,
        marineTerminals: true,
        crimeAreas: false,
        waterDistributionMains: false,
        sewerMains: false,
        trafficSpeedLimits: false,
        bikeRacks: false,
        postalCodeFSA: false,
        wirelessFacilities: false,
        trafficCrosswalks: false,
        litterContainers: false,
      },
      timeFormat: '24h',
      setTimeFormat: (format) => set({ timeFormat: format }),
      timeZone: 'America/Vancouver',
      setTimeZone: (tz) => set({ timeZone: tz }),
      distanceUnit: 'metric',
      setDistanceUnit: (unit) => set({ distanceUnit: unit }),
      temperatureUnit: 'celsius',
      setTemperatureUnit: (unit) => set({ temperatureUnit: unit }),
      newsRefreshInterval: 15,
      setNewsRefreshInterval: (interval) => set({ newsRefreshInterval: interval }),
      userLocation: null,
      setUserLocation: (loc) => set({ userLocation: loc }),
      isSettingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
      toggleSettingsModal: () => set((state) => ({ isSettingsModalOpen: !state.isSettingsModalOpen })),
      isExploreOpen: false,
      setExploreOpen: (open) => set({ isExploreOpen: open }),
      toggleExplore: () => set((state) => ({ isExploreOpen: !state.isExploreOpen })),
      toggleLayer: (layer) =>
        set((state) => {
          const nextActive = !state.layers[layer];
          let nextSearchTarget = state.searchTarget;
          if (!nextActive && state.searchTarget) {
            const st = state.searchTarget;
            const isTargetMatch =
              st.layer_key === layer ||
              (layer === 'fuel' && (st.category === 'fuel' || st.id?.startsWith('fuel_'))) ||
              (layer === 'tesla' && (st.category === 'tesla' || st.id?.startsWith('tesla_'))) ||
              (layer === 'evCharging' && (st.category === 'ev_charging' || st.id?.startsWith('ev_'))) ||
              (layer === 'airports' && st.category === 'airports') ||
              (layer === 'bcferriesTerminals' && st.category === 'ferry_terminal') ||
              (layer === 'bcferriesVehicles' && st.category === 'ferry_vehicle') ||
              (layer === 'marineTerminals' && st.category === 'marine_terminals') ||
              (layer === 'oneWayStreets' && (st.category === 'one_way_streets' || st.id?.startsWith('oneway_'))) ||
              (layer === 'snowRemovalRoutes' && (st.category === 'snow_removal_routes' || st.id?.startsWith('snow_'))) ||
              (layer === 'waterDistributionMains' && (st.category === 'water_distribution_mains' || st.id?.startsWith('water_'))) ||
              (layer === 'sewerMains' && (st.category === 'sewer_mains' || st.id?.startsWith('sewer_'))) ||
              (layer === 'skytrainRoutes' && st.category === 'skytrain') ||
              (layer === 'bus' && st.category === 'bus');
            if (isTargetMatch) {
              nextSearchTarget = null;
            }
          }
          return {
            layers: {
              ...state.layers,
              [layer]: nextActive,
            },
            searchTarget: nextSearchTarget,
          };
        }),
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
        timeZone: state.timeZone,
        distanceUnit: state.distanceUnit,
        temperatureUnit: state.temperatureUnit,
        newsRefreshInterval: state.newsRefreshInterval,
        userLocation: state.userLocation,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      merge: (persistedState: any, currentState: UIState) => {
        const contourInterval = persistedState?.contourInterval || (persistedState?.layers?.contours ? '10m' : 'off');
        return {
          ...currentState,
          ...persistedState,
          contourInterval,
          timeFormat: persistedState?.timeFormat || '24h',
          timeZone: persistedState?.timeZone || 'America/Vancouver',
          distanceUnit: persistedState?.distanceUnit || 'metric',
          temperatureUnit: persistedState?.temperatureUnit || 'celsius',
          newsRefreshInterval: persistedState?.newsRefreshInterval ?? 15,
          userLocation: persistedState?.userLocation || null,
          layers: {
            ...currentState.layers,
            ...(persistedState?.layers || {}),
            contours: contourInterval !== 'off',
            localAreaBoundary: persistedState?.layers?.localAreaBoundary || false,
            fuel: persistedState?.layers?.fuel || false,
            tesla: persistedState?.layers?.tesla || false,
            oneWayStreets: persistedState?.layers?.oneWayStreets || false,
            snowRemovalRoutes: persistedState?.layers?.snowRemovalRoutes || false,
            marineTerminals: persistedState?.layers?.marineTerminals ?? true,
            crimeAreas: persistedState?.layers?.crimeAreas || false,
            waterDistributionMains: persistedState?.layers?.waterDistributionMains || false,
            sewerMains: persistedState?.layers?.sewerMains || false,
          },
        };
      },
    }
  )
);
