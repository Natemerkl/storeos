 import { createStore } from 'zustand/vanilla' 
 
 export const appStore = createStore((set) => ({ 
   user: null, 
   currentStore: null, 
   stores: [], 
   accountingView: 'separate', // 'separate' | 'joint' 
 
   setUser: (user) => set({ user }), 
   setCurrentStore: (store) => set({ currentStore: store }), 
   setStores: (stores) => set({ stores }), 
   setAccountingView: (view) => set({ accountingView: view }), 
 })) 
