'use client';
import {create} from 'zustand';
import {persist,createJSONStorage} from 'zustand/middleware';
import type {Session,Tenant} from '@/lib/types';
import {api} from '@/lib/api';
import {queryClient} from '@/lib/query';

type State = {
  user: Session['user'] | null;
  activeTenant: Tenant | null;
  userTenants: Tenant[];
  token: string | null;
  switching: boolean;
  setSession: (session: Session) => void;
  switchTenant: (id: string) => Promise<void>;
  logout: () => void;
  updateActiveTenant: (data: Partial<Tenant>) => void;
};

export function canonicalizeTenant(tenant: Tenant | null): Tenant | null {
  if (!tenant) return null;
  let nome = tenant.nome_fantasia;
  let razao = tenant.razao_social;
  const isLocadora = tenant.segmento === 'LOCADORA';

  if (!nome || nome.includes('Atlas') || nome.includes('Ferro & Forma')) {
    nome = isLocadora ? 'Art Steel Locações' : 'Art Steel';
  }
  if (!razao || razao.includes('Atlas') || razao.includes('Ferro & Forma')) {
    razao = isLocadora ? 'Art Steel Locações LTDA' : 'Art Steel Serralheria e Estruturas Metálicas LTDA';
  }

  return {
    ...tenant,
    nome_fantasia: nome,
    razao_social: razao,
  };
}

export const useTenantStore = create<State>()(persist((set, get) => ({
  user: null,
  activeTenant: null,
  userTenants: [],
  token: null,
  switching: false,
  setSession: session => set({
    ...session,
    activeTenant: canonicalizeTenant(session.activeTenant),
    userTenants: session.userTenants.map(t => canonicalizeTenant(t)!)
  }),
  logout: () => set({ user: null, activeTenant: null, userTenants: [], token: null, switching: false }),
  updateActiveTenant: data => set(state => {
    if (!state.activeTenant) return state;
    const updatedActive = { ...state.activeTenant, ...data };
    const updatedUserTenants = state.userTenants.map(t => 
      t.id === updatedActive.id ? { ...t, ...data } : t
    );
    return {
      ...state,
      activeTenant: updatedActive,
      userTenants: updatedUserTenants
    };
  }),
  switchTenant: async id => {
    if (get().switching || get().activeTenant?.id === id) return;
    set({ switching: true });
    try {
      await queryClient.cancelQueries();
      const session = await api<Session>('/auth/switch-tenant', {
        method: 'POST',
        body: JSON.stringify({ target_tenant_id: id })
      });
      queryClient.clear();
      set({
        ...session,
        activeTenant: canonicalizeTenant(session.activeTenant),
        userTenants: session.userTenants.map(t => canonicalizeTenant(t)!)
      });
      await queryClient.invalidateQueries();
    } finally {
      set({ switching: false });
    }
  }
}), {
  name: 'nexo-session',
  storage: createJSONStorage(() => sessionStorage),
  partialize: s => ({ user: s.user, activeTenant: s.activeTenant, userTenants: s.userTenants, token: s.token }),
  onRehydrateStorage: () => (state) => {
    if (state?.activeTenant) state.activeTenant = canonicalizeTenant(state.activeTenant);
    if (state?.userTenants) state.userTenants = state.userTenants.map(t => canonicalizeTenant(t)!);
  }
}));
