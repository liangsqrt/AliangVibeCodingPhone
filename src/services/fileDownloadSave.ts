// COS → phone system save (Task 17). Android hands the presigned GET to the
// system DownloadManager (no storage permission needed, system notification,
// lands in Downloads); iOS has no shared Downloads folder, so the file is
// downloaded into the app cache under the ORIGINAL filename and offered
// through the system share sheet (the user picks "Save to Files") — the
// explicit path keeps the share sheet and "Save to Files" from seeing a
// random tmp name. The cache file is removed once the sheet settles.
//
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';

export interface SaveDownloadOptions {
  /** COS presigned GET url (from the server's ready push). */
  url: string;
  filename: string;
  /** Falls back to application/octet-stream — DownloadManager/Share fall back to extension sniffing anyway. */
  mime?: string;
  onProgress?: (receivedBytes: number) => void;
}

const FALLBACK_MIME = 'application/octet-stream';

export async function saveDownloadedFile({
  url,
  filename,
  mime,
  onProgress,
}: SaveDownloadOptions): Promise<void> {
  const mimeOrFallback = mime ?? FALLBACK_MIME;
  if (Platform.OS === 'android') {
    await ReactNativeBlobUtil.config({
      addAndroidDownloads: {
        useDownloadManager: true,
        title: filename,
        description: filename,
        mime: mimeOrFallback,
        mediaScannable: true,
        notification: true,
      },
    }).fetch('GET', url);
    return;
  }
  // Explicit path (not fileCache): the tmp file is named after the source
  // file, so the share sheet and "Save to Files" both keep the original
  // filename instead of a random blob-util tmp name. `path` already carries
  // the full filename — no appendExt. Separators are flattened defensively
  // (upstream sanitizeDownloadFilename already strips them).
  const safeFilename = filename.replace(/[/\\]/g, '_');
  const target = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${safeFilename}`;
  try {
    const task = ReactNativeBlobUtil.config({ path: target }).fetch('GET', url);
    if (onProgress) {
      task.progress({ interval: 1000 }, received => {
        const bytes = Number(received);
        if (Number.isSafeInteger(bytes) && bytes >= 0) onProgress(bytes);
      });
    }
    await task;
    // failOnCancel:false — the user closing the share sheet resolves (dismissedAction)
    // instead of rejecting; only real failures throw.
    await Share.open({
      url: `file://${target}`,
      type: mimeOrFallback,
      subject: filename,
      failOnCancel: false,
    });
  } finally {
    await ReactNativeBlobUtil.fs.unlink(target).catch(() => {});
  }
}
