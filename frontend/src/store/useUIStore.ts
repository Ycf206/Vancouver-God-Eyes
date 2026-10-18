import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MapStyleType = 'street' | 'satellite' | 'light' | 'dark';

export type ExploreTabType = 'weather' | 'news' | 'events' | 'ski' | 'aurora' | 'alerts' | 'traffic' | 'fuel' | 'ev' | 'ferry' | 'cargo' | 'beach' | 'border';

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
    recycling: boolean;
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
    vanWifi: boolean;
    tideStations: boolean;
    trafficConditions: boolean;
    wazeAlerts: boolean;
    roadClosures: boolean;
    roadConstruction: boolean;
    streetLighting: boolean;
    streetLightingConduits: boolean;
    beachWaterQuality: boolean;
    fireHydrants: boolean;
    zoningDistricts: boolean;
    publicTrees: boolean;
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
  transitAlertsRefreshInterval: number;
  setTransitAlertsRefreshInterval: (interval: number) => void;
  stationAlertsMap: Record<string, { critical: boolean; count: number; alert_ids: string[] }>;
  setStationAlertsMap: (map: Record<string, { critical: boolean; count: number; alert_ids: string[] }>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transitAlertsList: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTransitAlertsList: (alerts: any[]) => void;
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
  exploreTab: ExploreTabType;
  setExploreTab: (tab: ExploreTabType) => void;
  isExportModalOpen: boolean;
  setExportModalOpen: (open: boolean) => void;
  toggleExportModal: () => void;
  toggleLayer: (layer: keyof UIState['layers']) => void;
  enableLayer: (layer: keyof UIState['layers']) => void;
  resetAllLayers: () => void;
  parkingMeterFilter: {
    maxRate: number; // 0 = all
    creditCardOnly: boolean;
    timePeriod: 'auto' | 'day' | 'night';
  };
  setParkingMeterFilter: (filter: Partial<{ maxRate: number; creditCardOnly: boolean; timePeriod: 'auto' | 'day' | 'night' }>) => void;
  fuelFilter: {
    brands: string[]; // empty or ['all'] = all
  };
  setFuelFilter: (filter: Partial<{ brands: string[] }>) => void;
  evChargingFilter: {
    speed: 'all' | 'fast' | 'slow';
    connector: string; // 'all' or 'CCS' / 'J1772' / 'Tesla' / 'CHAdeMO'
    freeOnly: boolean;
  };
  setEvChargingFilter: (filter: Partial<{ speed: 'all' | 'fast' | 'slow'; connector: string; freeOnly: boolean }>) => void;
  isRadarActive: boolean;
  setIsRadarActive: (active: boolean) => void;
  radarFrameTime: number;
  setRadarFrameTime: (time: number) => void;
  radarHost: string;
  setRadarHost: (host: string) => void;
  radarTilePath: string;
  setRadarTilePath: (path: string) => void;
  radiusExploration: {
    active: boolean;
    lat: number;
    lon: number;
    radiusM: number;
  } | null;
  setRadiusExploration: (exp: { active: boolean; lat: number; lon: number; radiusM: number } | null) => void;
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
        busStops: true,
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
        recycling: false,
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
        vanWifi: false,
        tideStations: false,
        trafficConditions: false,
        wazeAlerts: false,
        roadClosures: false,
        roadConstruction: false,
        streetLighting: false,
        streetLightingConduits: false,
        beachWaterQuality: false,
        fireHydrants: false,
        zoningDistricts: false,
        publicTrees: false,
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
      transitAlertsRefreshInterval: 10,
      setTransitAlertsRefreshInterval: (interval) => set({ transitAlertsRefreshInterval: interval }),
      stationAlertsMap: {},
      setStationAlertsMap: (map) => set({ stationAlertsMap: map }),
      transitAlertsList: [],
      setTransitAlertsList: (alerts) => set({ transitAlertsList: alerts }),
      userLocation: null,
      setUserLocation: (loc) => set({ userLocation: loc }),
      isSettingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),
      toggleSettingsModal: () => set((state) => ({ isSettingsModalOpen: !state.isSettingsModalOpen })),
      isExploreOpen: false,
      setExploreOpen: (open) => set({ isExploreOpen: open }),
      toggleExplore: () => set((state) => ({ isExploreOpen: !state.isExploreOpen })),
      exploreTab: 'weather',
      setExploreTab: (tab) => set({ exploreTab: tab }),
      isExportModalOpen: false,
      setExportModalOpen: (open) => set({ isExportModalOpen: open }),
      toggleExportModal: () => set((state) => ({ isExportModalOpen: !state.isExportModalOpen })),
      toggleLayer: (layer) =>
        set((state) => {
          const nextActive = !state.layers[layer];
          let nextSearchTarget = state.searchTarget;
          if (!nextActive && state.searchTarget) {
            const st = state.searchTarget;
            const isTargetMatch =
              st.layer_key === layer ||
              (layer === 'recycling' && (st.category === 'recycling' || st.id?.startsWith('recycling_'))) ||
              (layer === 'fuel' && (st.category === 'fuel' || st.id?.startsWith('fuel_'))) ||
              (layer === 'tesla' && (st.category === 'tesla' || st.id?.startsWith('tesla_'))) ||
              (layer === 'evCharging' && (st.category === 'ev_charging' || st.id?.startsWith('ev_'))) ||
              (layer === 'vanWifi' && (st.category === 'van_wifi' || st.id?.startsWith('vanwifi_'))) ||
              (layer === 'airports' && st.category === 'airports') ||
              ((layer === 'bcferriesTerminals' || layer === 'bcferriesRoutes') && st.category === 'ferry_terminal') ||
              (layer === 'bcferriesVehicles' && st.category === 'ferry_vehicle') ||
              (layer === 'maritimeShipping' && st.category === 'maritime_vessel') ||
              (layer === 'marineTerminals' && st.category === 'marine_terminals') ||
              (layer === 'oneWayStreets' && (st.category === 'one_way_streets' || st.id?.startsWith('oneway_'))) ||
              (layer === 'snowRemovalRoutes' && (st.category === 'snow_removal_routes' || st.id?.startsWith('snow_'))) ||
              (layer === 'waterDistributionMains' && (st.category === 'water_distribution_mains' || st.id?.startsWith('water_'))) ||
              (layer === 'sewerMains' && (st.category === 'sewer_mains' || st.id?.startsWith('sewer_'))) ||
              ((layer === 'skytrainRoutes' || layer === 'skytrainStops') && st.category === 'skytrain') ||
              ((layer === 'seabusRoutes' || layer === 'seabusStops') && st.category === 'seabus') ||
              ((layer === 'busRoutes' || layer === 'busStops') && (st.category === 'bus_stop' || st.category === 'bus_route')) ||
              (layer === 'bus' && st.category === 'bus');
            if (isTargetMatch) {
              nextSearchTarget = null;
            }
          }
          const updatedLayers = {
            ...state.layers,
            [layer]: nextActive,
          };
          if (layer === 'skytrainRoutes' || layer === 'skytrainStops') {
            updatedLayers.skytrainRoutes = nextActive;
            updatedLayers.skytrainStops = nextActive;
          } else if (layer === 'bcferriesRoutes' || layer === 'bcferriesTerminals') {
            updatedLayers.bcferriesRoutes = nextActive;
            updatedLayers.bcferriesTerminals = nextActive;
          } else if (layer === 'busRoutes' || layer === 'busStops') {
            updatedLayers.busRoutes = nextActive;
            updatedLayers.busStops = nextActive;
          } else if (layer === 'seabusRoutes' || layer === 'seabusStops') {
            updatedLayers.seabusRoutes = nextActive;
            updatedLayers.seabusStops = nextActive;
          }
          return {
            layers: updatedLayers,
            searchTarget: nextSearchTarget,
          };
        }),
      enableLayer: (layer: keyof UIState['layers']) =>
        set((state) => {
          const updatedLayers = {
            ...state.layers,
            [layer]: true,
          };
          if (layer === 'skytrainRoutes' || layer === 'skytrainStops') {
            updatedLayers.skytrainRoutes = true;
            updatedLayers.skytrainStops = true;
          } else if (layer === 'bcferriesRoutes' || layer === 'bcferriesTerminals') {
            updatedLayers.bcferriesRoutes = true;
            updatedLayers.bcferriesTerminals = true;
          } else if (layer === 'busRoutes' || layer === 'busStops') {
            updatedLayers.busRoutes = true;
            updatedLayers.busStops = true;
          } else if (layer === 'seabusRoutes' || layer === 'seabusStops') {
            updatedLayers.seabusRoutes = true;
            updatedLayers.seabusStops = true;
          }
          return {
            layers: updatedLayers,
          };
        }),
      resetAllLayers: () =>
        set((state) => {
          const allFalseLayers = Object.keys(state.layers).reduce((acc, k) => {
            acc[k as keyof typeof state.layers] = false;
            return acc;
          }, {} as typeof state.layers);
          return {
            layers: allFalseLayers,
            contourInterval: 'off',
            searchTarget: null,
          };
        }),
      parkingMeterFilter: {
        maxRate: 0,
        creditCardOnly: false,
        timePeriod: 'auto',
      },
      setParkingMeterFilter: (filter) =>
        set((state) => ({
          parkingMeterFilter: {
            ...state.parkingMeterFilter,
            ...filter,
          },
        })),
      fuelFilter: {
        brands: [],
      },
      setFuelFilter: (filter) =>
        set((state) => ({
          fuelFilter: {
            ...state.fuelFilter,
            ...filter,
          },
        })),
      evChargingFilter: {
        speed: 'all',
        connector: 'all',
        freeOnly: false,
      },
      setEvChargingFilter: (filter) =>
        set((state) => ({
          evChargingFilter: {
            ...state.evChargingFilter,
            ...filter,
          },
        })),
      isRadarActive: false,
      setIsRadarActive: (active) => set({ isRadarActive: active }),
      radarFrameTime: 0,
      setRadarFrameTime: (time) => set({ radarFrameTime: time }),
      radarHost: 'https://tilecache.rainviewer.com',
      setRadarHost: (host) => set({ radarHost: host }),
      radarTilePath: '',
      setRadarTilePath: (path) => set({ radarTilePath: path }),
      radiusExploration: null,
      setRadiusExploration: (exp) => set({ radiusExploration: exp }),
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
        transitAlertsRefreshInterval: state.transitAlertsRefreshInterval,
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
          transitAlertsRefreshInterval: persistedState?.transitAlertsRefreshInterval ?? 10,
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
