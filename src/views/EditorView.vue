<script setup lang="ts">
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- Main content area: Video + Sidebar -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Video area (left/main) -->
      <div class="flex-1 flex flex-col">
        <div class="flex-1 bg-black flex items-center justify-center m-2 rounded-lg">
          <p class="text-gray-500 text-lg">Video area</p>
        </div>
        <!-- Timeline (bottom) -->
        <div class="h-24 bg-gray-800 m-2 mt-0 rounded-lg flex items-center justify-center">
          <p class="text-gray-500 text-sm">Timeline</p>
        </div>
      </div>

      <!-- Sidebar (right) -->
      <div class="w-72 bg-gray-800 m-2 ml-0 rounded-lg flex flex-col">
        <div class="p-4 border-b border-gray-700">
          <p class="text-sm font-medium text-gray-400">Segments</p>
        </div>
        <div class="flex-1 flex items-center justify-center">
          <p class="text-gray-500 text-sm">Sidebar</p>
        </div>
      </div>
    </div>
  </div>
</template>
