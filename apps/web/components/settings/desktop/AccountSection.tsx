'use client';

import { useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckIcon } from '@/components/icons';
import { Avatar } from '@/components/primitives/Avatar';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { api } from '@/lib/api';
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from './rows';

const MAX_AVATAR = 5 * 1024 * 1024;
const NAME_HINT = 'Shown in the sidebar. Leave blank to show your email.';

/** A picked picture, or null (with a toast) when it is too big. */
function pickedFile(e: ChangeEvent<HTMLInputElement>): File | null {
  const f = e.target.files?.[0] ?? null;
  e.target.value = '';
  if (!f) return null;
  if (f.size > MAX_AVATAR) {
    toast.error('Image must be under 5 MB');
    return null;
  }
  return f;
}

function useSaveProfile() {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Parameters<typeof api.updateProfile>[0]) => {
    setBusy(true);
    try {
      await api.updateProfile(patch);
      await refresh();
      return true;
    } catch (err) {
      toast.error(`Couldn't save: ${(err as Error).message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

function SavedTick() {
  return (
    <span role="status" className="flex items-center gap-inset text-sm font-semibold text-muted-foreground">
      <CheckIcon className="size-4 text-ember" />
      Saved
    </span>
  );
}

function PictureInput({ inputRef, onPick }: { inputRef: RefObject<HTMLInputElement | null>; onPick: (f: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      data-testid="avatar-input"
      onChange={(e) => {
        const f = pickedFile(e);
        if (f) onPick(f);
      }}
    />
  );
}

/** The profile (owner pick: edit A): the name saves when the field loses
 *  focus, a picture saves as soon as it is picked. No Save button, a small
 *  Saved tick instead. */
function AutoSaveProfile() {
  const { user, name: currentName, avatarUrl } = useAuth();
  const { busy, save } = useSaveProfile();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<'name' | 'picture' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = draft ?? currentName ?? '';

  const commitName = async () => {
    if (draft === null) return;
    if (draft.trim() === (currentName ?? '')) {
      setDraft(null);
      return;
    }
    if (await save({ name: draft.trim() })) {
      setDraft(null);
      setSaved('name');
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  return (
    <SettingsGroup title="Profile">
      <SettingsRow
        leading={<Avatar src={avatarUrl} name={name} email={user?.email} className="size-16 cover-placeholder text-2xl text-ember-foreground" />}
        title={currentName || user?.email}
        description={currentName ? user?.email : 'JPEG / PNG / WebP / GIF · max 5 MB'}
        control={
          <>
            {saved === 'picture' && <SavedTick />}
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              Change picture
            </Button>
            {avatarUrl && (
              <Button
                variant="ghost"
                disabled={busy}
                className="text-muted-foreground"
                onClick={async () => {
                  if (await save({ removeAvatar: true })) setSaved('picture');
                }}
              >
                Remove
              </Button>
            )}
            <PictureInput
              inputRef={fileRef}
              onPick={async (f) => {
                if (await save({ avatar: f })) setSaved('picture');
              }}
            />
          </>
        }
      />
      <SettingsRow
        title={<label htmlFor="username">Username</label>}
        control={saved === 'name' ? <SavedTick /> : undefined}
      >
        <Input
          id="username"
          maxLength={50}
          value={name}
          placeholder={user?.email ?? ''}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(null);
          }}
          onBlur={() => void commitName()}
          onKeyDown={onKeyDown}
          className="mt-cluster max-w-sm"
        />
        <p className="mt-inset text-xs text-muted-foreground">{NAME_HINT} Saves when you click away.</p>
      </SettingsRow>
    </SettingsGroup>
  );
}

/** The same two privacy switches as PrivacyToggles, as rows. */
function PrivacyRows() {
  const shareDiscord = usePrivacyStore((s) => s.shareDiscord);
  const shareListening = usePrivacyStore((s) => s.shareListening);
  const loaded = usePrivacyStore((s) => s.loaded);
  const failed = usePrivacyStore((s) => s.failed);
  const load = usePrivacyStore((s) => s.load);
  const set = usePrivacyStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const update = async (patch: { shareDiscord?: boolean; shareListening?: boolean }) => {
    setBusy(true);
    try {
      await set(patch);
    } catch (e) {
      toast.error(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title="Privacy" footer="Your listening history is still saved either way, it just isn't shared.">
      {failed && (
        <SettingsRow
          title="Couldn't load your privacy settings."
          control={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      )}
      <SettingsSwitchRow
        title="Show what I'm playing on Discord"
        description="Rich presence on your Discord profile. Turning this off clears it straight away."
        checked={shareDiscord}
        disabled={!loaded || busy}
        onCheckedChange={(v) => void update({ shareDiscord: v })}
      />
      <SettingsSwitchRow
        title="Show me in “Friends are listening to”"
        description="Other members of this server see your current track on their home page."
        checked={shareListening}
        disabled={!loaded || busy}
        onCheckedChange={(v) => void update({ shareListening: v })}
      />
    </SettingsGroup>
  );
}

/** Desktop Settings > Account: profile, privacy and sign out. */
export function AccountSection() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex flex-col gap-section">
      <AutoSaveProfile />
      <PrivacyRows />
      <SettingsGroup>
        <SettingsRow
          title="Sign out"
          description={user?.email ? `Signed in as ${user.email}` : undefined}
          control={
            <Button variant="destructive" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
        />
      </SettingsGroup>
    </div>
  );
}
