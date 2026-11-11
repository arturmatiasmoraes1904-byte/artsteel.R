'use client';

import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useParams, useSearchParams} from 'next/navigation';
import {api} from '@/lib/api';
import {isValidDocumento, documentoMask} from '@/lib/documento';
import {IMaskInput} from 'react-imask';

type Quote = { numero:number; status:string; cliente_nome:string; nome_fantasia:string; valor_total:string; validade:string; condicoes_pagamento?:string; observacoes?:string; itens:{produto_nome:string; unidade?:string; quantidade:string; desconto?:string; total:string; medidas?:{unidade:string; quantidade:number|string; valor_unitario:number|string}[]}[] };
const currency = (value:string|number) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(Number(value));
const formatItemMeasures = (item: Quote['itens'][number]) => Array.isArray(item.medidas) && item.medidas.length > 0 ? item.medidas.map(m => `${m.quantidade} ${String(m.unidade || 'UN').toLowerCase()}`).join(' + ') : `${item.quantidade} ${(item.unidade || 'UN').toLowerCase()}`;

export default function PublicQuote() {
  const {token} = useParams<{token:string}>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(''); const [documento, setDocumento] = useState(''); const [confirmado, setConfirmado] = useState(false);
  const [motivo, setMotivo] = useState(''); const [reprovando, setReprovando] = useState(false);
  const query = useQuery({queryKey:['public-quote',token], queryFn:()=>api<Quote>(`/public/orcamentos/${token}`)});
  useEffect(() => {
    if (query.isSuccess && searchParams.get('print') === '1') {
      const timer = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(timer);
    }
  }, [query.isSuccess, searchParams]);
  const refresh = () => queryClient.invalidateQueries({queryKey:['public-quote',token]});
  const aceite = useMutation({mutationFn:()=>api(`/public/orcamentos/${token}/aceite`, {method:'POST',body:JSON.stringify({nome,documento})}), onSuccess:refresh});
  const reprovar = useMutation({mutationFn:()=>api(`/public/orcamentos/${token}/reprovar`, {method:'POST',body:JSON.stringify({motivo})}), onSuccess:refresh});
  if (query.isPending) return <main className="min-h-screen bg-zinc-950 text-white grid place-items-center">Carregando orçamento…</main>;
  if (query.error) return <main className="min-h-screen bg-zinc-950 text-white grid place-items-center">Orçamento não encontrado ou expirado.</main>;
  const quote = query.data, available = quote.status === 'ENVIADO' || quote.status === 'VISUALIZADO', documentoValido=isValidDocumento(documento);
  return <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6"><article className="max-w-3xl mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-8"><header className="flex justify-between border-b border-zinc-800 pb-6"><div><p className="text-lime-300 text-sm">{quote.nome_fantasia}</p><h1 className="text-2xl font-bold">Orçamento #{quote.numero}</h1></div><div className="text-right text-sm text-zinc-400">Cliente<br/><strong className="text-white">{quote.cliente_nome}</strong></div></header><section className="py-6"><table className="w-full text-sm"><thead className="text-zinc-400"><tr><th className="text-left py-2">Item</th><th>Qtd.</th><th className="text-right">Total</th></tr></thead><tbody>{quote.itens.map((item,index)=><tr key={index} className="border-t border-zinc-800"><td className="py-3">{item.produto_nome}</td><td className="text-center">{formatItemMeasures(item)}</td><td className="text-right">{currency(item.total)}</td></tr>)}</tbody></table></section><section className="border-t border-zinc-800 pt-5 flex justify-between"><div className="text-sm text-zinc-400">Validade: {quote.validade ? new Date(quote.validade).toLocaleDateString('pt-BR') : 'Não informada'}<br/>{quote.condicoes_pagamento}</div><strong className="text-2xl text-lime-300">{currency(quote.valor_total)}</strong></section>{quote.observacoes && <p className="mt-6 text-sm text-zinc-400">{quote.observacoes}</p>}{!available && <p className="mt-8 rounded bg-zinc-800 p-4 text-sm">Este orçamento já foi {quote.status.toLowerCase()}.</p>}{available && <section className="mt-8 border-t border-zinc-800 pt-6 space-y-3"><div className="flex gap-3"><button type="button" onClick={()=>setReprovando(false)} className={`font-bold px-4 py-2 rounded ${!reprovando?'bg-lime-300 text-black':'bg-zinc-800'}`}>Aceitar</button><button type="button" onClick={()=>setReprovando(true)} className={`font-bold px-4 py-2 rounded ${reprovando?'bg-red-400 text-black':'bg-zinc-800'}`}>Reprovar</button></div>{reprovando ? <form onSubmit={event=>{event.preventDefault();reprovar.mutate();}} className="space-y-3"><h2 className="font-bold">Informe o motivo da reprovação</h2><textarea required minLength={3} value={motivo} onChange={event=>setMotivo(event.target.value)} placeholder="Descreva o motivo" className="w-full min-h-28 p-3 rounded bg-zinc-800"/><button disabled={reprovar.isPending} className="bg-red-400 text-black font-bold px-5 py-3 rounded disabled:opacity-50">{reprovar.isPending?'Enviando…':'Confirmar reprovação'}</button>{reprovar.error&&<p className="text-red-400 text-sm">{(reprovar.error as Error).message}</p>}</form> : <form onSubmit={event=>{event.preventDefault();aceite.mutate();}} className="space-y-3"><h2 className="font-bold">Aceitar orçamento</h2><input required value={nome} onChange={event=>setNome(event.target.value)} placeholder="Nome completo" className="w-full p-3 rounded bg-zinc-800"/><IMaskInput required mask={documentoMask(documento)} value={documento} onAccept={value=>setDocumento(String(value))} placeholder="CPF ou CNPJ" className="w-full p-3 rounded bg-zinc-800"/><label className="text-sm flex gap-2"><input type="checkbox" checked={confirmado} onChange={event=>setConfirmado(event.target.checked)}/> Confirmo que li e aceito as condições.</label><button disabled={!confirmado||!documentoValido||aceite.isPending} className="bg-lime-300 text-black font-bold px-5 py-3 rounded disabled:opacity-50">{aceite.isPending?'Registrando…':'Aceitar orçamento'}</button>{documento&&!documentoValido&&<p className="text-red-400 text-sm">Informe um CPF ou CNPJ válido.</p>}{aceite.error&&<p className="text-red-400 text-sm">{(aceite.error as Error).message}</p>}</form>}</section>}</article></main>;
}
