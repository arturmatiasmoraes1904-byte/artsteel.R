import type {ButtonHTMLAttributes} from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cn} from '@/lib/utils';
export function Button({className,asChild=false,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{asChild?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={cn('button',className)} {...props}/>;}
