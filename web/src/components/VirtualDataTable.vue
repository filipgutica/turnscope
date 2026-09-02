<template>
  <div class="data-table">
    <div v-if="$slots.toolbar" class="data-table__toolbar">
      <slot name="toolbar" />
    </div>
    <div
      ref="scrollElement"
      class="data-table__viewport"
      tabindex="0"
      :aria-label="label"
      @scroll="handleScroll"
    >
      <table>
        <thead>
          <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <th v-for="header in headerGroup.headers" :key="header.id" scope="col">
              <FlexRender v-if="!header.isPlaceholder" :header="header" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="paddingTop > 0" aria-hidden="true">
            <td :colspan="columns.length" :style="{ height: `${paddingTop}px`, padding: 0 }" />
          </tr>
          <tr
            v-for="virtualRow in visibleRows"
            :key="String(virtualRow.key)"
            :data-index="virtualRow.index"
          >
            <td
              v-for="cell in tableRows[virtualRow.index]?.getAllCells() ?? []"
              :key="cell.id"
            >
              <FlexRender :cell="cell" />
            </td>
          </tr>
          <tr v-if="paddingBottom > 0" aria-hidden="true">
            <td :colspan="columns.length" :style="{ height: `${paddingBottom}px`, padding: 0 }" />
          </tr>
        </tbody>
      </table>
    </div>
    <div class="data-table__status" aria-live="polite">
      <span>Showing {{ rows.length }} of {{ total }}</span>
      <span v-if="loading">Loading more…</span>
    </div>
  </div>
</template>

<script setup lang="ts" generic="TRow extends RowData & { id: string }">
import { computed, ref, toRef } from 'vue'
import { FlexRender, useTable, type RowData } from '@tanstack/vue-table'
import { useVirtualizer } from '@tanstack/vue-virtual'

import { dataTableFeatures, type DataTableColumn } from '../table'

const { rows, columns, total, loading = false, label } = defineProps<{
  rows: TRow[]
  columns: DataTableColumn<TRow>[]
  total: number
  loading?: boolean
  label: string
}>()
const emit = defineEmits<{
  (e: 'loadMore'): void
}>()

const scrollElement = ref<HTMLDivElement | null>(null)
const data = toRef(() => rows)
const table = useTable({ features: dataTableFeatures, columns, data })
const tableRows = computed(() => table.getRowModel().rows)
const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>(computed(() => ({
  count: tableRows.value.length,
  getScrollElement: () => scrollElement.value,
  estimateSize: () => 72,
  getItemKey: (index) => tableRows.value[index]?.id ?? index,
  initialRect: { width: 1000, height: 496 },
  overscan: 8,
})))
const visibleRows = computed(() => {
  const rows = rowVirtualizer.value.getVirtualItems()
  if (rows.length > 0 || scrollElement.value?.clientHeight !== 0) return rows
  return tableRows.value.map((row, index) => ({
    index,
    key: row.id,
    start: index * 72,
    end: (index + 1) * 72,
    size: 72,
    lane: 0,
  }))
})
const paddingTop = computed(() => visibleRows.value[0]?.start ?? 0)
const paddingBottom = computed(() => {
  const last = visibleRows.value.at(-1)
  return last ? Math.max(0, rowVirtualizer.value.getTotalSize() - last.end) : 0
})

const handleScroll = (): void => {
  const element = scrollElement.value
  if (!element || loading || rows.length >= total) return
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 320) emit('loadMore')
}
</script>
