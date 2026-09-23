/** What a transfer asks, in the words a person would use themselves: which
 *  service the music is on now, what they already have in hand, and only the
 *  steps for that one combination. Nobody has to judge "quick" against
 *  "exact", and nobody reads about CSVs unless a file is their way in.
 *
 *  Pure data and sentences, so the dialog holds no copy of its own. The
 *  Google sign-in steps are imported rather than retyped: the parser and the
 *  routes' sentences live beside them. */

import {
  GOOGLE_FORGET_NOTE,
  GOOGLE_MUSIC_ONLY_NOTE,
  GOOGLE_SIGNIN_STEPS,
} from '@/lib/import/sources/ytmusicLiked';
import type { JobKind } from '@/lib/import/types';

/** Which real input a way in ends at, and so which route starts it: a file
 *  or a pasted list go through the upload route, a link through the inspect
 *  route, a Google sign-in through the YouTube Music likes routes. */
export type TransferRouteKind = 'file' | 'paste' | 'link' | 'google';

export type TransferServiceId = 'spotify' | 'ytmusic' | 'apple' | 'other';

/** Everything but the Google sign-in looks each song up by its name, which is
 *  why a finished transfer has songs to check and songs it never found. */
export const MATCHED_BY_NAME =
  'Ember looks each song up by name, so a few will need a check afterwards and a few may not be here at all.';

/** Nothing is searched for on this one: the songs arrive already named by
 *  YouTube itself. */
export const NOTHING_TO_MATCH =
  'These come straight from your account, so there is nothing to look up by name and nothing to check afterwards.';

/** Ember reads a Spotify playlist through Spotify's own embed, and the
 *  embed stops at 100 songs. */
export const SPOTIFY_LINK_CAP = 'Only the first 100 songs come across this way: that is all a Spotify link shows.';

/** Apple gives out no playlist links and has no export of its own. */
export const APPLE_ONLY_WAY = 'Apple Music shares no links, so the copy of your data Apple sends is the only way in.';

/** One real way to bring songs in. `steps` are numbered by their position,
 *  so the array order is the order shown. */
export interface TransferRoute {
  id: string;
  kind: TransferRouteKind;
  /** The plain "what do you have already?" option that leads here. */
  whatYouHave: string;
  steps: readonly string[];
  /** Plain lines under the steps: what this way in cannot do, and how the
   *  songs are found. */
  notes: readonly string[];
  /** True only for the Google sign-in: it always lands its
   *  songs in the likes, so it makes no sense as a way to build a playlist. */
  likedOnly?: boolean;
}

export interface TransferService {
  id: TransferServiceId;
  /** The card on "Where is your music now?". */
  name: string;
  /** The title once this service is picked. "Somewhere else" cannot be
   *  possessive, so each service says its own. */
  heading: string;
  routes: readonly TransferRoute[];
}

export const TRANSFER_SERVICES: readonly TransferService[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    heading: 'Bring in your Spotify songs',
    routes: [
      {
        id: 'spotify-link',
        kind: 'link',
        whatYouHave: 'A link to a playlist',
        steps: [
          'Spotify cannot share your liked songs as a link, so in Spotify make a new playlist and add them to it.',
          'Make that playlist public, then copy its link.',
          'Paste the link below.',
        ],
        notes: [SPOTIFY_LINK_CAP, MATCHED_BY_NAME],
      },
      {
        id: 'spotify-converter',
        kind: 'file',
        whatYouHave: 'A file someone gave me, or one I downloaded',
        steps: [
          'If you do not have the file yet, a free site like Exportify, Soundiiz or TuneMyMusic will make one: sign in with Spotify and export your Liked Songs as a CSV.',
          'Choose that file below.',
        ],
        notes: [MATCHED_BY_NAME],
      },
      {
        id: 'spotify-export',
        kind: 'file',
        whatYouHave: 'Nothing yet, but I can wait a few days',
        steps: [
          'In Spotify, go to Account, then Privacy settings.',
          'Choose "Download your data" and ask for it. Spotify emails you in a few days.',
          'Unzip what arrives and find the file called YourLibrary.json.',
          'Come back here and choose that file below.',
        ],
        notes: [MATCHED_BY_NAME],
      },
    ],
  },
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    heading: 'Bring in your YouTube Music songs',
    routes: [
      {
        id: 'ytmusic-google',
        kind: 'google',
        whatYouHave: 'I can sign in to my Google account',
        steps: GOOGLE_SIGNIN_STEPS,
        notes: [GOOGLE_FORGET_NOTE, GOOGLE_MUSIC_ONLY_NOTE, NOTHING_TO_MATCH],
        likedOnly: true,
      },
      {
        id: 'ytmusic-link',
        kind: 'link',
        whatYouHave: 'A link to a playlist',
        steps: [
          'In YouTube Music, make a playlist from your liked songs: Library, then Liked, then add them all to a new playlist.',
          'Make that playlist public and copy its share link.',
          'Paste the link below.',
        ],
        notes: [MATCHED_BY_NAME],
      },
    ],
  },
  {
    id: 'apple',
    name: 'Apple Music',
    heading: 'Bring in your Apple Music songs',
    routes: [
      {
        id: 'apple-export',
        kind: 'file',
        whatYouHave: 'A file Apple sent me',
        steps: [
          'On an iPhone, or at privacy.apple.com, ask for a copy of your data and choose Apple Media Services.',
          "Wait for Apple's email, which can take a few days, and download the file it links to.",
          'Unzip it and find the CSV with your songs in it.',
          'Choose that CSV below.',
        ],
        notes: [APPLE_ONLY_WAY, MATCHED_BY_NAME],
      },
    ],
  },
  {
    id: 'other',
    name: 'Somewhere else',
    heading: 'Bring in your songs',
    routes: [
      {
        id: 'other-paste',
        kind: 'paste',
        whatYouHave: 'Just a list I can type out',
        steps: ['Write your songs down, one a line, like "Artist - Title".', 'Paste that list below.'],
        notes: [MATCHED_BY_NAME],
      },
      {
        id: 'other-file',
        kind: 'file',
        whatYouHave: 'A file someone gave me',
        steps: ['Get the file with your songs in it, from a friend or another app, as a CSV.', 'Choose it below.'],
        notes: [MATCHED_BY_NAME],
      },
    ],
  },
];

/** Which services can fill the Liked songs for now. The owner has opened
 *  only YouTube Music (its Google sign-in brings the exact songs over); the
 *  others stay listed, crossed out, until they are opened again here. A new
 *  playlist can still come from any of them. */
export const LIKED_SERVICES_OPEN: readonly TransferServiceId[] = ['ytmusic'];

/** Every service, for when nothing is held back. */
export const ALL_SERVICES: readonly TransferServiceId[] = ['spotify', 'ytmusic', 'apple', 'other'];

/** Whether a service card can be picked for this destination. */
export function serviceOpen(
  id: TransferServiceId,
  destination: 'liked' | 'playlist',
  likedOpen: readonly TransferServiceId[] = LIKED_SERVICES_OPEN,
): boolean {
  return destination !== 'liked' || likedOpen.includes(id);
}

export function serviceById(id: TransferServiceId): TransferService {
  return TRANSFER_SERVICES.find((s) => s.id === id) ?? TRANSFER_SERVICES[0];
}

/** The ways in this service offers for where the songs are going. The
 *  Google sign-in always lands in the likes, so it is not
 *  offered while a new playlist is the destination. */
export function routesFor(service: TransferService, destination: JobKind): TransferRoute[] {
  return service.routes.filter((r) => !r.likedOnly || destination === 'liked');
}

/** The one a service falls to when there is nothing to ask: the first way
 *  in that is still on offer. */
export function soleRoute(service: TransferService, destination: JobKind): TransferRoute | null {
  const routes = routesFor(service, destination);
  return routes.length === 1 ? routes[0] : null;
}
