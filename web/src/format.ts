export const formatDate = (value: string | null): string => {
  if (value === null) {
    return 'Not reported'
  }

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Invalid source timestamp'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

export const formatConfidence = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value)
