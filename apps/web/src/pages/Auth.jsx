import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Auth() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const fn = mode === 'signin' ? signIn : signUp;
    try {
      const result = await fn(email, password);
      console.log(`[auth] ${mode} result:`, result);
      if (result.error) {
        const x = result.error;
        console.error(`[auth] ${mode} error:`, x);
        const parts = [x.message];
        if (x.status) parts.push(`status ${x.status}`);
        if (x.code) parts.push(`code ${x.code}`);
        setErr(parts.join(' · '));
      } else if (mode === 'signup' && result.data?.user && !result.data?.session) {
        setErr('Account created but no session — email confirmation is required. Disable it in Supabase dashboard or check your inbox.');
      }
    } catch (x) {
      console.error(`[auth] ${mode} threw:`, x);
      setErr(`Unexpected: ${x.message ?? x}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mode === 'signin' ? 'Welcome back' : 'Create account'}</h1>
        <p>{mode === 'signin' ? 'Sign in to continue' : 'Sign up to save playlists and likes'}</p>
        <label>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
        <button className="btn btn-primary submit" disabled={busy}>
          {busy ? '…' : (mode === 'signin' ? 'Sign in' : 'Sign up')}
        </button>
        {err && <div className="err">{err}</div>}
        <button type="button" className="toggle" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
