import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: () => import('../views/EditorView.vue'),
    },
  ],
})

export default router
