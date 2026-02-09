import { createClient } from '@/lib/supabase/client';

export async function uploadAudio(
  userId: string,
  meetingId: string,
  partNumber: number,
  audioBlob: Blob
): Promise<string | null> {
  const supabase = createClient();

  // Determine file extension from mime type
  const ext = audioBlob.type.includes('webm') ? 'webm' : 'mp4';
  const fileName = `${userId}/${meetingId}/part_${partNumber}.${ext}`;

  const { error } = await supabase.storage
    .from('recordings')
    .upload(fileName, audioBlob, {
      contentType: audioBlob.type,
      upsert: false,
    });

  if (error) {
    console.error('Upload error:', error);
    return null;
  }

  return fileName;
}
