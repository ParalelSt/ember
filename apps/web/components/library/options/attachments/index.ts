/** Design candidates for attaching screenshots and recordings to the three
 *  report forms (Bug report, and the New feature / Fix tabs of Send a
 *  request). Only the attach UI differs between them; the dialogs around
 *  them are drawn the way they ship. Limits come from lib/attachments.ts,
 *  the same numbers the real dialogs and the server will use. */
export type AttachStyle = 'chips' | 'dropzone' | 'footer';
export type AttachState = 'empty' | 'files' | 'toobig';

export const ATTACH_STYLES: { id: AttachStyle; label: string; blurb: string }[] = [
  {
    id: 'chips',
    label: 'Button + thumbnails',
    blurb:
      'An "Attach screenshot or video" button under the fields. What you add shows as a row of square thumbnails, each with a remove button, and a running total under it.',
  },
  {
    id: 'dropzone',
    label: 'Drop zone',
    blurb:
      'A dashed box you can drop files on or tap to browse. Added files are listed under it as rows with the name and size. Clearest on desktop, takes the most room.',
  },
  {
    id: 'footer',
    label: 'Paperclip in the footer',
    blurb:
      'A paperclip beside Cancel and Send, like a chat app. Nothing extra shows until you attach something, then a thumbnail strip appears above the footer. The most compact.',
  },
];

export const ATTACH_STATES: { id: AttachState; label: string }[] = [
  { id: 'empty', label: 'Nothing attached' },
  { id: 'files', label: 'A screenshot and a clip' },
  { id: 'toobig', label: 'Too big' },
];

export const ATTACH_RECOMMENDED: AttachStyle = 'chips';
export const ATTACH_RECOMMENDED_REASON =
  'Button + thumbnails says what you can attach before you try, shows the files you picked as pictures, and reads the same on a phone and on desktop without taking room until it is used.';

export interface MockAttachment {
  name: string;
  size: number;
  type: string;
  /** Video length, shown on the thumbnail. */
  duration?: string;
  /** Thumbnail stand-in: a gradient, since the gallery has no real files. */
  swatch: string;
}

const MB = 1024 * 1024;

export const MOCK_ATTACHMENTS: Record<Exclude<AttachState, 'empty'>, MockAttachment[]> = {
  files: [
    { name: 'queue-jumps.png', size: 1.2 * MB, type: 'image/png', swatch: 'from-slate-500 to-slate-800' },
    { name: 'screen-recording.mp4', size: 6.4 * MB, type: 'video/mp4', duration: '0:12', swatch: 'from-rose-900 to-zinc-900' },
  ],
  toobig: [
    { name: 'queue-jumps.png', size: 1.2 * MB, type: 'image/png', swatch: 'from-slate-500 to-slate-800' },
    { name: 'screen-recording.mp4', size: 38.4 * MB, type: 'video/mp4', duration: '1:04', swatch: 'from-rose-900 to-zinc-900' },
  ],
};
