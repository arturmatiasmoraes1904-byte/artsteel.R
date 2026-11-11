'use client';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import type {ComponentProps} from 'react';
export const DropdownMenu=Primitive.Root;
export const DropdownMenuTrigger=Primitive.Trigger;
export function DropdownMenuContent(props:ComponentProps<typeof Primitive.Content>){return <Primitive.Portal><Primitive.Content sideOffset={8} className="dropdown" {...props}/></Primitive.Portal>;}
export function DropdownMenuItem(props:ComponentProps<typeof Primitive.Item>){return <Primitive.Item className="dropdown-item" {...props}/>;}
