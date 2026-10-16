'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useAuth } from '@/components/providers/AuthProvider';

/** Your own uploads, newest first, with size and added date: "Your
 *  uploads" in Settings > Uploads. */
export function useQueryMyUploads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: QK.myUploads,
    queryFn: () => api.listMyUploads().then((r) => r.uploads),
    enabled: !!user,
  });
}

/** Edit details, cover changes and Remove. Each one refreshes the shared
 *  Uploads collection too (its key is a prefix of this list's), so a
 *  renamed song is renamed where it plays as well. */
export function useMyUploadActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: QK.uploads });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { title?: string; artist?: string; album?: string } }) =>
      api.updateUpload(id, patch),
    onSuccess: refresh,
  });
  const setCover = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.setUploadCover(id, file),
    onSuccess: refresh,
  });
  const removeCover = useMutation({
    mutationFn: (id: string) => api.removeUploadCover(id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUpload(id),
    onSuccess: refresh,
  });
  return { update, setCover, removeCover, remove };
}
