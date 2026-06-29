import { create } from 'zustand';

export const useStore = create((set) => ({
  issues: [],
  selectedIssue: null,
  showReportForm: false,
  mapCenter: [13.0827, 80.2707],
  
  // Toast & Deep Link
  toast: null,
  activeIssueDeepLink: null,
  showHeatmap: false,
  mapMode: 'cluster',
  sortBy: 'recent',
  setToast: (toast) => set({ toast }),
  setActiveIssueDeepLink: (activeIssueDeepLink) => set({ activeIssueDeepLink }),
  toggleHeatmap: () => set((state) => ({ showHeatmap: !state.showHeatmap })),
  setMapMode: (mapMode) => set({ mapMode }),
  setSortBy: (sortBy) => set({ sortBy }),
  
  // Filter States
  selectedCategories: ['pothole', 'water_leak', 'broken_light', 'waste', 'other'],
  selectedStatuses: ['pending', 'verified', 'assigned'], // Resolved hidden by default

  token: localStorage.getItem('civisync_token') || null,
  user: (() => {
    try {
      const u = localStorage.getItem('civisync_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  })(),

  setIssues: (issues) => set({ issues }),
  setMapCenter: (mapCenter) => set({ mapCenter }),
  addIssue: (issue) => set((state) => ({ issues: [issue, ...state.issues] })),
  updateIssue: (updated) => set((state) => ({
    issues: state.issues.map((i) => i.id === updated.id ? updated : i),
    selectedIssue: state.selectedIssue?.id === updated.id ? updated : state.selectedIssue
  })),
  selectIssue: (selectedIssue) => set({ selectedIssue }),
  setShowReport: (showReportForm) => set({ showReportForm }),
  
  // Filter Actions
  toggleCategoryFilter: (category) => set((state) => {
    const isSelected = state.selectedCategories.includes(category);
    const newCategories = isSelected
      ? state.selectedCategories.filter((c) => c !== category)
      : [...state.selectedCategories, category];
    return { selectedCategories: newCategories };
  }),
  toggleStatusFilter: (status) => set((state) => {
    const isSelected = state.selectedStatuses.includes(status);
    const newStatuses = isSelected
      ? state.selectedStatuses.filter((s) => s !== status)
      : [...state.selectedStatuses, status];
    return { selectedStatuses: newStatuses };
  }),
  setFilters: (filters) => set((state) => ({ ...state, ...filters })),
  resetFilters: () => set({
    selectedCategories: ['pothole', 'water_leak', 'broken_light', 'waste', 'other'],
    selectedStatuses: ['pending', 'verified', 'assigned'],
    sortBy: 'recent',
    mapMode: 'cluster'
  }),

  login: (token, user) => {
    localStorage.setItem('civisync_token', token);
    localStorage.setItem('civisync_user', JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('civisync_token');
    localStorage.removeItem('civisync_user');
    set({ token: null, user: null, selectedIssue: null, showReportForm: false });
    window.location.href = '/';
  }
}));
