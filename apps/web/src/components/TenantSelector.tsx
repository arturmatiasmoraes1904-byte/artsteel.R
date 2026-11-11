'use client';
import {Building2,Check,ChevronsUpDown,LoaderCircle,Layers} from 'lucide-react';
import {useRouter} from 'next/navigation';
import {toast} from 'sonner';
import {useTenantStore} from '@/stores/useTenantStore';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
export function TenantSelector(){
  const {activeTenant,userTenants,switchTenant,switching}=useTenantStore();const router=useRouter();
  return <DropdownMenu><DropdownMenuTrigger className="tenant-select" disabled={switching}><span className="tenant-icon">{switching?<LoaderCircle className="spin" size={20}/>:<Building2 size={20}/>}</span><span><strong>{activeTenant?.nome_fantasia??'Selecione a empresa'}</strong><small>{activeTenant?.segmento.toLowerCase()} <span className="active-dot"/> Empresa ativa</small></span><ChevronsUpDown size={16}/></DropdownMenuTrigger><DropdownMenuContent align="start">{userTenants.map(t=><DropdownMenuItem key={t.id} onSelect={()=>{void switchTenant(t.id).then(()=>router.push('/dashboard')).catch(e=>toast.error(e.message));}}><Building2 size={16}/><span>{t.nome_fantasia}<small>{t.segmento}</small></span>{activeTenant?.id===t.id&&<Check size={16}/>}</DropdownMenuItem>)}{userTenants.some(t=>t.role!=='OPERADOR')&&<DropdownMenuItem onSelect={()=>router.push('/dashboard?visao=grupo')}><Layers size={16}/>Painel consolidado do grupo</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
}
