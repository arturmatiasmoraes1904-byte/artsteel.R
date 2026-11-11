import {notFound} from 'next/navigation';
import {OperationList,Production,Settings} from '@/components/Operations';
import {Quote} from '@/components/Quote';
export default async function Page({params}:{params:Promise<{module:string[]}>}){const {module:parts}=await params;const path='/'+parts.join('/');if(path==='/serralheria/orcamentos/novo')return <Quote/>;if(path==='/serralheria/ordens-servico')return <Production/>;if(path==='/configuracoes/empresa')return <Settings/>;if(['/locacao/equipamentos','/locacao/contratos','/locacao/manutencoes','/serralheria/estoque-metais'].includes(path))return <OperationList path={path}/>;notFound();}
