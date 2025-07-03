import { TFolder } from "obsidian";

export async function sha256(data: ArrayBufferLike): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashForFileList(fileList: { path: string, hash: string }[]): Promise<string> {
  // Sort by hash so it's order agnostic
  fileList.sort((a, b) => a.hash.localeCompare(b.hash));
  
  // Combine all paths and hashes into a single string
  let combinedData = '';
  for (const { path, hash } of fileList) {
    combinedData += path + hash;
  }
  
  // Hash the combined data
  const combinedBuffer = new TextEncoder().encode(combinedData);
  return await sha256(combinedBuffer);
}

export async function hashForFolder(folder: TFolder): Promise<string> {
  const fileList: { path: string, hash: string }[] = [];
  const folderList: TFolder[] = [];
  folderList.push(folder);

  while (folderList.length > 0) {
    const subfolder = folderList.shift();
    if (!subfolder) {
      continue;
    }
    for (const child of subfolder.children) {
      if (child instanceof TFolder) {
        folderList.push(child);
      } else {
        const content = await child.vault.adapter.readBinary(child.path);
        const hash = await sha256(content);
        fileList.push({ path: child.path.substring(folder.path.length + 1), hash });
      }
    }
  }
  return await hashForFileList(fileList);
}
