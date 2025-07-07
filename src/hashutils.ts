import { TFolder, TFile } from "obsidian";
import { allFilesInFolder } from "./fileutils";

export async function sha256(data: ArrayBufferLike): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashForFileHashes(fileHashes: Map<string, string>): Promise<string> {
  // Sort by hash so it's order agnostic
  const fileList = Array.from(
    fileHashes.entries()
  ).map(
    ([path, hash]) => ({ path, hash })
  ).sort(
    (a, b) => a.hash.localeCompare(b.hash)
  );
  
  // Combine all paths and hashes into a single string
  let combinedData = '';
  for (const { path, hash } of fileList) {
    combinedData += path + hash;
  }
  
  // Hash the combined data
  const combinedBuffer = new TextEncoder().encode(combinedData);
  return await sha256(combinedBuffer);
}

export async function hashForFiles(files: Iterable<TFile>, relativeTo?: TFolder): Promise<string> {
  const filesAndHashes: { file: TFile, hash: string }[] = await Promise.all(
    Array.from(files).map(
      async (file) => {
        const content = await file.vault.adapter.readBinary(file.path);
        const hash = await sha256(content);
        return { file, hash };
      }
    )
  );
  const fileHashes: Map<string, string> = new Map<string, string>();
  for (const { file, hash } of filesAndHashes) {
    if (relativeTo) {
      fileHashes.set(file.path.substring(relativeTo.path.length + 1), hash);
    } else {
      fileHashes.set(file.path, hash);
    }
  }
  return await hashForFileHashes(fileHashes);
}

export async function hashForFolder(folder: TFolder): Promise<string> {
  const files = allFilesInFolder(folder);
  return await hashForFiles(files, folder);
}
