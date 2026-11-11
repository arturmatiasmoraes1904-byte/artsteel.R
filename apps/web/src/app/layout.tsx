import type {Metadata} from 'next';
import {Providers} from '@/components/Providers';
import './globals.css';
export const metadata:Metadata={title:'Art Steel | Gestão de Operação',description:'Art Steel - Gestão de Operação para serralheria e locação de equipamentos.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;}
