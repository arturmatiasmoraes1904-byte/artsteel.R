'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  AreaChart, Area, PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import {
  MoreVertical, Phone, Star, Activity, ShoppingBag, 
  ArrowUpRight, Users, Bell, Search, Globe, Moon, Check, MessageSquare,
  Wallet, Clock, TrendingUp, Percent, Target, Wrench, ArrowRight, Package as PackageIcon
} from 'lucide-react';
import {money,number,label} from '@/lib/utils';
import {useTenantStore} from '@/stores/useTenantStore';
import {Loading} from './AppShell';
import {useDashboardKPIs} from '@/hooks/useDashboard';

const PIE_COLORS=['#E4E7EC','#9CA1AA','#5E6570','#3A3F47'];

function relativeTime(value:string){
  const seconds=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));
  if(seconds<60) return 'Agora mesmo';
  if(seconds<3600) return `Há ${Math.floor(seconds/60)} min`;
  if(seconds<86400) return `Há ${Math.floor(seconds/3600)} h`;
  return `Há ${Math.floor(seconds/86400)} dias`;
}

export function Dashboard() {
  const {activeTenant,user}=useTenantStore();
  const params=useSearchParams();
  const [mixed,setMixed]=useState('locacao');
  const group=params.get('visao')==='grupo';
  const mode:'locacao'|'serralheria'|'grupo'=group?'grupo':activeTenant?.segmento==='SERRALHERIA'?'serralheria':activeTenant?.segmento==='MISTO'?mixed==='serralheria'?'serralheria':'locacao':'locacao';
  
  const {data,isPending,error,refetch}=useDashboardKPIs(activeTenant?.id,mode);
  
  const rental=mode==='locacao';
  
  const cards:Array<{name:string;value:string;hint:string;Icon:typeof Wallet;progress?:number}>=group?[
    {name:'Faturamento emitido',value:money(data?.faturamento),hint:'Receitas lançadas no período',Icon:Wallet},
    {name:'Recebíveis pendentes',value:money(data?.recebiveis),hint:'Saldo a receber em aberto',Icon:Clock},
    {name:'Valores recebidos',value:money(data?.recebido),hint:'Receitas marcadas como pagas',Icon:TrendingUp},
    {name:'Resultado operacional',value:data?.resultado_operacional!=null?money(data.resultado_operacional):'—',hint:'Receitas menos despesas',Icon:Activity}
  ]:[
    {name:'Receita no mês',value:money(data?.finance?.receitasMes),hint:'Receitas lançadas no Financeiro',Icon:Wallet},
    {name:'Receitas pendentes',value:money(data?.finance?.receitasPendentes),hint:'Contas a receber em aberto',Icon:Clock},
    {name:'Orçamentos',value:number(data?.quotes?.total),hint:`${number(data?.quotes?.aprovados)} aprovados`,Icon:ShoppingBag},
    {name:'Alertas de estoque',value:number(data?.stock?.baixo),hint:`${number(data?.stock?.total)} produtos cadastrados`,Icon:PackageIcon}
  ];

  const chart=group?data?.companies:rental?data?.categories:data?.stages;

  const areaData=data?.revenueHistory??[];
  const pieData=(data?.salesMix??[]).map((item,index)=>({...item,color:PIE_COLORS[index%PIE_COLORS.length]}));
  const mixTotal=pieData.reduce((total,item)=>total+item.value,0);
  const cashFlowData=data?.cashFlowHistory??[];
  const quoteStatusData=data?.quoteStatuses??[];

  return (
    <div className="p-8 pb-20 w-full text-[#F2F3F5] font-sans">
      
      <div className="flex justify-between items-center mb-8">
        <div>
          <span className="text-[#E4E7EC] text-[10px] font-bold uppercase tracking-wider block mb-2">{group?'PANORAMA DO GRUPO':'SEU NEGÓCIO EM MOVIMENTO'}</span>
          <h1 className="text-2xl font-semibold">{group?'Uma visão de todas as empresas.':`Olá, ${user?.name.split(' ')[0]??'gestor'}.`}</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
           <span className="text-xs text-[#9CA1AA] bg-[#23262B] px-3 py-1.5 rounded-md border border-[#2E3238]">
             {new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'long',year:'numeric'}).format(new Date())}
           </span>
           <div className="flex gap-2 text-[10px]">
             <Link className={`px-2 py-1 rounded ${!group?'bg-[#E4E7EC] text-[#121316] font-semibold':'text-[#9CA1AA] hover:text-[#F2F3F5]'}`} href="/dashboard">Visão da empresa</Link>
             <Link className={`px-2 py-1 rounded ${group?'bg-[#E4E7EC] text-[#121316] font-semibold':'text-[#9CA1AA] hover:text-[#F2F3F5]'}`} href="/dashboard?visao=grupo">Consolidado do grupo</Link>
           </div>
        </div>
      </div>

      {isPending?<Loading/>:error?<ErrorPanel error={error} onRetry={()=>refetch()}/>:(
      <>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
          {cards.map((c, i) => i === 2 ? (
            <div key={c.name} className="bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238] flex justify-between items-end h-[110px] relative overflow-hidden">
              <div className="flex flex-col justify-between h-full">
                <div className="text-xs text-[#9CA1AA]">{c.name}</div>
                <div className="text-[28px] leading-none font-bold text-[#F2F3F5]">{c.progress != null ? `${c.progress}%` : c.value}</div>
                <div className="text-[10px] text-[#7D838E]">{c.hint}</div>
              </div>
              <div className="relative w-16 h-8 flex items-end mb-1">
                <svg width="100%" height="100%" viewBox="0 0 100 50" className="overflow-visible">
                  <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#2E3238" strokeWidth="12" strokeLinecap="round" />
                  <path d="M 5 50 A 45 45 0 0 1 95 50" fill="none" stroke="#E4E7EC" strokeWidth="12" strokeLinecap="round" strokeDasharray="141.37" strokeDashoffset={141.37 * (1 - Math.min(100,Math.max(0,c.progress??0))/100)} />
                </svg>
              </div>
            </div>
          ) : (
            <div key={c.name} className="bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238] flex flex-col justify-between h-[110px]">
              <div className="text-xs text-[#9CA1AA]">{c.name}</div>
              <div className="text-[28px] leading-none font-bold text-[#F2F3F5]">{c.value}</div>
              <div className="flex items-center gap-1.5 text-[10px]">
                {c.progress != null&&<div className="flex items-center text-[#E4E7EC] gap-0.5"><TrendingUp className="w-3 h-3" /><span className="font-medium">{c.progress}%</span></div>}
                <span className="text-[#7D838E]">{c.hint}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
          <div className="bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238]">
            <div className="flex items-center justify-between mb-4">
              <div><span className="text-[10px] text-[#E4E7EC] uppercase tracking-wider">FINANCEIRO</span><h2 className="text-sm font-semibold mt-1">Receitas x despesas</h2></div>
              <Link href="/financeiro" className="text-[10px] text-[#E4E7EC] hover:underline">Ver financeiro</Link>
            </div>
            {cashFlowData.length && !group ? <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={cashFlowData} barGap={4}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#2E3238"/><XAxis dataKey="name" tick={{fontSize:10,fill:'#9CA1AA'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#9CA1AA'}} axisLine={false} tickLine={false}/><RechartsTooltip formatter={(value) => money(Number(value))} contentStyle={{borderRadius:8,background:'#23262B',border:'1px solid #2E3238',color:'#F2F3F5'}}/><Legend wrapperStyle={{fontSize:'10px'}}/><Bar dataKey="receitas" name="Receitas" fill="#E4E7EC" radius={[4,4,0,0]}/><Bar dataKey="despesas" name="Despesas" fill="#B85C5C" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div> : <Empty message={group ? 'O fluxo detalhado está disponível na visão de cada empresa.' : 'Ainda não há movimentações financeiras no período.'}/>} 
          </div>
          <div className="bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238]">
            <div className="flex items-center justify-between mb-4">
              <div><span className="text-[10px] text-[#E4E7EC] uppercase tracking-wider">COMERCIAL</span><h2 className="text-sm font-semibold mt-1">Status dos orçamentos</h2></div>
              <Link href="/orcamentos" className="text-[10px] text-[#E4E7EC] hover:underline">Ver orçamentos</Link>
            </div>
            {quoteStatusData.length && !group ? <div className="h-52"><ResponsiveContainer width="100%" height="100%"><BarChart data={quoteStatusData} layout="vertical" margin={{left:10,right:15}}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#2E3238"/><XAxis type="number" allowDecimals={false} tick={{fontSize:10,fill:'#9CA1AA'}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" width={85} tick={{fontSize:10,fill:'#9CA1AA'}} axisLine={false} tickLine={false}/><RechartsTooltip contentStyle={{borderRadius:8,background:'#23262B',border:'1px solid #2E3238',color:'#F2F3F5'}}/><Bar dataKey="quantidade" name="Orçamentos" fill="#A8B0BC" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer></div> : <Empty message={group ? 'O funil detalhado está disponível na visão de cada empresa.' : 'Ainda não há orçamentos cadastrados.'}/>} 
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          
          <div className="xl:col-span-3 space-y-4">
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <div className="md:col-span-2 bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238]">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-sm font-semibold">Mix de Vendas</h2>
                  <MoreVertical className="w-4 h-4 text-[#9CA1AA]" />
                </div>
                {pieData.length ? <div className="flex flex-col sm:flex-row items-center gap-8">
                  <div className="relative w-40 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} innerRadius={55} outerRadius={75} dataKey="value" stroke="none">
                          {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold">{money(mixTotal)}</span>
                      <span className="text-[10px] text-[#9CA1AA]">Faturado</span>
                    </div>
                  </div>
                  
                  <div className="flex-1 w-full">
                    <div className="flex items-center gap-3 mb-6 bg-[#23262B]/60 p-3 rounded-lg border border-[#2E3238]">
                      <div className="bg-[#E4E7EC]/10 p-2 rounded"><Activity className="w-4 h-4 text-[#E4E7EC]" /></div>
                      <div>
                        <div className="text-[10px] text-[#9CA1AA]">Total Faturado</div>
                        <div className="font-bold text-lg">{money(mixTotal)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                      {pieData.map((item) => (
                        <div key={item.name}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full" style={{backgroundColor: item.color}}></div>
                            <span className="text-xs text-[#9CA1AA]">{item.name}</span>
                          </div>
                          <div className="font-semibold text-sm pl-4">{money(item.value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div> : <Empty message="O mix de vendas aparecerá quando houver faturas cadastradas."/>}
              </div>

              <div className="md:col-span-1 bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238] flex flex-col justify-between">
                <div>
                  <div className="text-xs text-[#9CA1AA] mb-1">Evolução de Receita:</div>
                  <div className="text-[10px] text-[#7D838E] mb-2">Últimos 6 meses</div>
                  <div className="text-xl font-bold mb-4">{money(areaData.at(-1)?.value)}</div>
                </div>
                {areaData.some(item=>item.value>0) ? <div className="h-32 w-full mt-auto -mx-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={areaData}>
                        <defs>
                          <linearGradient id="colorValueRight" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#E4E7EC" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#E4E7EC" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="value" stroke="#E4E7EC" fillOpacity={1} fill="url(#colorValueRight)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                </div> : <Empty message="Ainda não há receita no período."/>}
              </div>

            </div>

            {/* Bottom Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <div className="md:col-span-2 bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238]">
                <div className="flex justify-between items-center mb-6">
                  <div>
                     <span className="text-[10px] text-[#E4E7EC] uppercase tracking-wider block mb-1">{group?'FINANCEIRO':rental?'DISPONIBILIDADE':'CHÃO DE FÁBRICA'}</span>
                     <h2 className="text-sm font-semibold">{group?'Faturamento por empresa':rental?'Sua frota, por categoria':'Ritmo da produção'}</h2>
                  </div>
                  <Activity className="w-4 h-4 text-[#9CA1AA]" />
                </div>
                
                {chart?.length ? (
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart} barSize={20}>
                        <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#2E3238"/>
                        <XAxis dataKey="name" tick={{fontSize:11,fill:'#9CA1AA'}} tickFormatter={label} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:11,fill:'#9CA1AA'}} axisLine={false} tickLine={false}/>
                        <RechartsTooltip cursor={{fill: '#23262B'}} contentStyle={{borderRadius:8,background:'#23262B',border:'1px solid #2E3238',color:'#F2F3F5'}}/>
                        <Legend wrapperStyle={{fontSize: '11px', paddingTop: '10px'}}/>
                        <Bar dataKey={group?'faturamento':rental?'alugados':'quantidade'} name={group?'Faturamento':rental?'Alugados':'Ordens'} fill="#E4E7EC" radius={[4,4,0,0]}/>
                        {rental&&<Bar dataKey="disponiveis" name="Disponíveis" fill="#6E7480" radius={[4,4,0,0]}/>}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <Empty message="Os gráficos aparecerão quando houver registros nesta empresa."/>}
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex-1 bg-[#1A1C20] p-5 rounded-xl border border-[#2E3238] relative overflow-hidden flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-[#E4E7EC] uppercase tracking-wider block mb-1">PRÓXIMOS PASSOS</span>
                    <h2 className="text-xl font-bold mb-2 leading-tight">Da visão<br/>para a ação.</h2>
                    <p className="text-[10px] text-gray-400 mb-4">Organize o dia a dia da sua operação com as informações no lugar certo.</p>
                  </div>
                  
                  <div className="flex flex-col gap-2 text-xs">
                     {group?(
                        <Link href="/dashboard" className="flex justify-between items-center py-2 border-t border-[#2E3238] text-[#E4E7EC] hover:text-[#F2F3F5] transition-colors">Voltar para a empresa<ArrowRight size={14}/></Link>
                      ):rental?(
                        <>
                          <Link href="/locacao/equipamentos" className="flex justify-between items-center py-2 border-t border-[#2E3238] text-[#E4E7EC] hover:text-[#F2F3F5] transition-colors">Consultar equipamentos<ArrowUpRight size={14}/></Link>
                          <Link href="/locacao/contratos" className="flex justify-between items-center py-2 border-t border-[#2E3238] text-[#E4E7EC] hover:text-[#F2F3F5] transition-colors">Gerenciar contratos<ArrowUpRight size={14}/></Link>
                        </>
                      ):(
                        <>
                          <Link href="/orcamentos" className="flex justify-between items-center py-2 border-t border-[#2E3238] text-[#E4E7EC] hover:text-white transition-colors">Criar um orçamento<ArrowUpRight size={14}/></Link>
                          <Link href="/producao" className="flex justify-between items-center py-2 border-t border-[#2E3238] text-[#E4E7EC] hover:text-white transition-colors">Acompanhar produção<ArrowUpRight size={14}/></Link>
                        </>
                      )}
                  </div>
                </div>
              </div>

            </div>

          </div>

          <div className="xl:col-span-1 flex flex-col gap-8 pl-4 border-l border-[#2E3238] pt-4 xl:pt-0">
            
            <div>
              <h3 className="text-sm font-semibold mb-4 text-[#E4E7EC]">Atividades Recentes</h3>
              <div className="space-y-4 text-xs">
                {data?.activities?.length ? data.activities.map(activity=><div key={`${activity.type}-${activity.id}`} className="flex gap-3">
                  <div className="mt-1">{activity.type==='financeiro'?<Wallet className="w-4 h-4 text-[#9CA1AA] bg-[#23262B] rounded-full p-0.5"/>:activity.type==='orcamento'?<ShoppingBag className="w-4 h-4 text-[#9CA1AA] bg-[#23262B] rounded-full p-0.5"/>:<Activity className="w-4 h-4 text-[#E4E7EC] bg-[#E4E7EC]/10 rounded-full p-0.5"/>}</div>
                  <div><div className="text-gray-200">{activity.message}</div><div className="text-[10px] text-[#7D838E] mt-0.5">{relativeTime(activity.occurredAt)}</div></div>
                </div>) : <Empty message="Nenhuma atividade registrada ainda."/>}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-4 text-[#E4E7EC]">Clientes</h3>
              <div className="space-y-2">
                {data?.contacts?.length ? data.contacts.map(contact=><div key={contact.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#23262B] transition-colors">
                  <div className="min-w-0"><div className="text-xs font-medium text-gray-300 truncate">{contact.name}</div><div className="text-[10px] text-[#7D838E] truncate">{contact.phone??contact.email??'Sem contato cadastrado'}</div></div>
                  {contact.phone&&<Phone className="w-4 h-4 text-[#E4E7EC]" />}
                </div>) : <Empty message="Nenhum cliente cadastrado."/>}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-4 text-[#E4E7EC]">Avisos do Sistema</h3>
              <div className="space-y-4 text-xs relative">
                {data?.alerts?.length ? data.alerts.map(alert=><div key={alert.id} className="flex gap-3 relative">
                  <div className="w-5 h-5 rounded-full bg-[#1A1C20] border-2 border-[#2E3238] flex items-center justify-center mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-[#E0A11B]"></div>
                  </div>
                  <div><div className="text-gray-200">{alert.message}</div>{alert.occurredAt&&<div className="text-[10px] text-[#7D838E] mt-0.5">{relativeTime(alert.occurredAt)}</div>}</div>
                </div>) : <Empty message="Nenhum aviso operacional."/>}
              </div>
            </div>

            <div className="bg-gradient-to-br from-[#23262B] to-[#121316] p-5 rounded-xl border border-[#2E3238] flex flex-col justify-between relative overflow-hidden mt-auto">
               <div className="absolute top-0 right-0 w-32 h-32 bg-[#E4E7EC] rounded-full blur-[80px] opacity-15"></div>
               <div>
                 <div className="flex justify-between items-center mb-4">
                   <div className="bg-[#E4E7EC]/15 text-[#E4E7EC] text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                     <span className="w-2 h-2 rounded-full bg-[#E4E7EC]"></span> Dica Art Steel
                   </div>
                 </div>
                 <h4 className="font-bold text-sm mb-1 text-[#F2F3F5]">Múltiplos CNPJs?</h4>
                 <p className="text-[10px] text-[#9CA1AA] mt-2 leading-relaxed">
                   Você pode ver os dados da sua locadora e da sua serralheria no mesmo lugar ativando a visão integrada.
                 </p>
               </div>
            </div>

          </div>

        </div>
      </>
      )}
    </div>
  );
}

export function Empty({message}: {message?: string}) {
  return <div className="text-center p-8 text-xs text-gray-500">{message || 'Vazio'}</div>;
}

export function ErrorPanel({error, onRetry}: {error: any, onRetry?: () => void}) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-6 rounded-xl flex items-center justify-between">
      <span className="text-sm">Erro ao carregar dados: {error?.message}</span>
      <button onClick={onRetry} className="bg-red-500 text-white px-4 py-2 rounded text-xs">Tentar novamente</button>
    </div>
  );
}
