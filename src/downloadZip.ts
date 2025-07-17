import { App, requestUrl, TFile, TFolder, Notice, TAbstractFile } from "obsidian";
import * as JSZip from 'jszip';
import { hashForFileHashes, sha256 } from "./hashutils";
import { pruneFolder } from "./fileutils";

/**
 * Replaces `targetFolder` with the contents of the zip at `url`
 * 
 * @param url The URL of the zip to download
 * @param targetFolder The folder to replace with zip's contents
 * @param app The Obsidian application
 * @param notice An optional notice to update with progress (will create one if not provided)
 * @param excludePaths An optional list of folders to exclude from within the zip
 * 
 * @returns an SHA256 hash of the inflated directory's contents
 */
export default async function downloadZip(
  url: string,
  targetFolder: string,
  app: App,
  notice?: Notice | null,
  excludePaths?: Iterable<string> | null,
): Promise<string> {
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
  const exclusionSet = new Set(excludePaths);
  let folder = app.vault.getFolderByPath(targetFolder);
  let needs_pruning = true;
  if (!folder) {
    needs_pruning = false;
    folder = await app.vault.createFolder(targetFolder);
  }
  const fileHashes: Map<string, string> = new Map<string, string>();
  const foldersTouched: Set<string> = new Set<string>();
  const totalCount = Object.keys(zip.files).length;
  let fileCount = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    const fullPath = `${targetFolder}/${path}`;

    if (file.dir) {
      continue; // No need to add empty directories
    }

    const content = await file.async('uint8array');
    fileCount += 1;

    // Ensure parent folders exist
    // const folderPath = fullPath.split('/').slice(0, -1).join('/');
    let pathParts = path.split('/');
    pathParts.pop(); // Remove filename
    let folderPath = pathParts.shift();
    let is_in_excluded_folder: boolean = false;
    while(folderPath) {
      if (exclusionSet.has(folderPath)) {
        is_in_excluded_folder = true;
        break;
      }
      if (pathParts.length > 0) {
        folderPath = folderPath + '/' + pathParts.shift();
      } else {
        folderPath = targetFolder + '/' + folderPath;
        break;
      }
    }
    if (is_in_excluded_folder) {
      continue;
    }
    if (folderPath) {
      if (!foldersTouched.has(folderPath)) {
        await app.vault.createFolder(folderPath).catch(() => {
          /* Folder might already exist */
        });
        foldersTouched.add(folderPath);
      }
    }

    notice.setMessage(`Installing ${targetFolder} file ${fileCount}/${totalCount}...`);
    await app.vault.adapter.writeBinary(fullPath, content).catch(
      (err: Error) => {
        console.error(`Failed to create file ${fullPath}:`, err);
      }
    );
    const hash = await sha256(content);
    fileHashes.set(path, hash);
  }

  notice.hide();
  if (needs_pruning) { // If !folder, it was created by the zip, so no pruning needed
    notice = new Notice(`Removing old files from "${targetFolder}"...`, 0);
    await pruneFolder(app, folder, fileHashes.keys(), notice);
  }

  notice = new Notice(`Saving "${targetFolder}" module...`, 0);
  const ret = await hashForFileHashes(fileHashes);
  notice.hide();
  return ret;
}
