export interface MorningRouteStop {
  id: string;
  taskId: string;
  orderId: string;
  address: string;
  type: 'drop-off' | 'pick-up';
  eventStartTime?: string;
  equipmentIds: string[];
  feedsOrderIds?: string[];
  numInflatables?: number;
  lat?: number;
  lng?: number;
  routeDateISO?: string;
}

export interface OptimizedMorningStop extends MorningRouteStop {
  sortOrder: number;
  distanceFromPreviousMeters?: number;
  durationFromPreviousSeconds?: number;
  arrivalTime?: string;
  setupMinutes?: number;
  estimatedLateness?: number;
}

export interface DistanceMatrixResult {
  distance: number;
  duration: number;
}

export interface Candidate {
  stop: MorningRouteStop;
  driveDurationSeconds: number;
  arrivalTime: Date;
  lateness: number;
  score: number;
}

export interface RouteOriginOptions {
  address: string;
  label: string;
}
