export const CITY_SERVICE_STATUSES = ['live', 'coming-soon'] as const

export type CityServiceStatus = (typeof CITY_SERVICE_STATUSES)[number]

export function isCityServiceStatus(value: unknown): value is CityServiceStatus {
  return value === 'live' || value === 'coming-soon'
}
