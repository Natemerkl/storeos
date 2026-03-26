 import { createStore } from 'zustand/vanilla' 
 
// Helper to get today's date in YYYY-MM-DD format
const getTodayString = () => new Date().toISOString().split('T')[0]

export const appStore = createStore((set) => ({ 
  user: null, 
  currentStore: null, 
  stores: [], 
  accountingView: 'separate', // 'separate' | 'joint'
  
  // Global date range for filtering across all pages
  dateRange: {
    startDate: getTodayString(),
    endDate: getTodayString(),
    preset: 'today' // 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'custom'
  },

  setUser: (user) => set({ user }), 
  setCurrentStore: (store) => set({ currentStore: store }), 
  setStores: (stores) => set({ stores }), 
  setAccountingView: (view) => set({ accountingView: view }),
  setDateRange: (dateRange) => set({ dateRange }),
}))
