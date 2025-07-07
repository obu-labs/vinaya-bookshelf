import { App, requestUrl, TFile, TFolder, Notice, TAbstractFile } from "obsidian";
import * as JSZip from 'jszip';
import { hashForFileHashes, sha256 } from "./hashutils";
import { pruneFolder } from "./fileutils";

/**
 * Replaces `targetFolder` with the contents of the zip at `url`
 * 
 * @returns an SHA256 hash of the inflated directory's contents
 */
export default async function downloadZip(url: string, targetFolder: string, app: App, notice?: Notice | null): Promise<string> {
  if (!notice) {
    notice = new Notice(`Downloading new ${targetFolder} folder...`, 0);
  } else {
    notice.setMessage(`Downloading new ${targetFolder} folder...`);
  }
  const response = await requestUrl(url);
  notice.hide();
  notice = new Notice(`Unpacking "${targetFolder}.zip"...`, 0);
  const zip = await JSZip.loadAsync(response.arrayBuffer);
  notice.hide()
  notice = new Notice(`Installing new "${targetFolder}" folder...`, 0);
  const folder = app.vault.getFolderByPath(targetFolder);
  const fileHashes: Map<string, string> = new Map<string, string>();
  const foldersTouched: Set<string> = new Set<string>();
  const totalCount = Object.keys(zip.files).length;
  let fileCount = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    const fullPath = `${targetFolder}/${path}`;

    if (file.dir) {
      if (foldersTouched.has(fullPath)) {
        continue;
      }
      foldersTouched.add(fullPath);
      await app.vault.createFolder(fullPath).catch(() => {
        /* Folder might already exist */
      });
    } else {
      const content = await file.async('uint8array');

      // Ensure parent folders exist
      const folderPath = fullPath.split('/').slice(0, -1).join('/');
      if (folderPath) {
        if (!foldersTouched.has(folderPath)) {
          await app.vault.createFolder(folderPath).catch(() => {
            /* Folder might already exist */
          });
          foldersTouched.add(folderPath);
        }
      }

      fileCount += 1;
      notice.setMessage(`Installing ${targetFolder} file ${fileCount}/${totalCount}...`);
      await app.vault.adapter.writeBinary(fullPath, content).catch(
        (err: Error) => {
          console.error(`Failed to create file ${fullPath}:`, err);
        }
      );
      const hash = await sha256(content);
      fileHashes.set(path, hash);
    }
  }

  notice.hide();
  if (folder) { // If !folder, it was created by the zip, so no pruning needed
    notice = new Notice(`Removing old files from "${targetFolder}"...`, 0);
    await pruneFolder(app, folder, fileHashes.keys(), notice);
  }

  notice = new Notice(`Saving "${targetFolder}" module...`, 0);
  const ret = await hashForFileHashes(fileHashes);
  notice.hide();
  return ret;
}
