import { App, requestUrl } from "obsidian";
import * as JSZip from 'jszip';
import { hashForFileList, sha256 } from "./hashutils";

/**
 * Replaces `targetFolder` with the contents of the zip at `url`
 * 
 * @returns an SHA256 hash of the inflated directory's contents
 */
export async function downloadZip(url: string, targetFolder: string, app: App) {
  const response = await requestUrl(url);
  const zip = await JSZip.loadAsync(response.arrayBuffer);
  const folder = app.vault.getFolderByPath(targetFolder);
  const fileList: { path: string, hash: string }[] = [];
  if (folder) {
    await app.vault.delete(folder, true);
  }
  for (const [path, file] of Object.entries(zip.files)) {
    const fullPath = `${targetFolder}/${path}`;

    if (file.dir) {
      // Create the folder in the vault
      await app.vault.createFolder(fullPath).catch(() => {
        /* Folder might already exist */
      });
    } else {
      const content = await file.async('uint8array');

      // Ensure parent folders exist
      const folderPath = fullPath.split('/').slice(0, -1).join('/');
      if (folderPath) {
        await app.vault.createFolder(folderPath).catch(() => {
          /* Folder might already exist */
        });
      }

      await app.vault.createBinary(fullPath, content).catch((err: Error) => {
        console.error(`Failed to create file ${fullPath}:`, err);
      });
      const hash = await sha256(content);
      fileList.push({
        path: fullPath,
        hash: hash
      });
    }
  }

  return await hashForFileList(fileList);
}
