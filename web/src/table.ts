import { tableFeatures, type ColumnDef, type RowData } from '@tanstack/vue-table'

export const dataTableFeatures = tableFeatures({})

export type DataTableColumn<TRow extends RowData> = ColumnDef<typeof dataTableFeatures, TRow>
