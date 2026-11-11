'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  Layers3,
  LockKeyhole,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  UsersRound,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Session } from '@/lib/types';
import { useTenantStore } from '@/stores/useTenantStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTheme } from 'next-themes';

const highlights = [
  {
    icon: Zap,
    title: 'Mais foco na operação',
    description: 'Rotinas e informações importantes em um só lugar.',
  },
  {
    icon: UsersRound,
    title: 'Empresas conectadas',
    description: 'Gestão independente para cada negócio do grupo.',
  },
  {
    icon: BarChart3,
    title: 'Decisões com clareza',
    description: 'Acompanhe indicadores e mantenha tudo em movimento.',
  },
];

export default function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Sobre a plataforma Art Steel">
        <div className="login-story-content">
          <a className="login-brand" href="/login" aria-label="Art Steel — página inicial">
            <span className="login-brand-mark"><Layers3 size={22} strokeWidth={2.3} /></span>
            <span className="login-brand-copy">
              <strong>Art Steel</strong>
              <small>GESTÃO DE OPERAÇÃO</small>
            </span>
          </a>

          <div className="login-pitch">
            <span className="login-kicker"><span /> GESTÃO INTEGRADA</span>
            <h1>
              Sua operação,
              <br />
              conectada em
              <br />
              <span>um só lugar.</span>
            </h1>
            <p className="login-pitch-copy">
              Da primeira locação à última solda. Organize equipes, acompanhe processos e faça seu negócio avançar.
            </p>

            <div className="login-highlights">
              {highlights.map(({ icon: Icon, title, description }) => (
                <div className="login-highlight" key={title}>
                  <span className="login-highlight-icon"><Icon size={20} /></span>
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  <Check className="login-highlight-check" size={16} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="login-story-footer">
          <ShieldCheck size={17} />
          <span>Um ambiente seguro para toda a sua operação.</span>
          <span className="login-footer-version">ART STEEL · OPERAÇÕES</span>
        </div>
        <div className="login-orbit login-orbit-one" aria-hidden="true" />
        <div className="login-orbit login-orbit-two" aria-hidden="true" />
        <div className="login-glow" aria-hidden="true" />
      </section>

      <section className="login-form-panel" aria-label="Acesso à plataforma">
        <div className="login-form-topline">
          <span className="login-secure-note"><LockKeyhole size={14} /> ACESSO SEGURO</span>
          {mounted && (
            <div className="login-theme-control">
              <Sun size={15} aria-hidden="true" />
              <Switch
                id="theme-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                aria-label="Ativar tema escuro"
              />
              <Moon size={15} aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="login-box">
          <span className="login-form-eyebrow">BEM-VINDO DE VOLTA</span>
          <h2>Entre na sua operação</h2>
          <p className="login-form-description">Acesse suas empresas com uma única conta.</p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError('');
              const data = new FormData(e.currentTarget);
              const rememberMe = data.get('remember-me') === 'on';
              try {
                const session = await api<Session>('/auth/login', {
                  method: 'POST',
                  body: JSON.stringify({
                    email: data.get('email'),
                    password: data.get('password'),
                    rememberMe,
                  }),
                });
                useTenantStore.getState().setSession(session);
                router.replace('/dashboard');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Erro ao entrar.');
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="login-field">
              <span>E-mail</span>
              <span className="login-input-wrap">
                <Mail size={18} aria-hidden="true" />
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="voce@empresa.com.br"
                  required
                />
              </span>
            </label>

            <label className="login-field">
              <span>Senha</span>
              <span className="login-input-wrap">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  required
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <div className="login-remember-row">
              <div className="login-remember">
                <Checkbox id="remember-me" name="remember-me" value="on" />
                <Label htmlFor="remember-me">Lembrar minhas credenciais</Label>
              </div>
              <span className="login-no-signup">Acesso fornecido pelo administrador</span>
            </div>

            {error && <div className="login-error" role="alert">{error}</div>}

            <Button className="login-submit" disabled={pending} type="submit">
              <span>{pending ? 'Entrando…' : 'Acessar plataforma'}</span>
              <ArrowRight size={18} />
            </Button>
          </form>

          <div className="login-divider"><span>AMBIENTE DE OPERAÇÃO</span></div>
          <p className="login-help">Locação de equipamentos <i /> Serralheria <i /> Gestão integrada</p>
        </div>

        <p className="login-legal">© {new Date().getFullYear()} Art Steel. Acesso restrito a usuários autorizados.</p>
      </section>
    </main>
  );
}
