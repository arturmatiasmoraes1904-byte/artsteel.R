import {useTenantStore} from '@/stores/useTenantStore';
import {queryClient} from './query';
import {apiRequestHeaders} from './apiRequestHeaders';
export class ApiError extends Error {constructor(message:string,public status:number){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const token=useTenantStore.getState().token;
  let response:Response;
  try {response=await fetch(`${process.env.NEXT_PUBLIC_API_URL??'http://localhost:3333'}${path}`,{...options,headers:apiRequestHeaders(token,options)});} catch(e){if(e instanceof Error&&e.name==='AbortError')throw e;throw new ApiError('Não foi possível conectar à API. Verifique se o servidor e o banco estão iniciados.',0);}
  if(response.status===401&&token===useTenantStore.getState().token){useTenantStore.getState().logout();queryClient.clear();}
  const result=await response.json();
  if(!response.ok)throw new ApiError(result.error?.message??'Não foi possível concluir a solicitação.',response.status);
  return result.data as T;
}
