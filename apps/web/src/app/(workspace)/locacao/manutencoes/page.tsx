import { redirect } from 'next/navigation';

export default function ManutencoesPage() {
  redirect('/locacao/equipamentos?tab=manutencoes');
}
