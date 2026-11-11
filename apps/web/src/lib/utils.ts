import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export const cn=(...inputs:ClassValue[])=>twMerge(clsx(inputs));
export const money=(v:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v??0));
export const number=(v:unknown)=>v===null||v===undefined?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v));
export const label=(v:unknown)=>String(v??'—').replaceAll('_',' ');
