'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/providers/AuthProvider';
import { api } from '@/lib/api';

export default function SettingsProfile() {
  const { user, name: currentName, avatarUrl, refresh } = useAuth();
  const [name, setName] = useState(currentName ?? '');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB');
      return;
    }
    setPendingAvatar(f);
    setRemoveAvatar(false);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const onRemove = () => {
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateProfile({
        name: name.trim() !== (currentName ?? '') ? name.trim() : undefined,
        avatar: pendingAvatar ?? undefined,
        removeAvatar,
      });
      await refresh();
      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(`Couldn't save: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const displayedAvatar = previewUrl ?? (removeAvatar ? null : avatarUrl);
  const initial = (name || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <form onSubmit={onSubmit} className="max-w-2xl">
      <h2 className="text-xl font-bold tracking-tight">Profile</h2>

      <div className="mt-6 flex items-center gap-5">
        <div className="relative h-20 w-20 rounded-full overflow-hidden bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)] grid place-items-center text-2xl font-bold text-white shrink-0">
          {displayedAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayedAvatar} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            Upload picture
          </Button>
          {(avatarUrl || pendingAvatar) && !removeAvatar && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground">
              Remove
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
          <p className="text-xs text-muted-foreground">JPEG / PNG / WebP / GIF · max 5 MB</p>
        </div>
      </div>

      <div className="mt-8 grid gap-2 max-w-sm">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={user?.email ?? ''}
        />
        <p className="text-xs text-muted-foreground">
          Shown in the sidebar. Leave blank to show your email.
        </p>
      </div>

      <Button type="submit" disabled={busy} className="mt-6 bg-ember hover:bg-ember-soft text-white">
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
